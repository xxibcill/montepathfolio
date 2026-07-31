import { describe, expect, it } from "vitest";
import { mean, quantile } from "../quant/core";
import {
  PORTFOLIO_LAB_V2_CONTRACT,
  PORTFOLIO_LAB_V2_MODEL_CONTRACT,
  type PortfolioLabV2Case,
  type PortfolioLabV2GarchModel,
  type PortfolioLabV2GbmModel,
  type PortfolioLabV2JumpModel,
  type PortfolioLabV2Request,
  type PortfolioLabV2Result,
} from "./advanced-contracts";
import {
  preflightPortfolioLabV2Request,
  runPortfolioLabV2,
} from "./advanced-runner";

const GBM: PortfolioLabV2GbmModel = {
  contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.gbm,
  kind: "gbm",
  assets: [
    { assetId: "stocks", annualDrift: 0.07, annualVolatility: 0.2 },
    { assetId: "bonds", annualDrift: 0.03, annualVolatility: 0.08 },
  ],
  correlation: [
    [1, 0.2],
    [0.2, 1],
  ],
};

const ZERO_JUMP: PortfolioLabV2JumpModel = {
  contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.jumpDiffusion,
  kind: "jumpDiffusion",
  assets: GBM.assets.map((asset) => ({
    ...asset,
    jump: {
      annualIntensity: 0,
      meanLogJump: -0.2,
      logJumpVolatility: 0.12,
    },
  })),
  correlation: GBM.correlation,
};

const CONSTANT_GARCH: PortfolioLabV2GarchModel = {
  contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.garch,
  kind: "garch",
  assets: GBM.assets.map((asset) => ({
    assetId: asset.assetId,
    annualDrift: asset.annualDrift,
    variance: {
      omega: asset.annualVolatility ** 2,
      alpha: 0,
      beta: 0,
      initialVariance: asset.annualVolatility ** 2,
    },
  })),
  correlation: GBM.correlation,
  innovation: { kind: "gaussian" },
};

const ACTIVE_JUMP: PortfolioLabV2JumpModel = {
  ...ZERO_JUMP,
  assets: ZERO_JUMP.assets.map((asset, assetIndex) => ({
    ...asset,
    jump: {
      annualIntensity: assetIndex === 0 ? 0.8 : 0.2,
      meanLogJump: -0.16,
      logJumpVolatility: 0.1,
    },
  })),
};

function marketCase(
  id: string,
  model: PortfolioLabV2Case["model"],
): PortfolioLabV2Case {
  return { id, label: id.toUpperCase(), model };
}

function request(
  cases: readonly PortfolioLabV2Case[],
  primaryCaseId = cases[0].id,
  overrides: Partial<PortfolioLabV2Request["execution"]> = {},
): PortfolioLabV2Request {
  return {
    contract: PORTFOLIO_LAB_V2_CONTRACT.request,
    plan: {
      initialCapital: 100_000,
      contributionPerStep: 500,
      withdrawalPerStep: 0,
      allocation: [
        { assetId: "stocks", targetWeight: 0.65 },
        { assetId: "bonds", targetWeight: 0.35 },
      ],
      rebalance: { kind: "periodic", everySteps: 3 },
      annualInflationRate: 0.02,
      targetValue: 130_000,
    },
    primaryCaseId,
    cases,
    risk: { confidenceLevel: 0.95 },
    execution: {
      seed: 91,
      paths: 240,
      steps: 18,
      stepYears: 1 / 12,
      samplePaths: 12,
      ...overrides,
    },
  };
}

function requireResult(input: PortfolioLabV2Request): PortfolioLabV2Result {
  const outcome = runPortfolioLabV2(input);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.problem.message);
  return outcome.result;
}

