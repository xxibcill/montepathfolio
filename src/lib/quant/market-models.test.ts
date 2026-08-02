import { describe, expect, it } from "vitest";
import { QuantError, correlation, createSemanticRandom, mean } from "./core";
import {
  fitGarch,
  fitOrderedRegimes,
  runCompositeMarket,
  runCopula,
  runGarch,
  runHistoricalBootstrap,
  runMertonJumpDiffusion,
  runStudentTInnovations,
  standardizeStudentT,
  validateReturnDataset,
  type CompositeMarketInput,
  type GarchInput,
  type MertonJumpDiffusionInput,
  type ReturnDataset,
} from "./market-models";

const dataset: ReturnDataset = {
  contract: "return-dataset@1",
  assetIds: ["lesson-asset"],
  timestamps: Array.from({ length: 12 }, (_, index) =>
    `2025-${String(index + 1).padStart(2, "0")}-01`,
  ),
  frequency: "monthly",
  returnConvention: "log",
  rows: [0.03, -0.04, 0.01, 0.02, -0.02, 0.04, -0.03, 0.01, 0, 0.02, -0.01, 0.03].map(
    (value) => [value],
  ),
  missingValuePolicy: "reject",
  alignmentPolicy: "intersection",
  provenance: { label: "Illustrative classroom series", kind: "illustrative" },
};

describe("return datasets and calibration snapshots", () => {
  it("accepts a total-loss simple return and rejects values below -100%", () => {
    const totalLossDataset: ReturnDataset = {
      ...dataset,
      returnConvention: "simple",
      rows: dataset.rows.map((row, index) => [index === 0 ? -1 : row[0]]),
    };
    expect(() => validateReturnDataset(totalLossDataset)).not.toThrow();
    const validateImpossibleLoss = () =>
      validateReturnDataset({
        ...totalLossDataset,
        rows: totalLossDataset.rows.map((row, index) =>
          index === 3 ? [-1.000_001] : row,
        ),
      });
    expect(validateImpossibleLoss).toThrowError(QuantError);
    expect(validateImpossibleLoss).toThrow(/below -100%/);
  });

  it("compares timestamps chronologically instead of lexicographically", () => {
    expect(() =>
      validateReturnDataset({
        ...dataset,
        timestamps: ["01/02/2025", "12/31/2024"],
        rows: [[0.01], [0.02]],
      }),
    ).toThrow(/increasing/);
  });

  it("fits immutable, provenance-labelled GARCH and regime snapshots", () => {
    const garch = fitGarch(dataset);
    expect(garch.contract).toBe("calibration-snapshot@1");
    expect(garch.estimates.omega).toBeGreaterThan(0);
    expect(garch.dataProvenance.kind).toBe("illustrative");

    const regimes = fitOrderedRegimes(dataset);
    expect(regimes.estimates.regimeLabels).toEqual(["bear", "sideways", "bull"]);
    for (const row of regimes.estimates.transitionMatrix) {
      expect(row.reduce((total, value) => total + value, 0)).toBeCloseTo(1);
    }
  });

  it("rejects tiny and tie-collapsed ordered-regime samples clearly", () => {
    const tinyDataset: ReturnDataset = {
      ...dataset,
      timestamps: dataset.timestamps.slice(0, 4),
      rows: [[-0.02], [-0.01], [0.01], [0.02]],
    };
    expect(() => fitOrderedRegimes(tinyDataset)).toThrowError(QuantError);
    expect(() => fitOrderedRegimes(tinyDataset)).toThrow(/five distinct/);

    const tiedDataset: ReturnDataset = {
      ...dataset,
      rows: [[-0.01], [0], [0], [0], [0], [0], [0], [0], [0.01], [0.02], [0.03], [0.04]],
    };
    expect(() => fitOrderedRegimes(tiedDataset)).toThrow(/ties collapse/);
  });
});

