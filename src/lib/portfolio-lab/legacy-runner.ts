import type {
  PercentileSeries as LegacyPercentileSeries,
  SimulationInputs,
  SimulationMetrics,
  SimulationResult,
} from "../../types/simulation";
import { runSimulation } from "../simulation";
import {
  PORTFOLIO_LAB_CONTRACT,
  type CancelledProblem,
  type DrawdownRatioSeries,
  type GbmCaseDetail,
  type GbmCaseSummary,
  type HmmCaseDetail,
  type HmmCaseSummary,
  type InvalidRequestProblem,
  type MarketCase,
  type NominalWealthSeries,
  type PercentileSeries,
  type PortfolioCaseDetail,
  type PortfolioCaseSummary,
  type PortfolioLabIssue,
  type PortfolioLabOutcome,
  type PortfolioLabRequest,
  type PortfolioLabResult,
  type PortfolioLabRunner,
  type PortfolioMetrics,
} from "./contracts";

const LEGACY_STEP_YEARS = 1 / 12;
const MAX_SAMPLE_PATHS = 160;

interface ExecutedCase {
  readonly requestCase: MarketCase;
  readonly legacyResult: SimulationResult;
}

export function createLegacyPortfolioLabRunner(): PortfolioLabRunner {
  return {
    run(request) {
      let cancelled = false;
      const outcome: Promise<PortfolioLabOutcome> = Promise.resolve().then(
        () => {
          if (cancelled) {
            return { ok: false, problem: cancelledProblem() };
          }

          return executeRequest(request);
        },
      );

      return {
        outcome,
        cancel() {
          cancelled = true;
        },
      };
    },
  };
}

function executeRequest(request: PortfolioLabRequest): PortfolioLabOutcome {
  const problem = validateRequest(request);
  if (problem) {
    return { ok: false, problem };
  }

  try {
    const executedCases = request.cases.map((requestCase) => ({
      requestCase,
      legacyResult: runSimulation(toLegacyInputs(request, requestCase)),
    }));
    const primary = executedCases.find(
      ({ requestCase }) => requestCase.id === request.primaryCaseId,
    )!;

    return {
      ok: true,
      result: buildResult(request, primary, executedCases),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The request is invalid.";

    return {
      ok: false,
      problem: invalidRequestProblem({
        code: "OUT_OF_RANGE",
        path: [],
        message,
      }),
    };
  }
}

function validateRequest(
  request: PortfolioLabRequest,
): InvalidRequestProblem | null {
  if (request.cases.length === 0) {
    return invalidRequestProblem({
      code: "MISSING",
      path: ["cases"],
      message: "At least one market case is required.",
    });
  }

  const caseIds = new Set(request.cases.map(({ id }) => id));
  if (caseIds.size !== request.cases.length) {
    return invalidRequestProblem({
      code: "DUPLICATE_ID",
      path: ["cases"],
      message: "Market case IDs must be unique.",
    });
  }

  if (!caseIds.has(request.primaryCaseId)) {
    return invalidRequestProblem({
      code: "INVALID_REFERENCE",
      path: ["primaryCaseId"],
      message: "The primary case ID must reference a case.",
    });
  }

  if (Math.abs(request.execution.stepYears - LEGACY_STEP_YEARS) > 1e-12) {
    return invalidRequestProblem({
      code: "OUT_OF_RANGE",
      path: ["execution", "stepYears"],
      message: "The legacy adapter supports monthly time steps only.",
    });
  }

  return null;
}

function invalidRequestProblem(
  issue: PortfolioLabIssue,
): InvalidRequestProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "INVALID_REQUEST",
    message: issue.message,
    issues: [issue],
  };
}

function cancelledProblem(): CancelledProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "CANCELLED",
    message: "The portfolio-lab run was cancelled.",
  };
}

function toLegacyInputs(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
): SimulationInputs {
  const referenceMarket =
    requestCase.model.kind === "gbm"
      ? requestCase.model.market
      : requestCase.model.regimes.bull;

  return {
    initialCapital: request.plan.initialCapital,
    monthlyContribution: request.plan.contributionPerStep,
    horizonYears: request.execution.steps * request.execution.stepYears,
    stockAllocation: request.plan.targetWeights.stocks,
    model: requestCase.model.kind === "gbm" ? "constant" : "hmm",
    stocks: toLegacyAsset(referenceMarket.stocks),
    bonds: toLegacyAsset(referenceMarket.bonds),
    correlation: referenceMarket.correlation,
    hmm: toLegacyHmm(requestCase),
    rebalanceFrequency: toLegacyRebalance(request.plan.rebalance),
    inflationRate: request.plan.annualInflationRate,
    targetValue: request.plan.targetValue,
    pathCount: request.execution.paths,
    seed: request.execution.seed,
  };
}

