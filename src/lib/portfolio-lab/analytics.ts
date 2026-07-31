import {
  PORTFOLIO_LAB_CONTRACT,
  type DrawdownRatioSeries,
  type GbmCaseDetail,
  type GbmCaseSummary,
  type HmmCaseDetail,
  type HmmCaseSummary,
  type HmmRegime,
  type HmmRegimeProbabilities,
  type MarketCase,
  type NominalWealthSeries,
  type PercentileSeries,
  type PortfolioCaseDetail,
  type PortfolioCaseSummary,
  type PortfolioLabExecution,
  type PortfolioMetrics,
  type PortfolioPlan,
} from "./contracts";
import { PortfolioLabNumericalError } from "./errors";
import type { PortfolioPath } from "./portfolio";

const THIRTY_PERCENT_DRAWDOWN = 0.3;
const REGIME_ORDER: readonly HmmRegime[] = ["bull", "bear", "sideways"];

export interface PathAnalysis {
  readonly wealth: number[];
  readonly drawdowns: number[];
  readonly maximumDrawdown: number;
  readonly recoverySteps: number[];
  readonly hasUnrecoveredDrawdown: boolean;
  readonly regimes: HmmRegime[];
}

export interface CaseSimulation {
  readonly requestCase: MarketCase;
  readonly plan: PortfolioPlan;
  readonly execution: PortfolioLabExecution;
  readonly paths: readonly PathAnalysis[];
}

interface MetricSources {
  readonly terminalWealth: readonly number[];
  readonly maximumDrawdowns: readonly number[];
  readonly recoverySteps: readonly number[];
  readonly unrecoveredDrawdownCount: number;
}

interface NumericPercentiles {
  readonly p05: readonly number[];
  readonly p10: readonly number[];
  readonly p50: readonly number[];
  readonly p90: readonly number[];
  readonly p95: readonly number[];
}

export function analyzePortfolioPath(path: PortfolioPath): PathAnalysis {
  return {
    wealth: path.wealth,
    regimes: path.regimes,
    ...analyzeDrawdowns(path.cashFlowNeutralValues),
  };
}

export function buildCaseSummary(
  simulation: CaseSimulation,
): PortfolioCaseSummary {
  const { requestCase } = simulation;
  const fields = {
    id: requestCase.id,
    label: requestCase.label,
    metrics: buildMetrics(simulation),
  };

  if (requestCase.model.kind === "gbm") {
    return {
      ...fields,
      model: "gbm",
      modelContract: requestCase.model.contract,
    } satisfies GbmCaseSummary;
  }

  return {
    ...fields,
    model: "hmm",
    modelContract: requestCase.model.contract,
  } satisfies HmmCaseSummary;
}

export function buildCaseDetail(
  simulation: CaseSimulation,
  selectedPathIndexes: readonly number[],
): PortfolioCaseDetail {
  const { requestCase, paths } = simulation;
  const summary = buildCaseSummary(simulation);
  const detailFields = {
    id: summary.id,
    label: summary.label,
    metrics: summary.metrics,
    samples: selectedPathIndexes.map((pathIndex) => ({
      pathIndex,
      wealth: nominalWealth(paths[pathIndex].wealth),
      drawdown: drawdownRatios(paths[pathIndex].drawdowns),
    })),
    distribution: buildDistribution(simulation),
  };

  if (requestCase.model.kind === "gbm") {
    return {
      ...detailFields,
      model: "gbm",
      modelContract: requestCase.model.contract,
      diagnostics: {
        contract: PORTFOLIO_LAB_CONTRACT.gbmDiagnostics,
        kind: "gbm",
      },
    } satisfies GbmCaseDetail;
  }

  return {
    ...detailFields,
    model: "hmm",
    modelContract: requestCase.model.contract,
    diagnostics: {
      contract: PORTFOLIO_LAB_CONTRACT.hmmDiagnostics,
      kind: "hmm",
      regimeOccupancy: calculateRegimeOccupancy(paths),
      sampledStatePaths: selectedPathIndexes.map((pathIndex) => ({
        pathIndex,
        states: paths[pathIndex].regimes,
      })),
    },
  } satisfies HmmCaseDetail;
}

function analyzeDrawdowns(
  values: readonly number[],
): Omit<PathAnalysis, "wealth" | "regimes"> {
  let peak = values[0];
  let underwaterSince: number | null = null;
  let maximumDrawdown = 0;
  const drawdowns = [0];
  const recoverySteps: number[] = [];

  for (let stepIndex = 1; stepIndex < values.length; stepIndex += 1) {
    const value = values[stepIndex];
    if (value >= peak) {
      if (underwaterSince !== null) {
        recoverySteps.push(stepIndex - underwaterSince);
        underwaterSince = null;
      }
      peak = value;
      drawdowns.push(0);
      continue;
    }

    underwaterSince ??= stepIndex - 1;
    const drawdown = peak === 0 ? 0 : Math.max(0, 1 - value / peak);
    maximumDrawdown = Math.max(maximumDrawdown, drawdown);
    drawdowns.push(drawdown);
  }

  return {
    drawdowns,
    maximumDrawdown,
    recoverySteps,
    hasUnrecoveredDrawdown: underwaterSince !== null,
  };
}