describe("Merton jump diffusion", () => {
  const input: MertonJumpDiffusionInput = {
    contract: "market-model/merton-jump-diffusion@1",
    initialPrices: [100],
    assets: [{ annualDrift: 0.08, annualVolatility: 0.2 }],
    correlation: [[1]],
    jumps: [{ annualIntensity: 0, meanLogJump: -0.15, logJumpVolatility: 0.1 }],
    execution: { seed: 17, paths: 3, steps: 12, stepYears: 1 / 12, samplePaths: 3 },
  };

  it("reduces exactly to GBM when jump intensity is zero", () => {
    const output = runMertonJumpDiffusion(input).result;
    const random = createSemanticRandom(input.execution.seed, input.contract);
    let expected = 100;
    for (let step = 1; step <= 12; step += 1) {
      expected *= Math.exp(
        (0.08 - 0.5 * 0.2 ** 2) / 12 +
          (0.2 / Math.sqrt(12)) * random.normal("diffusion", 0, step, 0),
      );
    }
    expect(output.terminalPrices[0][0]).toBeCloseTo(expected, 12);
    expect(output.sampledJumpEvents).toHaveLength(0);
    expect(output.diagnostics.jumpConditionedMeanMaximumDrawdown[0]).toBeNull();
    expect(output.diagnostics.terminalLoss95Cvar[0]).toBeGreaterThanOrEqual(
      output.diagnostics.terminalLoss95VaR[0],
    );
  });

  it("uses separate jump streams and recovers the configured count rate", () => {
    const jumped = runMertonJumpDiffusion({
      ...input,
      jumps: [{ annualIntensity: 2, meanLogJump: -0.08, logJumpVolatility: 0.12 }],
      execution: { ...input.execution, paths: 4_000, samplePaths: 4 },
    }).result;
    expect(jumped.diagnostics.empiricalAnnualJumpCounts[0]).toBeCloseTo(2, 1);
    expect(jumped.sampledPricePaths).toHaveLength(4);
    expect(jumped.diagnostics.jumpConditionedMeanMaximumDrawdown[0]).not.toBeNull();
    expect(jumped.diagnostics.meanMaximumDrawdown[0]).toBeGreaterThanOrEqual(0);
  });

  it("enforces the documented asset-step and sampled-output limits", () => {
    expect(() =>
      runMertonJumpDiffusion({
        ...input,
        initialPrices: [100, 100],
        assets: [input.assets[0], input.assets[0]],
        correlation: [[1, 0], [0, 1]],
        jumps: [input.jumps[0], input.jumps[0]],
        execution: {
          ...input.execution,
          paths: 251,
          steps: 10_000,
          samplePaths: 1,
        },
      }),
    ).toThrow(/asset-step/);
    expect(() =>
      runMertonJumpDiffusion({
        ...input,
        execution: { ...input.execution, samplePaths: -1 },
      }),
    ).toThrow(/samplePaths/);
  });

  it("preflights stochastic jump-event work before sampling", () => {
    expect(() =>
      runMertonJumpDiffusion({
        ...input,
        jumps: [{
          ...input.jumps[0],
          annualIntensity: 1_000_000_000,
        }],
        execution: {
          ...input.execution,
          paths: 1,
          steps: 1,
          stepYears: 1,
          samplePaths: 1,
        },
      }),
    ).toThrow(/event resource limit/);
  });
});

describe("GARCH(1,1)", () => {
  const input: GarchInput = {
    contract: "market-model/garch-1-1@1",
    parameters: { omega: 0.0004, alpha: 0, beta: 0, meanReturn: 0 },
    initialVariance: 0.0004,
    innovation: { kind: "gaussian" },
    execution: { seed: 91, paths: 2, steps: 10, samplePaths: 2 },
  };

  it("keeps conditional variance constant when alpha and beta are zero", () => {
    const output = runGarch(input).result;
    expect(output.sampledConditionalVariances[0]).toEqual(
      Array(10).fill(0.0004),
    );
    expect(output.volatilityCone.every((point) => point.expectedVariance === 0.0004)).toBe(true);
  });

  it("is reproducible and warns for nonstationary persistence", () => {
    expect(runGarch(input)).toEqual(runGarch(input));
    const warning = runGarch({
      ...input,
      parameters: { ...input.parameters, alpha: 0.2, beta: 0.85 },
      initialVariance: 0.0004,
    }).warnings;
    expect(warning[0].code).toBe("STATIONARITY");
  });

  it("standardizes finite-variance Student-t innovations", () => {
    expect(standardizeStudentT(2, 6)).toBeCloseTo(2 * Math.sqrt(4 / 6));
    expect(() => standardizeStudentT(1, 2)).toThrow(/exceed two/);
  });

  it("rejects persistence overflow and finite inputs that overflow recurrence", () => {
    expect(() =>
      runGarch({
        ...input,
        parameters: {
          ...input.parameters,
          alpha: Number.MAX_VALUE,
          beta: Number.MAX_VALUE,
        },
      }),
    ).toThrow(/alpha \+ beta must remain finite/);
    expect(() =>
      runGarch({
        ...input,
        parameters: {
          omega: 1,
          alpha: Number.MAX_VALUE,
          beta: 0,
          meanReturn: 0,
        },
        initialVariance: Number.MAX_VALUE,
        execution: { ...input.execution, paths: 1, steps: 1, samplePaths: 1 },
      }),
    ).toThrow(/volatility forecast overflowed/);
  });

  it("preflights retained sample output separately from simulation work", () => {
    expect(() =>
      runGarch({
        ...input,
        execution: { seed: 1, paths: 1_000, steps: 3_000, samplePaths: 1_000 },
      }),
    ).toThrow(/retention limit/);
  });
});

