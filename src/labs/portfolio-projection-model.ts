import type {
  PortfolioProjectionInputs,
  PortfolioProjectionModel,
} from "../types/portfolio-projection";
import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type MarketCase,
  type PortfolioCaseDetail,
  type PortfolioLabProvenance,
  type PortfolioLabRequest,
  type PortfolioLabResult,
  type PortfolioMetrics,
} from "../lib/portfolio-lab/contracts";
import { REGIME_ORDER } from "../lib/regimes";

const MONTHS_PER_YEAR = 12;
const GBM_CASE_ID = asPortfolioCaseId("portfolio-projection/gbm");
const HMM_CASE_ID = asPortfolioCaseId("portfolio-projection/hmm");

export interface ProjectionPercentileSeries {
  readonly p05: number[];
  readonly p10: number[];
  readonly p50: number[];
  readonly p90: number[];
  readonly p95: number[];
}

export interface ProjectionMetrics {
  readonly medianTerminalValue: number;
  readonly meanTerminalValue: number;
  readonly medianRealValue: number;
  readonly probabilityOfTarget: number;
  readonly probabilityOfLoss: number;
  readonly medianMaxDrawdown: number;
  readonly probabilityOfThirtyPercentDrawdown: number;
  readonly probabilityOfUnrecoveredDrawdown: number;
  readonly averageRecoveryMonths: number | null;
  readonly tailCapitalShortfall: number;
  readonly averageTargetShortfall: number;
  readonly totalContributed: number;
}

/**
 * UI-oriented selectors over a native portfolio-lab result. This view model
 * keeps chart components declarative without recreating the old simulation
 * engine contract.
 */
export interface PortfolioProjectionResult {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.result;
  readonly inputs: PortfolioProjectionInputs;
  readonly months: number[];
  readonly samplePaths: number[][];
  readonly sampleDrawdownPaths: number[][];
  readonly pathPercentiles: ProjectionPercentileSeries;
  readonly drawdownPercentiles: ProjectionPercentileSeries;
  readonly terminalValues: number[];
  readonly maxDrawdowns: number[];
  readonly sampleRegimePaths: ("bull" | "bear" | "sideways")[][];
  readonly regimeOccupancy: Readonly<Record<"bull" | "bear" | "sideways", number>> | null;
  readonly metrics: ProjectionMetrics;
  readonly comparisonMetrics: Readonly<
    Record<PortfolioProjectionModel, ProjectionMetrics>
  >;
  readonly provenance: PortfolioLabProvenance;
}

export function buildPortfolioProjectionRequest(
  inputs: PortfolioProjectionInputs,
): PortfolioLabRequest {
  const steps = Math.round(inputs.horizonYears * MONTHS_PER_YEAR);

  return {
    contract: PORTFOLIO_LAB_CONTRACT.request,
    plan: {
      initialCapital: inputs.initialCapital,
      contributionPerStep: inputs.monthlyContribution,
      targetWeights: {
        stocks: inputs.stockAllocation,
        bonds: 1 - inputs.stockAllocation,
      },
      rebalance: toRebalancePolicy(inputs.rebalanceFrequency),
      annualInflationRate: inputs.inflationRate,
      targetValue: inputs.targetValue,
    },
    primaryCaseId: inputs.model === "constant" ? GBM_CASE_ID : HMM_CASE_ID,
    cases: [buildGbmCase(inputs), buildHmmCase(inputs)],
    execution: {
      seed: Math.trunc(inputs.seed),
      paths: inputs.pathCount,
      steps,
      stepYears: 1 / MONTHS_PER_YEAR,
    },
  };
}

export function presentPortfolioProjectionResult(
  result: PortfolioLabResult,
  rawInputs: PortfolioProjectionInputs,
): PortfolioProjectionResult {
  const inputs = cloneInputs(rawInputs);
  const primary = presentCase(result.primary);
  const comparisonMetrics = Object.fromEntries(
    [result.primary, ...result.comparisons].map((summary) => [
      summary.model === "gbm" ? "constant" : "hmm",
      presentMetrics(summary.metrics),
    ]),
  ) as Partial<Record<PortfolioProjectionModel, ProjectionMetrics>>;

  if (!comparisonMetrics.constant || !comparisonMetrics.hmm) {
    throw new Error("The projection comparison requires both GBM and HMM cases.");
  }

  return {
    contract: result.contract,
    inputs,
    months: Array.from(
      { length: result.provenance.timeGrid.steps + 1 },
      (_, month) => month,
    ),
    ...primary,
    comparisonMetrics: {
      constant: comparisonMetrics.constant,
      hmm: comparisonMetrics.hmm,
    },
    provenance: result.provenance,
  };
}

function buildGbmCase(inputs: PortfolioProjectionInputs): MarketCase {
  return {
    id: GBM_CASE_ID,
    label: "Standard Monte Carlo",
    model: {
      contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
      kind: "gbm",
      market: {
        stocks: {
          annualDrift: inputs.stocks.expectedReturn,
          annualVolatility: inputs.stocks.volatility,
        },
        bonds: {
          annualDrift: inputs.bonds.expectedReturn,
          annualVolatility: inputs.bonds.volatility,
        },
        correlation: inputs.correlation,
      },
    },
  };
}

