import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type DrawdownRatioSeries,
  type NominalWealthSeries,
  type PortfolioCaseDetail,
  type PortfolioLabProblem,
  type PortfolioLabRequest,
  type PortfolioLabResult,
  type PortfolioLabRunner,
  type PortfolioMetrics,
} from "./contracts";

const MARKET_ASSUMPTIONS = {
  stocks: { annualDrift: 0.08, annualVolatility: 0.18 },
  bonds: { annualDrift: 0.04, annualVolatility: 0.07 },
  correlation: 0.15,
} as const;

const STANDARD_CASE_ID = asPortfolioCaseId("standard");
const REGIMES_CASE_ID = asPortfolioCaseId("regimes");

const REQUEST = {
  contract: PORTFOLIO_LAB_CONTRACT.request,
  plan: {
    initialCapital: 50_000,
    contributionPerStep: 1_000,
    targetWeights: { stocks: 0.7, bonds: 0.3 },
    rebalance: { kind: "periodic", everySteps: 12 },
    annualInflationRate: 0.025,
    targetValue: 1_000_000,
  },
  primaryCaseId: REGIMES_CASE_ID,
  cases: [
    {
      id: STANDARD_CASE_ID,
      label: "Standard Monte Carlo",
      model: {
        contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
        kind: "gbm",
        market: MARKET_ASSUMPTIONS,
      },
    },
    {
      id: REGIMES_CASE_ID,
      label: "Regime switching",
      model: {
        contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
        kind: "hmm",
        regimes: {
          bull: MARKET_ASSUMPTIONS,
          bear: MARKET_ASSUMPTIONS,
          sideways: MARKET_ASSUMPTIONS,
        },
        transitionMatrix: {
          bull: { bull: 0.9, bear: 0.05, sideways: 0.05 },
          bear: { bull: 0.1, bear: 0.8, sideways: 0.1 },
          sideways: { bull: 0.2, bear: 0.1, sideways: 0.7 },
        },
        initialStateProbabilities: {
          bull: 0.5,
          bear: 0.2,
          sideways: 0.3,
        },
      },
    },
  ],
  execution: {
    seed: 8_291,
    paths: 1_000,
    steps: 2,
    stepYears: 1 / 12,
  },
} as const satisfies PortfolioLabRequest;

const METRICS: PortfolioMetrics = {
  wealth: {
    medianTerminalValue: 53_000,
    meanTerminalValue: 53_100,
    medianRealTerminalValue: 52_800,
    totalContributed: 52_000,
  },
  goal: {
    probabilityOfTarget: 0.1,
    averageShortfallRatio: 0.4,
  },
  loss: {
    probabilityBelowContributions: 0.2,
    tailCapitalShortfall: 0.05,
  },
  drawdown: {
    medianMaximumDrawdown: 0.08,
    probabilityOverThirtyPercent: 0.01,
    probabilityUnrecovered: 0.2,
    averageCompletedRecoverySteps: 1.5,
  },
};

const RESULT: PortfolioLabResult = {
  contract: PORTFOLIO_LAB_CONTRACT.result,
  primary: {
    id: REGIMES_CASE_ID,
    label: "Regime switching",
    model: "hmm",
    modelContract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
    metrics: METRICS,
    samples: [
      {
        pathIndex: 4,
        wealth: nominalWealth([50_000, 51_200, 53_000]),
        drawdown: drawdownRatios([0, 0, 0.02]),
      },
    ],
    distribution: {
      terminalWealth: nominalWealth([49_000, 53_000, 60_000]),
      maximumDrawdowns: drawdownRatios([0.04, 0.08, 0.12]),
      wealthPercentiles: {
        p05: nominalWealth([50_000, 49_500, 49_000]),
        p10: nominalWealth([50_000, 50_000, 50_200]),
        p50: nominalWealth([50_000, 51_200, 53_000]),
        p90: nominalWealth([50_000, 52_000, 58_000]),
        p95: nominalWealth([50_000, 52_400, 60_000]),
      },
      drawdownPercentiles: {
        p05: drawdownRatios([0, 0, 0]),
        p10: drawdownRatios([0, 0, 0]),
        p50: drawdownRatios([0, 0, 0.02]),
        p90: drawdownRatios([0, 0.04, 0.08]),
        p95: drawdownRatios([0, 0.06, 0.12]),
      },
    },
    diagnostics: {
      contract: PORTFOLIO_LAB_CONTRACT.hmmDiagnostics,
      kind: "hmm",
      regimeOccupancy: { bull: 0.5, bear: 0.2, sideways: 0.3 },
      sampledStatePaths: [
        {
          pathIndex: 4,
          states: ["bull", "bull", "bear"],
        },
      ],
    },
  },
  comparisons: [
    {
      id: STANDARD_CASE_ID,
      label: "Standard Monte Carlo",
      model: "gbm",
      modelContract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
      metrics: METRICS,
    },
  ],
  warnings: [
    {
      contract: PORTFOLIO_LAB_CONTRACT.warning,
      code: "STATISTICAL_PRECISION",
      scope: { kind: "request" },
      message: "The configured path count may produce wide intervals.",
    },
  ],
  provenance: {
    contract: PORTFOLIO_LAB_CONTRACT.provenance,
    requestContract: PORTFOLIO_LAB_CONTRACT.request,
    engineVersion: "portfolio-lab-engine@1",
    randomStreamVersion: "semantic-keyed-streams@1",
    eventOrderVersion: "market-cashflow-rebalance-record@1",
    quantileMethod: "linear-r7",
    seed: 8_291,
    timeGrid: {
      steps: 2,
      stepYears: 1 / 12,
    },
    selectedPathIndexes: [4],
  },
};