describe("Student-t innovation boundary", () => {
  it("is deterministic, standardized, and heavier-tailed than its paired normal", () => {
    const request = {
      contract: "market-model/student-t-innovations@1" as const,
      degreesOfFreedom: 5,
      seed: 715,
      samples: 50_000,
      tailThreshold: 2.5,
    };
    const output = runStudentTInnovations(request);
    expect(output).toEqual(runStudentTInnovations(request));
    expect(output.result.standardizedStudentTInnovations).toHaveLength(50_000);
    expect(output.result.diagnostics.normalVariance).toBeCloseTo(1, 1);
    expect(output.result.diagnostics.studentTVariance).toBeCloseTo(1, 1);
    expect(output.result.diagnostics.studentTTailProbability).toBeGreaterThan(
      output.result.diagnostics.normalTailProbability,
    );
    expect(output.result.diagnostics.sharedNormalNumerators).toBe(true);
  });

  it("validates contract, finite-variance degrees of freedom, and resource limits", () => {
    expect(() =>
      runStudentTInnovations({
        contract: "market-model/student-t-innovations@2",
        degreesOfFreedom: 5,
        seed: 1,
        samples: 100,
        tailThreshold: 2.5,
      } as never),
    ).toThrow(/Unsupported Student-t innovation contract/);
    expect(() =>
      runStudentTInnovations({
        contract: "market-model/student-t-innovations@1",
        degreesOfFreedom: 2,
        seed: 1,
        samples: 100,
        tailThreshold: 2.5,
      }),
    ).toThrow(/exceed two/);
    expect(() =>
      runStudentTInnovations({
        contract: "market-model/student-t-innovations@1",
        degreesOfFreedom: 5,
        seed: 1,
        samples: 100_001,
        tailThreshold: 2.5,
      }),
    ).toThrow(/100000/);
  });
});