function buildHmmCase(inputs: PortfolioProjectionInputs): MarketCase {
  const regimes = Object.fromEntries(
    REGIME_ORDER.map((regime) => {
      const market = inputs.hmm.regimes[regime];
      return [
        regime,
        {
          stocks: {
            annualDrift: market.stocks.expectedReturn,
            annualVolatility: market.stocks.volatility,
          },
          bonds: {
            annualDrift: market.bonds.expectedReturn,
            annualVolatility: market.bonds.volatility,
          },
          correlation: market.correlation,
        },
      ];
    }),
  ) as Extract<MarketCase["model"], { kind: "hmm" }>["regimes"];

  return {
    id: HMM_CASE_ID,
    label: "Regime switching",
    model: {
      contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
      kind: "hmm",
      regimes,
      transitionMatrix: inputs.hmm.transitionMatrix,
      initialStateProbabilities: inputs.hmm.currentStateProbabilities,
    },
  };
}

function toRebalancePolicy(
  frequency: PortfolioProjectionInputs["rebalanceFrequency"],
): PortfolioLabRequest["plan"]["rebalance"] {
  if (frequency === "never") return { kind: "never" };
  return {
    kind: "periodic",
    everySteps: frequency === "monthly" ? 1 : MONTHS_PER_YEAR,
  };
}

function presentCase(detail: PortfolioCaseDetail) {
  const distribution = detail.distribution;
  return {
    samplePaths: detail.samples.map((sample) => [...sample.wealth.values]),
    sampleDrawdownPaths: detail.samples.map((sample) => [
      ...sample.drawdown.values,
    ]),
    pathPercentiles: presentPercentiles(distribution.wealthPercentiles),
    drawdownPercentiles: presentPercentiles(distribution.drawdownPercentiles),
    terminalValues: [...distribution.terminalWealth.values],
    maxDrawdowns: [...distribution.maximumDrawdowns.values],
    sampleRegimePaths:
      detail.model === "hmm"
        ? detail.diagnostics.sampledStatePaths.map((path) => [...path.states])
        : [],
    regimeOccupancy:
      detail.model === "hmm" ? detail.diagnostics.regimeOccupancy : null,
    metrics: presentMetrics(detail.metrics),
  };
}

function presentMetrics(metrics: PortfolioMetrics): ProjectionMetrics {
  return {
    medianTerminalValue: metrics.wealth.medianTerminalValue,
    meanTerminalValue: metrics.wealth.meanTerminalValue,
    medianRealValue: metrics.wealth.medianRealTerminalValue,
    probabilityOfTarget: metrics.goal.probabilityOfTarget,
    probabilityOfLoss: metrics.loss.probabilityBelowContributions,
    medianMaxDrawdown: metrics.drawdown.medianMaximumDrawdown,
    probabilityOfThirtyPercentDrawdown:
      metrics.drawdown.probabilityOverThirtyPercent,
    probabilityOfUnrecoveredDrawdown: metrics.drawdown.probabilityUnrecovered,
    averageRecoveryMonths: metrics.drawdown.averageCompletedRecoverySteps,
    tailCapitalShortfall: metrics.loss.tailCapitalShortfall,
    averageTargetShortfall: metrics.goal.averageShortfallRatio,
    totalContributed: metrics.wealth.totalContributed,
  };
}

function presentPercentiles(
  percentiles:
    | PortfolioCaseDetail["distribution"]["wealthPercentiles"]
    | PortfolioCaseDetail["distribution"]["drawdownPercentiles"],
): ProjectionPercentileSeries {
  return {
    p05: [...percentiles.p05.values],
    p10: [...percentiles.p10.values],
    p50: [...percentiles.p50.values],
    p90: [...percentiles.p90.values],
    p95: [...percentiles.p95.values],
  };
}

function cloneInputs(
  inputs: PortfolioProjectionInputs,
): PortfolioProjectionInputs {
  return {
    ...inputs,
    stocks: { ...inputs.stocks },
    bonds: { ...inputs.bonds },
    hmm: {
      regimes: Object.fromEntries(
        REGIME_ORDER.map((regime) => [
          regime,
          {
            stocks: { ...inputs.hmm.regimes[regime].stocks },
            bonds: { ...inputs.hmm.regimes[regime].bonds },
            correlation: inputs.hmm.regimes[regime].correlation,
          },
        ]),
      ) as PortfolioProjectionInputs["hmm"]["regimes"],
      transitionMatrix: Object.fromEntries(
        REGIME_ORDER.map((regime) => [
          regime,
          { ...inputs.hmm.transitionMatrix[regime] },
        ]),
      ) as PortfolioProjectionInputs["hmm"]["transitionMatrix"],
      currentStateProbabilities: {
        ...inputs.hmm.currentStateProbabilities,
      },
    },
  };
}