describe("native Portfolio Projection Lab request@2", () => {
  it("leaves the frozen request@1 version unsupported instead of adapting it", () => {
    const problem = preflightPortfolioLabV2Request({
      contract: "portfolio-lab/request@1",
    });
    expect(problem).toMatchObject({
      contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
      code: "UNSUPPORTED_CONTRACT",
      supportedContracts: [PORTFOLIO_LAB_V2_CONTRACT.request],
    });
  });

  it("reproduces GBM path for path when jump intensity is zero", () => {
    const cases = [marketCase("gbm", GBM), marketCase("jump", ZERO_JUMP)];
    const gbm = requireResult(request(cases, "gbm"));
    const jump = requireResult(request(cases, "jump"));

    expect(jump.primary.samples).toEqual(gbm.primary.samples);
    expect(jump.primary.distribution).toEqual(gbm.primary.distribution);
    expect(jump.primary.metrics).toEqual(gbm.primary.metrics);
    expect(jump.primary.diagnostics).toMatchObject({
      kind: "jumpDiffusion",
      empiricalAnnualJumpCounts: [0, 0],
      probabilityOfAnyCrash: 0,
      jumpConditionedMeanMaximumDrawdown: null,
      sampledJumpEvents: [],
    });
  });

  it("is deterministic and preserves existing path and horizon prefixes", () => {
    const cases = [marketCase("jump", ACTIVE_JUMP)];
    const shortInput = request(cases, "jump", {
      paths: 80,
      steps: 8,
      samplePaths: 80,
    });
    const short = requireResult(shortInput);
    expect(runPortfolioLabV2(structuredClone(shortInput))).toEqual(
      runPortfolioLabV2(shortInput),
    );

    const morePaths = requireResult(
      request(cases, "jump", {
        paths: 120,
        steps: 8,
        samplePaths: 120,
      }),
    );
    expect(morePaths.primary.samples.slice(0, 80)).toEqual(short.primary.samples);

    const longer = requireResult(
      request(cases, "jump", {
        paths: 80,
        steps: 14,
        samplePaths: 80,
      }),
    );
    longer.primary.samples.forEach((sample, pathIndex) => {
      expect(sample.wealth.slice(0, 9)).toEqual(
        short.primary.samples[pathIndex].wealth,
      );
      expect(sample.holdings.map((holding) => holding.values.slice(0, 9))).toEqual(
        short.primary.samples[pathIndex].holdings.map((holding) => holding.values),
      );
    });
  });

  it("reproduces constant-volatility GBM when alpha and beta are zero", () => {
    const cases = [
      marketCase("gbm", GBM),
      marketCase("garch", CONSTANT_GARCH),
    ];
    const gbm = requireResult(request(cases, "gbm"));
    const garch = requireResult(request(cases, "garch"));

    expect(garch.primary.samples).toEqual(gbm.primary.samples);
    expect(garch.primary.distribution).toEqual(gbm.primary.distribution);
    expect(garch.primary.metrics).toEqual(gbm.primary.metrics);
    expect(garch.primary.diagnostics).toMatchObject({
      kind: "garch",
      persistence: [0, 0],
      unconditionalVariance: [0.2 ** 2, 0.08 ** 2],
    });
  });

  it("preserves case results when cases are reordered or another case is added", () => {
    const gbmCase = marketCase("gbm", GBM);
    const jumpCase = marketCase("jump", ACTIVE_JUMP);
    const garchCase = marketCase("garch", CONSTANT_GARCH);
    const baseline = requireResult(request([gbmCase, jumpCase], "gbm"));
    const reordered = requireResult(request([jumpCase, gbmCase], "gbm"));
    const extended = requireResult(
      request([garchCase, gbmCase, jumpCase], "gbm"),
    );

    expect(reordered.primary).toEqual(baseline.primary);
    expect(extended.primary).toEqual(baseline.primary);
    const baselineJump = baseline.comparisons.find(({ id }) => id === "jump");
    const reorderedJump = reordered.comparisons.find(({ id }) => id === "jump");
    const extendedJump = extended.comparisons.find(({ id }) => id === "jump");
    expect(reorderedJump).toEqual(baselineJump);
    expect(extendedJump).toEqual(baselineJump);
    expect(extended.comparisons.map(({ id }) => id)).toEqual(["garch", "jump"]);
  });

  it("reconciles generalized holdings, both cash-flow directions, and wealth", () => {
    const deterministic: PortfolioLabV2GbmModel = {
      ...GBM,
      assets: GBM.assets.map((asset) => ({
        ...asset,
        annualDrift: 0,
        annualVolatility: 0,
      })),
    };
    const input = request([marketCase("cashflows", deterministic)], "cashflows", {
      paths: 2,
      steps: 3,
      samplePaths: 2,
    });
    const configured: PortfolioLabV2Request = {
      ...input,
      plan: {
        ...input.plan,
        initialCapital: 1_000,
        contributionPerStep: 100,
        withdrawalPerStep: 40,
        annualInflationRate: 0,
        targetValue: 1_180,
      },
    };
    const result = requireResult(configured);

    expect(result.primary.samples[0].wealth).toEqual([1_000, 1_060, 1_120, 1_180]);
    expect(result.primary.samples[0].totalWithdrawn).toBe(120);
    result.primary.samples.forEach((sample) => {
      sample.wealth.forEach((wealth, stepIndex) => {
        const holdings = sample.holdings.reduce(
          (total, holding) => total + holding.values[stepIndex],
          0,
        );
        expect(holdings).toBeCloseTo(wealth, 10);
      });
      expect(sample.drawdown).toEqual([0, 0, 0, 0]);
    });
    expect(result.primary.metrics.wealth).toMatchObject({
      totalContributed: 1_300,
      meanTotalWithdrawn: 120,
      medianTerminalValue: 1_180,
    });
    expect(result.primary.distribution.terminalEconomicLosses).toEqual([0, 0]);
  });

  it("reports standard terminal-loss VaR and CVaR beside the capital-relative measure", () => {
    const result = requireResult(
      request([marketCase("jump", ACTIVE_JUMP)], "jump", {
        paths: 800,
        steps: 24,
      }),
    );
    const losses = result.primary.distribution.terminalEconomicLosses;
    const expectedVar = Math.max(0, quantile(losses, 0.95));
    const tail = losses.filter((loss) => loss >= expectedVar);

    expect(result.primary.metrics.risk.valueAtRisk).toBeCloseTo(expectedVar, 10);
    expect(result.primary.metrics.risk.conditionalValueAtRisk).toBeCloseTo(
      tail.length === 0 ? expectedVar : Math.max(expectedVar, mean(tail)),
      10,
    );
    expect(result.primary.metrics.risk.conditionalValueAtRisk).toBeGreaterThanOrEqual(
      result.primary.metrics.risk.valueAtRisk,
    );
    expect(result.primary.metrics.risk.lossConvention).toBe(
      "positive-terminal-economic-loss",
    );
    expect(result.primary.metrics.loss.tailCapitalShortfall).toBeGreaterThanOrEqual(0);
  });

  it("runs only requested cases and keeps composite diagnostics discriminated", () => {
    const composite: PortfolioLabV2Case["model"] = {
      contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.composite,
      kind: "composite",
      baseAssets: GBM.assets,
      regimes: {
        labels: ["bear", "bull"],
        initialProbabilities: [0.35, 0.65],
        transitionMatrix: [
          [0.8, 0.2],
          [0.1, 0.9],
        ],
        annualDrifts: [
          [-0.08, 0.02],
          [0.12, 0.04],
        ],
      },
      garch: [
        { omega: 0.004, alpha: 0.08, beta: 0.82, initialVariance: "unconditional" },
        { omega: 0.001, alpha: 0.05, beta: 0.75, initialVariance: "unconditional" },
      ],
      copula: {
        correlation: GBM.correlation,
        innovation: { kind: "student-t", degreesOfFreedom: 7 },
      },
      jumps: ACTIVE_JUMP.assets.map((asset) => asset.jump),
      enabled: {
        regimes: true,
        dynamicVariance: true,
        dependence: true,
        jumps: true,
      },
    };
    const result = requireResult(
      request([marketCase("composite", composite)], "composite", {
        paths: 120,
        steps: 10,
      }),
    );

    expect(result.comparisons).toEqual([]);
    expect(result.provenance.requestedCaseIds).toEqual(["composite"]);
    expect(result.primary.diagnostics).toMatchObject({
      kind: "composite",
      updateOrder: "hmm->garch->copula->jump->portfolio",
      enabled: composite.enabled,
    });
    if (result.primary.diagnostics.kind !== "composite") {
      throw new Error("Expected composite diagnostics");
    }
    expect(
      result.primary.diagnostics.regimeOccupancy.reduce(
        (total, value) => total + value,
        0,
      ),
    ).toBeCloseTo(1, 12);
    expect(() => structuredClone(result)).not.toThrow();
  });

  it("rejects invalid matrices and resource excess before simulation", () => {
    const invalid = request([
      marketCase("invalid", {
        ...GBM,
        correlation: [
          [1, 1.2],
          [1.2, 1],
        ],
      }),
    ]);
    expect(runPortfolioLabV2(invalid)).toMatchObject({
      ok: false,
      problem: {
        contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
        code: "INVALID_REQUEST",
      },
    });

    const oversized = request([marketCase("gbm", GBM)], "gbm", {
      paths: 10_000,
      steps: 1_200,
      samplePaths: 1,
    });
    expect(runPortfolioLabV2(oversized)).toMatchObject({
      ok: false,
      problem: {
        contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
        code: "RESOURCE_LIMIT",
        resource: "PATH_STEPS",
        requested: 24_000_000,
        limit: 5_000_000,
      },
    });
  });
});
