import { describe, expect, it } from "vitest";

import type { SimulationInputs } from "../types/simulation";
import { DEFAULT_INPUTS } from "./defaults";
import {
  runSimulation,
  runSimulationCase,
  sampleRegime,
} from "./simulation";
import { PORTFOLIO_LAB_LIMITS } from "./portfolio-lab/in-process-runner";

const BASE_INPUTS: SimulationInputs = {
  ...DEFAULT_INPUTS,
  initialCapital: 25_000,
  monthlyContribution: 500,
  horizonYears: 10,
  stockAllocation: 0.7,
  model: "constant",
  stocks: {
    expectedReturn: 0.08,
    volatility: 0.18,
  },
  bonds: {
    expectedReturn: 0.035,
    volatility: 0.07,
  },
  correlation: 0.2,
  rebalanceFrequency: "annual",
  inflationRate: 0.025,
  targetValue: 150_000,
  pathCount: 1_000,
  seed: 42,
};

describe("runSimulation", () => {
  it("repeats every stochastic output when the seed is unchanged", () => {
    const first = runSimulation(BASE_INPUTS);
    const second = runSimulation(BASE_INPUTS);

    expect(second.months).toEqual(first.months);
    expect(second.samplePaths).toEqual(first.samplePaths);
    expect(second.sampleDrawdownPaths).toEqual(first.sampleDrawdownPaths);
    expect(second.pathPercentiles).toEqual(first.pathPercentiles);
    expect(second.drawdownPercentiles).toEqual(first.drawdownPercentiles);
    expect(second.terminalValues).toEqual(first.terminalValues);
    expect(second.maxDrawdowns).toEqual(first.maxDrawdowns);
    expect(second.sampleRegimePaths).toEqual(first.sampleRegimePaths);
    expect(second.regimeOccupancy).toEqual(first.regimeOccupancy);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.comparisonMetrics).toEqual(first.comparisonMetrics);
  });

  it("samples categorical regimes at cumulative probability boundaries", () => {
    const probabilities = { bull: 0.5, bear: 0.2, sideways: 0.3 };

    expect(sampleRegime(probabilities, 0)).toBe("bull");
    expect(sampleRegime(probabilities, 0.5)).toBe("bull");
    expect(sampleRegime(probabilities, 0.500_001)).toBe("bear");
    expect(sampleRegime(probabilities, 0.7)).toBe("bear");
    expect(sampleRegime(probabilities, 0.700_001)).toBe("sideways");
    expect(sampleRegime(probabilities, 1)).toBe("sideways");
  });

  it("keeps an absorbing bull regime active for every HMM month", () => {
    const result = runSimulation({
      ...BASE_INPUTS,
      model: "hmm",
      horizonYears: 2,
      pathCount: 24,
      hmm: {
        ...BASE_INPUTS.hmm,
        currentStateProbabilities: { bull: 1, bear: 0, sideways: 0 },
        transitionMatrix: {
          bull: { bull: 1, bear: 0, sideways: 0 },
          bear: { bull: 0, bear: 1, sideways: 0 },
          sideways: { bull: 0, bear: 0, sideways: 1 },
        },
      },
    });

    expect(result.sampleRegimePaths).toHaveLength(24);
    expect(result.sampleRegimePaths.every(
      (path) =>
        path.length === result.months.length &&
        path.every((regime) => regime === "bull"),
    )).toBe(true);
    expect(result.regimeOccupancy).toEqual({
      bull: 1,
      bear: 0,
      sideways: 0,
    });
    expect(result.metrics).toEqual(result.comparisonMetrics.hmm);
  });

  it("advances the HMM state before applying and recording the month's return", () => {
    const monthlyDoublingAnnualReturn = 12 * Math.log(2);
    const result = runSimulation({
      ...BASE_INPUTS,
      initialCapital: 100,
      monthlyContribution: 0,
      horizonYears: 1 / 12,
      stockAllocation: 1,
      model: "hmm",
      stocks: { expectedReturn: 0, volatility: 0 },
      bonds: { expectedReturn: 0, volatility: 0 },
      correlation: 0,
      rebalanceFrequency: "never",
      pathCount: 1,
      hmm: {
        regimes: {
          bull: {
            stocks: { expectedReturn: 0, volatility: 0 },
            bonds: { expectedReturn: 0, volatility: 0 },
            correlation: 0,
          },
          bear: {
            stocks: {
              expectedReturn: monthlyDoublingAnnualReturn,
              volatility: 0,
            },
            bonds: { expectedReturn: 0, volatility: 0 },
            correlation: 0,
          },
          sideways: {
            stocks: { expectedReturn: 0, volatility: 0 },
            bonds: { expectedReturn: 0, volatility: 0 },
            correlation: 0,
          },
        },
        currentStateProbabilities: { bull: 1, bear: 0, sideways: 0 },
        transitionMatrix: {
          bull: { bull: 0, bear: 1, sideways: 0 },
          bear: { bull: 0, bear: 1, sideways: 0 },
          sideways: { bull: 0, bear: 0, sideways: 1 },
        },
      },
    });

    expect(result.months).toEqual([0, 1]);
    expect(result.sampleRegimePaths[0]).toEqual(["bull", "bear"]);
    expect(result.samplePaths[0][0]).toBe(100);
    expect(result.samplePaths[0][1]).toBeCloseTo(200, 12);
  });

  it("applies returns before contributions and rebalances before the next month", () => {
    const monthlyDoublingAnnualReturn = 12 * Math.log(2);
    const result = runSimulation({
      ...BASE_INPUTS,
      initialCapital: 100,
      monthlyContribution: 30,
      horizonYears: 2 / 12,
      stockAllocation: 0.5,
      model: "constant",
      stocks: {
        expectedReturn: monthlyDoublingAnnualReturn,
        volatility: 0,
      },
      bonds: { expectedReturn: 0, volatility: 0 },
      correlation: 0,
      rebalanceFrequency: "monthly",
      inflationRate: 0,
      targetValue: 0,
      pathCount: 1,
    });

    /*
     * Opening holdings are 50/50. Month one applies returns (100/50), adds the
     * contribution (115/65), then rebalances to 90/90 and records 180. Month
     * two therefore starts from 90/90, reaches 270 after returns, adds 30, and
     * records 300 after rebalancing.
     */
    expect(result.months).toEqual([0, 1, 2]);
    expect(result.samplePaths[0]).toHaveLength(3);
    expect(result.samplePaths[0][0]).toBe(100);
    expect(result.samplePaths[0][1]).toBeCloseTo(180, 12);
    expect(result.samplePaths[0][2]).toBeCloseTo(300, 12);
    expect(result.terminalValues[0]).toBeCloseTo(300, 12);
  });

  it("records cash-flow-neutral drawdown after the month's market return", () => {
    const monthlyHalvingAnnualReturn = 12 * Math.log(0.5);
    const result = runSimulation({
      ...BASE_INPUTS,
      initialCapital: 100,
      monthlyContribution: 100,
      horizonYears: 1 / 12,
      stockAllocation: 1,
      model: "constant",
      stocks: {
        expectedReturn: monthlyHalvingAnnualReturn,
        volatility: 0,
      },
      bonds: { expectedReturn: 0, volatility: 0 },
      correlation: 0,
      rebalanceFrequency: "never",
      inflationRate: 0,
      targetValue: 0,
      pathCount: 1,
    });

    expect(result.samplePaths[0]).toEqual([100, 150]);
    expect(result.sampleDrawdownPaths[0][0]).toBe(0);
    expect(result.sampleDrawdownPaths[0][1]).toBeCloseTo(0.5, 12);
    expect(result.maxDrawdowns[0]).toBeCloseTo(0.5, 12);
  });

  it("returns both model summaries while exposing only selected-model paths", () => {
    const constant = runSimulation({
      ...BASE_INPUTS,
      model: "constant",
      horizonYears: 2,
      pathCount: 80,
    });
    const hmm = runSimulation({
      ...BASE_INPUTS,
      model: "hmm",
      horizonYears: 2,
      pathCount: 80,
    });

    expect(constant.sampleRegimePaths).toEqual([]);
    expect(constant.regimeOccupancy).toBeNull();
    expect(constant.metrics).toEqual(constant.comparisonMetrics.constant);
    expect(hmm.metrics).toEqual(hmm.comparisonMetrics.hmm);
    expect(hmm.comparisonMetrics.constant).toEqual(
      constant.comparisonMetrics.constant,
    );
    expect(hmm.comparisonMetrics.hmm).toEqual(
      constant.comparisonMetrics.hmm,
    );
  });

  it("runs one selected model through the portfolio-lab execution path", async () => {
    const inputs = {
      ...BASE_INPUTS,
      model: "constant" as const,
      horizonYears: 2,
      pathCount: 80,
    };
    const selected = await runSimulationCase(
      inputs,
      new AbortController().signal,
    );
    const combined = runSimulation(inputs);

    expect(selected.samplePaths).toEqual(combined.samplePaths);
    expect(selected.sampleDrawdownPaths).toEqual(
      combined.sampleDrawdownPaths,
    );
    expect(selected.metrics).toEqual(combined.comparisonMetrics.constant);
    expect("comparisonMetrics" in selected).toBe(false);
  });

  it("reports the average percentage gap among paths that miss the target", () => {
    const result = runSimulation({
      ...BASE_INPUTS,
      initialCapital: 100,
      monthlyContribution: 0,
      horizonYears: 1,
      stocks: { expectedReturn: 0, volatility: 0 },
      bonds: { expectedReturn: 0, volatility: 0 },
      targetValue: 200,
      pathCount: 10,
    });

    expect(result.metrics.probabilityOfTarget).toBe(0);
    expect(result.metrics.averageTargetShortfall).toBeCloseTo(0.5, 12);
  });

  it("rejects transition rows that do not sum to one", () => {
    expect(() =>
      runSimulation({
        ...BASE_INPUTS,
        model: "hmm",
        hmm: {
          ...BASE_INPUTS.hmm,
          transitionMatrix: {
            ...BASE_INPUTS.hmm.transitionMatrix,
            bear: { bull: 0.08, bear: 0.8, sideways: 0.05 },
          },
        },
      }),
    ).toThrow("hmm.transitionMatrix.bear probabilities must sum to 1");
  });

  it("applies portfolio-lab resource preflight before legacy execution", async () => {
    const oversizedInputs = {
      ...BASE_INPUTS,
      horizonYears: 1 / 12,
      pathCount: PORTFOLIO_LAB_LIMITS.paths + 1,
    };

    expect(() => runSimulation(oversizedInputs)).toThrow(
      /RESOURCE_LIMIT.*paths/i,
    );
    await expect(
      runSimulationCase(oversizedInputs, new AbortController().signal),
    ).rejects.toThrow(/RESOURCE_LIMIT.*paths/i);
  });

  it("preserves each path's shock prefix across horizons and path counts", () => {
    const shorter = runSimulation({
      ...BASE_INPUTS,
      horizonYears: 2,
      pathCount: 40,
      seed: 7_301,
    });
    const longerAndWider = runSimulation({
      ...BASE_INPUTS,
      horizonYears: 5,
      pathCount: 80,
      seed: 7_301,
    });

    for (let pathIndex = 0; pathIndex < shorter.samplePaths.length; pathIndex += 1) {
      expect(
        longerAndWider.samplePaths[pathIndex].slice(0, shorter.months.length),
      ).toEqual(shorter.samplePaths[pathIndex]);
    }
  });

  it("matches the monthly GBM recurrence when volatility is zero", () => {
    const inputs: SimulationInputs = {
      ...BASE_INPUTS,
      initialCapital: 10_000,
      monthlyContribution: 250,
      horizonYears: 1,
      stocks: { expectedReturn: 0.09, volatility: 0 },
      bonds: { expectedReturn: 0.03, volatility: 0 },
      stockAllocation: 0.6,
      rebalanceFrequency: "monthly",
      pathCount: 12,
    };

    const result = runSimulation(inputs);
    const stockGrowth = Math.exp(0.09 / 12);
    const bondGrowth = Math.exp(0.03 / 12);
    const portfolioGrowth = 0.6 * stockGrowth + 0.4 * bondGrowth;
    let expectedValue = inputs.initialCapital;

    for (let month = 1; month <= 12; month += 1) {
      expectedValue = expectedValue * portfolioGrowth + inputs.monthlyContribution;
      expect(result.pathPercentiles.p50[month]).toBeCloseTo(expectedValue, 8);
    }

    expect(new Set(result.terminalValues).size).toBe(1);
    expect(result.metrics.totalContributed).toBe(13_000);
  });

  it("keeps drawdown risk invariant when contributions change", () => {
    const withoutContributions = runSimulation({
      ...BASE_INPUTS,
      monthlyContribution: 0,
      horizonYears: 4,
      pathCount: 100,
      seed: 19_887,
    });
    const withContributions = runSimulation({
      ...BASE_INPUTS,
      monthlyContribution: 5_000,
      horizonYears: 4,
      pathCount: 100,
      seed: 19_887,
    });

    expect(withContributions.terminalValues).not.toEqual(
      withoutContributions.terminalValues,
    );
    expect(withContributions.sampleDrawdownPaths).toEqual(
      withoutContributions.sampleDrawdownPaths,
    );
    expect(withContributions.drawdownPercentiles).toEqual(
      withoutContributions.drawdownPercentiles,
    );
    expect(withContributions.maxDrawdowns).toEqual(
      withoutContributions.maxDrawdowns,
    );
    expect(withContributions.metrics.medianMaxDrawdown).toBe(
      withoutContributions.metrics.medianMaxDrawdown,
    );
    expect(withContributions.metrics.averageRecoveryMonths).toBe(
      withoutContributions.metrics.averageRecoveryMonths,
    );
    expect(withContributions.metrics.probabilityOfUnrecoveredDrawdown).toBe(
      withoutContributions.metrics.probabilityOfUnrecoveredDrawdown,
    );
  });

  it("distinguishes no drawdowns from unrecovered drawdowns", () => {
    const deterministicInputs: SimulationInputs = {
      ...BASE_INPUTS,
      initialCapital: 10_000,
      monthlyContribution: 500,
      horizonYears: 1,
      stockAllocation: 0.6,
      correlation: 0,
      rebalanceFrequency: "monthly",
      pathCount: 10,
    };
    const rising = runSimulation({
      ...deterministicInputs,
      stocks: { expectedReturn: 0.08, volatility: 0 },
      bonds: { expectedReturn: 0.03, volatility: 0 },
    });
    const falling = runSimulation({
      ...deterministicInputs,
      stocks: { expectedReturn: -0.2, volatility: 0 },
      bonds: { expectedReturn: -0.1, volatility: 0 },
    });

    expect(rising.maxDrawdowns).toEqual(Array(10).fill(0));
    expect(rising.sampleDrawdownPaths.flat()).toEqual(
      Array(rising.months.length * rising.inputs.pathCount).fill(0),
    );
    expect(rising.metrics.averageRecoveryMonths).toBeNull();
    expect(rising.metrics.probabilityOfUnrecoveredDrawdown).toBe(0);

    expect(falling.metrics.medianMaxDrawdown).toBeGreaterThan(0);
    expect(falling.metrics.averageRecoveryMonths).toBeNull();
    expect(falling.metrics.probabilityOfUnrecoveredDrawdown).toBe(1);
  });

  it("averages completed recoveries and reports open drawdowns separately", () => {
    const result = runSimulation({
      ...BASE_INPUTS,
      horizonYears: 3,
      pathCount: 50,
      seed: 42,
    });
    const completedRecoveryMonths = collectCompletedRecoveryMonths(
      result.sampleDrawdownPaths,
    );
    const pathsEndingUnderwater = result.sampleDrawdownPaths.filter(
      (path) => path.at(-1)! > 0,
    ).length;

    expect(completedRecoveryMonths.length).toBeGreaterThan(0);
    expect(pathsEndingUnderwater).toBeGreaterThan(0);
    expect(result.metrics.averageRecoveryMonths).toBeCloseTo(
      average(completedRecoveryMonths),
      12,
    );
    expect(result.metrics.probabilityOfUnrecoveredDrawdown).toBe(
      pathsEndingUnderwater / result.inputs.pathCount,
    );
  });

  it("keeps percentile bands ordered at every month", () => {
    const result = runSimulation({
      ...BASE_INPUTS,
      horizonYears: 3,
      pathCount: 400,
    });

    for (let month = 0; month < result.months.length; month += 1) {
      const pathValues = [
        result.pathPercentiles.p05[month],
        result.pathPercentiles.p10[month],
        result.pathPercentiles.p50[month],
        result.pathPercentiles.p90[month],
        result.pathPercentiles.p95[month],
      ];
      const drawdownValues = [
        result.drawdownPercentiles.p05[month],
        result.drawdownPercentiles.p10[month],
        result.drawdownPercentiles.p50[month],
        result.drawdownPercentiles.p90[month],
        result.drawdownPercentiles.p95[month],
      ];

      expect(pathValues).toEqual([...pathValues].sort((left, right) => left - right));
      expect(drawdownValues).toEqual(
        [...drawdownValues].sort((left, right) => left - right),
      );
    }
  });

  it("reports bounded probabilities and caps the render sample", () => {
    const result = runSimulation({
      ...BASE_INPUTS,
      horizonYears: 2,
      pathCount: 500,
    });

    expect(result.metrics.probabilityOfTarget).toBeGreaterThanOrEqual(0);
    expect(result.metrics.probabilityOfTarget).toBeLessThanOrEqual(1);
    expect(result.metrics.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(result.metrics.probabilityOfLoss).toBeLessThanOrEqual(1);
    expect(result.metrics.probabilityOfThirtyPercentDrawdown).toBeGreaterThanOrEqual(
      0,
    );
    expect(result.metrics.probabilityOfThirtyPercentDrawdown).toBeLessThanOrEqual(1);
    expect(result.metrics.probabilityOfUnrecoveredDrawdown).toBeGreaterThanOrEqual(
      0,
    );
    expect(result.metrics.probabilityOfUnrecoveredDrawdown).toBeLessThanOrEqual(1);
    expect(result.metrics.expectedShortfall).toBeGreaterThanOrEqual(0);
    expect(result.metrics.expectedShortfall).toBeLessThanOrEqual(1);
    expect(result.samplePaths).toHaveLength(160);
    expect(result.sampleDrawdownPaths).toHaveLength(160);
    expect(result.terminalValues).toHaveLength(500);
    expect(result.maxDrawdowns).toHaveLength(500);
  });

  it("shows lower terminal dispersion for negatively correlated assets", () => {
    const sharedInputs: SimulationInputs = {
      ...BASE_INPUTS,
      initialCapital: 100_000,
      monthlyContribution: 0,
      horizonYears: 5,
      stockAllocation: 0.5,
      stocks: { expectedReturn: 0.06, volatility: 0.2 },
      bonds: { expectedReturn: 0.06, volatility: 0.2 },
      rebalanceFrequency: "monthly",
      pathCount: 1_000,
      seed: 90210,
    };

    const positivelyCorrelated = runSimulation({
      ...sharedInputs,
      correlation: 1,
    });
    const negativelyCorrelated = runSimulation({
      ...sharedInputs,
      correlation: -1,
    });

    expect(standardDeviation(negativelyCorrelated.terminalValues)).toBeLessThan(
      standardDeviation(positivelyCorrelated.terminalValues) * 0.35,
    );
  });
});

function standardDeviation(values: number[]): number {
  const valuesMean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

function collectCompletedRecoveryMonths(paths: number[][]): number[] {
  return paths.flatMap((path) => {
    const completedRecoveryMonths: number[] = [];
    let underwaterSince: number | null = null;

    for (let month = 1; month < path.length; month += 1) {
      if (path[month] > 0) {
        underwaterSince ??= month - 1;
      } else if (underwaterSince !== null) {
        completedRecoveryMonths.push(month - underwaterSince);
        underwaterSince = null;
      }
    }

    return completedRecoveryMonths;
  });
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