function buildDistribution(
  simulation: CaseSimulation,
): PortfolioCaseDetail["distribution"] {
  const { paths } = simulation;
  const pointCount = paths[0].wealth.length;
  const wealthPercentiles = buildPercentileSeries(
    paths.map((path) => path.wealth),
    pointCount,
  );
  const drawdownPercentiles = buildPercentileSeries(
    paths.map((path) => path.drawdowns),
    pointCount,
  );

  return {
    terminalWealth: nominalWealth(
      paths.map((path) => path.wealth.at(-1)!),
    ),
    maximumDrawdowns: drawdownRatios(
      paths.map((path) => path.maximumDrawdown),
    ),
    wealthPercentiles: wrapPercentiles(wealthPercentiles, nominalWealth),
    drawdownPercentiles: wrapPercentiles(
      drawdownPercentiles,
      drawdownRatios,
    ),
  };
}

function buildMetrics(simulation: CaseSimulation): PortfolioMetrics {
  const { paths, plan, execution, requestCase } = simulation;
  const sources: MetricSources = {
    terminalWealth: paths.map((path) => path.wealth.at(-1)!),
    maximumDrawdowns: paths.map((path) => path.maximumDrawdown),
    recoverySteps: paths.flatMap((path) => path.recoverySteps),
    unrecoveredDrawdownCount: paths.filter(
      (path) => path.hasUnrecoveredDrawdown,
    ).length,
  };
  const sortedTerminalWealth = [...sources.terminalWealth].sort(
    (left, right) => left - right,
  );
  const sortedMaximumDrawdowns = [...sources.maximumDrawdowns].sort(
    (left, right) => left - right,
  );
  const totalContributed =
    plan.initialCapital + plan.contributionPerStep * execution.steps;
  assertFiniteMetric(requestCase, "totalContributed", totalContributed);

  const elapsedYears = execution.steps * execution.stepYears;
  assertFiniteMetric(requestCase, "elapsedYears", elapsedYears);
  const inflationFactor =
    (1 + plan.annualInflationRate) ** elapsedYears;
  if (!Number.isFinite(inflationFactor) || inflationFactor === 0) {
    throw numericalMetricError(requestCase, "inflationFactor");
  }

  const medianTerminalWealth = percentile(sortedTerminalWealth, 0.5);
  const tailCount = Math.max(
    1,
    Math.ceil(sortedTerminalWealth.length * 0.05),
  );
  const tailCapitalShortfall = mean(
    sortedTerminalWealth
      .slice(0, tailCount)
      .map((value) =>
        totalContributed === 0
          ? 0
          : Math.max(0, 1 - value / totalContributed),
      ),
  );
  const targetShortfalls =
    plan.targetValue === 0
      ? []
      : sources.terminalWealth
          .filter((value) => value < plan.targetValue)
          .map((value) => 1 - value / plan.targetValue);

  const metrics: PortfolioMetrics = {
    wealth: {
      medianTerminalValue: medianTerminalWealth,
      meanTerminalValue: mean(sources.terminalWealth),
      medianRealTerminalValue: medianTerminalWealth / inflationFactor,
      totalContributed,
    },
    goal: {
      probabilityOfTarget:
        countWhere(
          sources.terminalWealth,
          (value) => value >= plan.targetValue,
        ) / sources.terminalWealth.length,
      averageShortfallRatio:
        targetShortfalls.length === 0 ? 0 : mean(targetShortfalls),
    },
    loss: {
      probabilityBelowContributions:
        countWhere(
          sources.terminalWealth,
          (value) => value < totalContributed,
        ) / sources.terminalWealth.length,
      tailCapitalShortfall,
    },
    drawdown: {
      medianMaximumDrawdown: percentile(sortedMaximumDrawdowns, 0.5),
      probabilityOverThirtyPercent:
        countWhere(
          sources.maximumDrawdowns,
          (drawdown) => drawdown > THIRTY_PERCENT_DRAWDOWN,
        ) / sources.maximumDrawdowns.length,
      probabilityUnrecovered:
        sources.unrecoveredDrawdownCount /
        sources.maximumDrawdowns.length,
      averageCompletedRecoverySteps:
        sources.recoverySteps.length === 0
          ? null
          : mean(sources.recoverySteps),
    },
  };

  assertFiniteMetrics(requestCase, metrics);
  return metrics;
}