function toLegacyAsset(assumptions: {
  readonly annualDrift: number;
  readonly annualVolatility: number;
}) {
  return {
    expectedReturn: assumptions.annualDrift,
    volatility: assumptions.annualVolatility,
  };
}

function toLegacyHmm(requestCase: MarketCase): SimulationInputs["hmm"] {
  if (requestCase.model.kind === "hmm") {
    return {
      regimes: {
        bull: toLegacyMarket(requestCase.model.regimes.bull),
        bear: toLegacyMarket(requestCase.model.regimes.bear),
        sideways: toLegacyMarket(requestCase.model.regimes.sideways),
      },
      transitionMatrix: requestCase.model.transitionMatrix,
      currentStateProbabilities: requestCase.model.initialStateProbabilities,
    };
  }

  const market = toLegacyMarket(requestCase.model.market);
  return {
    regimes: { bull: market, bear: market, sideways: market },
    transitionMatrix: {
      bull: { bull: 1, bear: 0, sideways: 0 },
      bear: { bull: 0, bear: 1, sideways: 0 },
      sideways: { bull: 0, bear: 0, sideways: 1 },
    },
    currentStateProbabilities: { bull: 1, bear: 0, sideways: 0 },
  };
}

function toLegacyMarket(
  market: Extract<MarketCase["model"], { kind: "gbm" }>["market"],
) {
  return {
    stocks: toLegacyAsset(market.stocks),
    bonds: toLegacyAsset(market.bonds),
    correlation: market.correlation,
  };
}

function toLegacyRebalance(
  rebalance: PortfolioLabRequest["plan"]["rebalance"],
): SimulationInputs["rebalanceFrequency"] {
  if (rebalance.kind === "never") {
    return "never";
  }

  if (rebalance.everySteps === 1) {
    return "monthly";
  }

  if (rebalance.everySteps === 12) {
    return "annual";
  }

  throw new Error(
    "The legacy adapter supports one-step, twelve-step, or no rebalancing.",
  );
}

function buildResult(
  request: PortfolioLabRequest,
  primary: ExecutedCase,
  executedCases: readonly ExecutedCase[],
): PortfolioLabResult {
  const selectedPathIndexes = selectSampleIndexes(request.execution.paths);

  return {
    contract: PORTFOLIO_LAB_CONTRACT.result,
    primary: toDetail(primary, selectedPathIndexes),
    comparisons: executedCases
      .filter(({ requestCase }) => requestCase.id !== request.primaryCaseId)
      .map(toSummary),
    warnings: [],
    provenance: {
      contract: PORTFOLIO_LAB_CONTRACT.provenance,
      requestContract: PORTFOLIO_LAB_CONTRACT.request,
      engineVersion: "legacy-portfolio-simulation@1",
      randomStreamVersion: "legacy-path-streams@1",
      eventOrderVersion: "market-cashflow-rebalance-record@1",
      quantileMethod: "linear-r7",
      seed: request.execution.seed,
      timeGrid: {
        steps: request.execution.steps,
        stepYears: request.execution.stepYears,
      },
      selectedPathIndexes,
    },
  };
}

function toSummary(executed: ExecutedCase): PortfolioCaseSummary {
  const { requestCase, legacyResult } = executed;
  const shared = {
    id: requestCase.id,
    label: requestCase.label,
    metrics: toMetrics(legacyResult.metrics),
  };

  if (requestCase.model.kind === "gbm") {
    return {
      ...shared,
      model: "gbm",
      modelContract: requestCase.model.contract,
    } satisfies GbmCaseSummary;
  }

  return {
    ...shared,
    model: "hmm",
    modelContract: requestCase.model.contract,
  } satisfies HmmCaseSummary;
}