describe("historical bootstrap and copulas", () => {
  it("only emits source rows and preserves moving-block ordering", () => {
    const result = runHistoricalBootstrap({
      contract: "market-model/historical-bootstrap@1",
      dataset,
      method: { kind: "moving-block", blockSize: 3 },
      seed: 4,
      paths: 2,
      steps: 9,
      samplePaths: 2,
    }).result;
    const indexes = result.sampledSourceIndexes[0];
    for (let index = 1; index < indexes.length; index += 1) {
      if (index % 3 !== 0) {
        expect(indexes[index]).toBe((indexes[index - 1] + 1) % dataset.rows.length);
      }
    }
    for (const row of result.sampledRows[0]) {
      expect(dataset.rows.some((source) => source[0] === row[0])).toBe(true);
    }
  });

  it("counts source indexes in the bootstrap retention limit", () => {
    const assetCount = 100_000;
    const wideDataset: ReturnDataset = {
      ...dataset,
      assetIds: Array.from(
        { length: assetCount },
        (_, index) => `asset-${index}`,
      ),
      timestamps: dataset.timestamps.slice(0, 2),
      rows: [Array(assetCount).fill(0.01), Array(assetCount).fill(-0.01)],
    };

    expect(() =>
      runHistoricalBootstrap({
        contract: "market-model/historical-bootstrap@1",
        dataset: wideDataset,
        method: { kind: "iid" },
        seed: 4,
        paths: 1,
        steps: 50,
        samplePaths: 1,
      }),
    ).toThrow(/retention limit/);
  });

  it("recovers Gaussian dependence and shows stronger t-copula lower tails", () => {
    const gaussian = runCopula({
      contract: "market-model/copula@1",
      kind: "gaussian",
      correlation: [[1, 0.65], [0.65, 1]],
      seed: 8,
      samples: 5_000,
    }).result;
    const student = runCopula({
      contract: "market-model/copula@1",
      kind: "student-t",
      correlation: [[1, 0.65], [0.65, 1]],
      degreesOfFreedom: 4,
      seed: 8,
      samples: 5_000,
    }).result;
    expect(gaussian.diagnostics.empiricalCorrelation[0][1]).toBeCloseTo(0.65, 1);
    expect(student.diagnostics.lowerTailCoMovement).toBeGreaterThan(
      gaussian.diagnostics.lowerTailCoMovement,
    );
    expect(student.uniforms.flat().every((value) => value > 0 && value < 1)).toBe(true);
    expect(mean(student.uniforms.map((row) => row[0]))).toBeCloseTo(0.5, 1);
    expect(() =>
      runCopula({
        contract: "market-model/copula@1",
        kind: "student-t",
        correlation: [[1]],
        degreesOfFreedom: 2,
        seed: 8,
        samples: 10,
      }),
    ).toThrow(/exceed two/);
    expect(() =>
      runCopula({
        contract: "market-model/copula@1",
        kind: "gaussian",
        correlation: [[4]],
        seed: 8,
        samples: 10,
      }),
    ).toThrow(/ones/);
  });
});