function assertFiniteMetrics(
  requestCase: MarketCase,
  metrics: PortfolioMetrics,
): void {
  const metricValues = [
    ["medianTerminalValue", metrics.wealth.medianTerminalValue],
    ["meanTerminalValue", metrics.wealth.meanTerminalValue],
    ["medianRealTerminalValue", metrics.wealth.medianRealTerminalValue],
    ["totalContributed", metrics.wealth.totalContributed],
    ["probabilityOfTarget", metrics.goal.probabilityOfTarget],
    ["averageShortfallRatio", metrics.goal.averageShortfallRatio],
    [
      "probabilityBelowContributions",
      metrics.loss.probabilityBelowContributions,
    ],
    ["tailCapitalShortfall", metrics.loss.tailCapitalShortfall],
    ["medianMaximumDrawdown", metrics.drawdown.medianMaximumDrawdown],
    [
      "probabilityOverThirtyPercent",
      metrics.drawdown.probabilityOverThirtyPercent,
    ],
    ["probabilityUnrecovered", metrics.drawdown.probabilityUnrecovered],
  ] as const;

  for (const [quantity, value] of metricValues) {
    assertFiniteMetric(requestCase, quantity, value);
  }

  const recovery = metrics.drawdown.averageCompletedRecoverySteps;
  if (recovery !== null) {
    assertFiniteMetric(requestCase, "averageCompletedRecoverySteps", recovery);
  }
}

function assertFiniteMetric(
  requestCase: MarketCase,
  quantity: string,
  value: number,
): void {
  if (!Number.isFinite(value)) {
    throw numericalMetricError(requestCase, quantity);
  }
}

function numericalMetricError(
  requestCase: MarketCase,
  quantity: string,
): PortfolioLabNumericalError {
  return new PortfolioLabNumericalError(
    requestCase.id,
    "Portfolio analytics produced a non-finite value.",
    { quantity },
  );
}

function buildPercentileSeries(
  paths: readonly (readonly number[])[],
  pointCount: number,
): NumericPercentiles {
  const series = {
    p05: [] as number[],
    p10: [] as number[],
    p50: [] as number[],
    p90: [] as number[],
    p95: [] as number[],
  };

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const values = paths
      .map((path) => path[pointIndex])
      .sort((left, right) => left - right);
    series.p05.push(percentile(values, 0.05));
    series.p10.push(percentile(values, 0.1));
    series.p50.push(percentile(values, 0.5));
    series.p90.push(percentile(values, 0.9));
    series.p95.push(percentile(values, 0.95));
  }

  return series;
}

function calculateRegimeOccupancy(
  paths: readonly PathAnalysis[],
): HmmRegimeProbabilities {
  const counts: Record<HmmRegime, number> = {
    bull: 0,
    bear: 0,
    sideways: 0,
  };
  let observationCount = 0;

  for (const path of paths) {
    for (const regime of path.regimes) {
      counts[regime] += 1;
      observationCount += 1;
    }
  }

  if (observationCount === 0) {
    return counts;
  }

  for (const regime of REGIME_ORDER) {
    counts[regime] /= observationCount;
  }

  return counts;
}

function nominalWealth(values: readonly number[]): NominalWealthSeries {
  return { kind: "nominal-wealth", values };
}

function drawdownRatios(values: readonly number[]): DrawdownRatioSeries {
  return { kind: "drawdown-ratio", values };
}

function wrapPercentiles<
  Series extends NominalWealthSeries | DrawdownRatioSeries,
>(
  percentiles: NumericPercentiles,
  wrap: (values: readonly number[]) => Series,
): PercentileSeries<Series> {
  return {
    p05: wrap(percentiles.p05),
    p10: wrap(percentiles.p10),
    p50: wrap(percentiles.p50),
    p90: wrap(percentiles.p90),
    p95: wrap(percentiles.p95),
  };
}

function percentile(
  sortedValues: readonly number[],
  probability: number,
): number {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const interpolationWeight = position - lowerIndex;

  return (
    sortedValues[lowerIndex] * (1 - interpolationWeight) +
    sortedValues[upperIndex] * interpolationWeight
  );
}

function mean(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Number.isFinite(sum)) {
    return sum / values.length;
  }

  let average = 0;

  for (let index = 0; index < values.length; index += 1) {
    average += (values[index] - average) / (index + 1);
  }

  return average;
}

function countWhere(
  values: readonly number[],
  predicate: (value: number) => boolean,
): number {
  return values.reduce(
    (count, value) => count + Number(predicate(value)),
    0,
  );
}