function toDetail(
  executed: ExecutedCase,
  selectedPathIndexes: readonly number[],
): PortfolioCaseDetail {
  const { requestCase, legacyResult } = executed;
  const shared = {
    id: requestCase.id,
    label: requestCase.label,
    metrics: toMetrics(legacyResult.metrics),
    samples: legacyResult.samplePaths.map((wealth, sampleIndex) => ({
      pathIndex: selectedPathIndexes[sampleIndex],
      wealth: nominalWealth(wealth),
      drawdown: drawdownRatios(
        legacyResult.sampleDrawdownPaths[sampleIndex],
      ),
    })),
    distribution: {
      terminalWealth: nominalWealth(legacyResult.terminalValues),
      maximumDrawdowns: drawdownRatios(legacyResult.maxDrawdowns),
      wealthPercentiles: nominalPercentiles(legacyResult.pathPercentiles),
      drawdownPercentiles: drawdownPercentiles(
        legacyResult.drawdownPercentiles,
      ),
    },
  };

  if (requestCase.model.kind === "gbm") {
    return {
      ...shared,
      model: "gbm",
      modelContract: requestCase.model.contract,
      diagnostics: {
        contract: PORTFOLIO_LAB_CONTRACT.gbmDiagnostics,
        kind: "gbm",
      },
    } satisfies GbmCaseDetail;
  }

  if (!legacyResult.regimeOccupancy) {
    throw new Error("The legacy HMM result is missing regime diagnostics.");
  }

  return {
    ...shared,
    model: "hmm",
    modelContract: requestCase.model.contract,
    diagnostics: {
      contract: PORTFOLIO_LAB_CONTRACT.hmmDiagnostics,
      kind: "hmm",
      regimeOccupancy: legacyResult.regimeOccupancy,
      sampledStatePaths: legacyResult.sampleRegimePaths.map(
        (states, sampleIndex) => ({
          pathIndex: selectedPathIndexes[sampleIndex],
          states,
        }),
      ),
    },
  } satisfies HmmCaseDetail;
}

function toMetrics(metrics: SimulationMetrics): PortfolioMetrics {
  return {
    wealth: {
      medianTerminalValue: metrics.medianTerminalValue,
      meanTerminalValue: metrics.meanTerminalValue,
      medianRealTerminalValue: metrics.medianRealValue,
      totalContributed: metrics.totalContributed,
    },
    goal: {
      probabilityOfTarget: metrics.probabilityOfTarget,
      averageShortfallRatio: metrics.averageTargetShortfall,
    },
    loss: {
      probabilityBelowContributions: metrics.probabilityOfLoss,
      tailCapitalShortfall: metrics.expectedShortfall,
    },
    drawdown: {
      medianMaximumDrawdown: metrics.medianMaxDrawdown,
      probabilityOverThirtyPercent:
        metrics.probabilityOfThirtyPercentDrawdown,
      probabilityUnrecovered: metrics.probabilityOfUnrecoveredDrawdown,
      averageCompletedRecoverySteps: metrics.averageRecoveryMonths,
    },
  };
}

function nominalWealth(values: readonly number[]): NominalWealthSeries {
  return { kind: "nominal-wealth", values };
}

function drawdownRatios(values: readonly number[]): DrawdownRatioSeries {
  return { kind: "drawdown-ratio", values };
}

function nominalPercentiles(
  percentiles: LegacyPercentileSeries,
): PercentileSeries<NominalWealthSeries> {
  return {
    p05: nominalWealth(percentiles.p05),
    p10: nominalWealth(percentiles.p10),
    p50: nominalWealth(percentiles.p50),
    p90: nominalWealth(percentiles.p90),
    p95: nominalWealth(percentiles.p95),
  };
}

function drawdownPercentiles(
  percentiles: LegacyPercentileSeries,
): PercentileSeries<DrawdownRatioSeries> {
  return {
    p05: drawdownRatios(percentiles.p05),
    p10: drawdownRatios(percentiles.p10),
    p50: drawdownRatios(percentiles.p50),
    p90: drawdownRatios(percentiles.p90),
    p95: drawdownRatios(percentiles.p95),
  };
}

function selectSampleIndexes(pathCount: number): number[] {
  if (pathCount <= MAX_SAMPLE_PATHS) {
    return Array.from({ length: pathCount }, (_, index) => index);
  }

  return Array.from({ length: MAX_SAMPLE_PATHS }, (_, sampleIndex) => {
    return Math.round(
      (sampleIndex * (pathCount - 1)) / (MAX_SAMPLE_PATHS - 1),
    );
  });
}