describe("portfolio-lab contracts", () => {
  it("use stable version tags at the public seam", () => {
    expect(PORTFOLIO_LAB_CONTRACT).toEqual({
      request: "portfolio-lab/request@1",
      result: "portfolio-lab/result@1",
      warning: "portfolio-lab/warning@1",
      problem: "portfolio-lab/problem@1",
      provenance: "portfolio-lab/provenance@1",
      gbmDiagnostics: "portfolio-lab/diagnostics/gbm@1",
      hmmDiagnostics: "portfolio-lab/diagnostics/hmm@1",
    });
    expect(PORTFOLIO_LAB_MODEL_CONTRACT).toEqual({
      gbm: "portfolio-lab/model/gbm@1",
      hmm: "portfolio-lab/model/hmm@1",
    });
  });

  it("keeps request and result records structured-clone safe", () => {
    expect(structuredClone(REQUEST)).toEqual(REQUEST);
    expect(structuredClone(RESULT)).toEqual(RESULT);
  });

  it("keeps wealth and drawdown series semantically distinct", () => {
    expectTypeOf<NominalWealthSeries>().not.toEqualTypeOf<DrawdownRatioSeries>();
    expect(RESULT.primary.samples[0].wealth.kind).toBe("nominal-wealth");
    expect(RESULT.primary.samples[0].drawdown.kind).toBe("drawdown-ratio");
  });

  it("keeps HMM diagnostics behind the primary detail discriminant", () => {
    expect(countSampledStatePaths(RESULT.primary)).toBe(1);
    expect(RESULT.comparisons).toHaveLength(1);
    expect("diagnostics" in RESULT.comparisons[0]).toBe(false);
  });

  it("exposes one cancellable runner operation", async () => {
    const cancel = vi.fn();
    const runner: PortfolioLabRunner = {
      run(request) {
        expect(request).toEqual(REQUEST);
        return {
          outcome: Promise.resolve({ ok: true, result: RESULT }),
          cancel,
        };
      },
    };

    const run = runner.run(REQUEST);
    expect(await run.outcome).toEqual({ ok: true, result: RESULT });
    run.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns failures as versioned, clone-safe problems", async () => {
    const problem = {
      contract: PORTFOLIO_LAB_CONTRACT.problem,
      code: "INVALID_REQUEST",
      message: "The request contains invalid values.",
      issues: [
        {
          code: "OUT_OF_RANGE",
          path: ["cases", 0, "model", "market", "correlation"],
          message: "Correlation must be between -1 and 1.",
        },
      ],
    } as const satisfies PortfolioLabProblem;
    const runner: PortfolioLabRunner = {
      run: () => ({
        outcome: Promise.resolve({ ok: false, problem }),
        cancel: vi.fn(),
      }),
    };

    expect(structuredClone(problem)).toEqual(problem);
    expect(await runner.run(REQUEST).outcome).toEqual({
      ok: false,
      problem,
    });
  });

  it("reports unsupported nested contract versions with negotiation details", () => {
    const problem = {
      contract: PORTFOLIO_LAB_CONTRACT.problem,
      code: "UNSUPPORTED_CONTRACT",
      message: "The requested model contract is not supported.",
      path: ["cases", 1, "model", "contract"],
      receivedContract: "portfolio-lab/model/hmm@2",
      supportedContracts: [
        PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
        PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
      ],
    } as const satisfies PortfolioLabProblem;

    expect(structuredClone(problem)).toEqual(problem);
  });
});

function countSampledStatePaths(detail: PortfolioCaseDetail): number {
  if (detail.model === "hmm") {
    return detail.diagnostics.sampledStatePaths.length;
  }

  return 0;
}

function nominalWealth(values: readonly number[]): NominalWealthSeries {
  return { kind: "nominal-wealth", values };
}

function drawdownRatios(values: readonly number[]): DrawdownRatioSeries {
  return { kind: "drawdown-ratio", values };
}