describe("sanctioned HMM → GARCH → copula → jump pipeline", () => {
  const input: CompositeMarketInput = {
    contract: "market-model/hmm-garch-copula-jump@1",
    initialPrices: [100, 100],
    regimes: {
      initialProbabilities: [1, 0],
      transitionMatrix: [[0.95, 0.05], [0.1, 0.9]],
      annualDrifts: [[0.06, 0.03], [-0.12, 0.02]],
    },
    garch: [
      { omega: 0.00002, alpha: 0.08, beta: 0.88, meanReturn: 0 },
      { omega: 0.00001, alpha: 0.05, beta: 0.9, meanReturn: 0 },
    ],
    copula: { kind: "gaussian", correlation: [[1, 0.25], [0.25, 1]] },
    jumps: [
      { annualIntensity: 0.4, meanLogJump: -0.1, logJumpVolatility: 0.08 },
      { annualIntensity: 0.1, meanLogJump: -0.03, logJumpVolatility: 0.03 },
    ],
    enabled: { regimes: true, dynamicVariance: true, dependence: true, jumps: true },
    execution: { seed: 22, paths: 8, steps: 24, stepYears: 1 / 12, samplePaths: 3 },
  };

  it("is deterministic, bounded, and reports each owned diagnostic", () => {
    const first = runCompositeMarket(input);
    expect(first).toEqual(runCompositeMarket(input));
    expect(first.result.sampledPrices).toHaveLength(3);
    expect(first.result.diagnostics.sampledRegimes[0]).toHaveLength(25);
    expect(first.result.diagnostics.sampledVariances[0][0]).toHaveLength(25);
    expect(first.result.diagnostics.updateOrder).toBe("hmm->garch->copula->jump->price");
    expect(mean(first.result.sampledPrices[0][0])).toBeGreaterThan(0);
  });

  it("reduces exactly when each composite feature is disabled", () => {
    const allDisabled: CompositeMarketInput = {
      ...input,
      enabled: {
        regimes: false,
        dynamicVariance: false,
        dependence: false,
        jumps: false,
      },
    };
    const inertParameters: CompositeMarketInput = {
      ...allDisabled,
      regimes: {
        ...allDisabled.regimes,
        transitionMatrix: [[0, 1], [1, 0]],
        annualDrifts: [[0.06, 0.03], [9, -9]],
      },
      copula: {
        ...allDisabled.copula,
        correlation: [[1, -0.9], [-0.9, 1]],
      },
      jumps: allDisabled.jumps.map((jump) => ({
        ...jump,
        annualIntensity: 9,
        meanLogJump: 0.5,
      })),
    };
    expect(runCompositeMarket(inertParameters).result.sampledPrices).toEqual(
      runCompositeMarket(allDisabled).result.sampledPrices,
    );

    const stationaryVariances = input.garch.map((parameters) =>
      parameters.omega / (1 - parameters.alpha - parameters.beta),
    );
    const staticEnabled: CompositeMarketInput = {
      ...input,
      garch: stationaryVariances.map((omega) => ({
        omega,
        alpha: 0,
        beta: 0,
        meanReturn: 0,
      })),
      enabled: { ...input.enabled, dynamicVariance: true },
    };
    const dynamicDisabled: CompositeMarketInput = {
      ...input,
      enabled: { ...input.enabled, dynamicVariance: false },
    };
    expect(runCompositeMarket(dynamicDisabled).result.sampledPrices).toEqual(
      runCompositeMarket(staticEnabled).result.sampledPrices,
    );
  });

  it("uses independent Student-t scales when dependence is off", () => {
    const independent = runCompositeMarket({
      ...input,
      initialPrices: [100, 100],
      regimes: {
        initialProbabilities: [1],
        transitionMatrix: [[1]],
        annualDrifts: [[0, 0]],
      },
      garch: [
        { omega: 0.04, alpha: 0, beta: 0, meanReturn: 0 },
        { omega: 0.04, alpha: 0, beta: 0, meanReturn: 0 },
      ],
      copula: {
        kind: "student-t",
        degreesOfFreedom: 4,
        correlation: [[1, 0.8], [0.8, 1]],
      },
      jumps: [
        { annualIntensity: 0, meanLogJump: 0, logJumpVolatility: 0 },
        { annualIntensity: 0, meanLogJump: 0, logJumpVolatility: 0 },
      ],
      enabled: {
        regimes: false,
        dynamicVariance: false,
        dependence: false,
        jumps: false,
      },
      execution: {
        seed: 203,
        paths: 5_000,
        steps: 1,
        stepYears: 1,
        samplePaths: 5_000,
      },
    }).result;
    const magnitudes = [0, 1].map((assetIndex) =>
      independent.sampledPrices.map((paths) =>
        Math.abs((Math.log(paths[assetIndex][1] / 100) + 0.02) / 0.2),
      ),
    );
    expect(Math.abs(correlation(magnitudes[0], magnitudes[1]))).toBeLessThan(0.08);
  });

  it("validates composite discriminants, booleans, and finite GARCH means", () => {
    expect(() =>
      runCompositeMarket({
        ...input,
        copula: { ...input.copula, kind: "unknown" as never },
      }),
    ).toThrow(/Unsupported copula kind/);
    expect(() =>
      runCompositeMarket({
        ...input,
        enabled: { ...input.enabled, regimes: "false" as never },
      }),
    ).toThrow(/must be a boolean/);
    expect(() =>
      runCompositeMarket({
        ...input,
        garch: [
          { ...input.garch[0], meanReturn: Number.NaN },
          input.garch[1],
        ],
      }),
    ).toThrow(/meanReturn must be finite/);
  });

  it("rejects composite work scaled by asset count before simulation", () => {
    const assets = 128;
    const correlation = Array.from({ length: assets }, (_, row) =>
      Array.from({ length: assets }, (_, column) => Number(row === column)),
    );
    expect(() =>
      runCompositeMarket({
        ...input,
        initialPrices: Array(assets).fill(100),
        regimes: {
          initialProbabilities: [1],
          transitionMatrix: [[1]],
          annualDrifts: [Array(assets).fill(0.05)],
        },
        garch: Array(assets).fill(input.garch[0]),
        copula: { kind: "gaussian", correlation },
        jumps: Array(assets).fill(input.jumps[0]),
        execution: {
          seed: 1,
          paths: 500,
          steps: 10_000,
          stepYears: 1 / 252,
          samplePaths: 1,
        },
      }),
    ).toThrow(/asset-step/);
  });

  it("preflights composite jump-event work before sampling", () => {
    expect(() =>
      runCompositeMarket({
        ...input,
        jumps: input.jumps.map((jump) => ({
          ...jump,
          annualIntensity: 1_000_000_000,
        })),
        execution: {
          ...input.execution,
          paths: 1,
          steps: 1,
          stepYears: 1,
          samplePaths: 1,
        },
      }),
    ).toThrow(/event resource limit/);
  });
});
