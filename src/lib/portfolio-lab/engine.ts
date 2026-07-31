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
  type PortfolioCaseId,
  type PortfolioCaseSummary,
  type PortfolioLabExecution,
  type PortfolioLabRequest,
  type PortfolioLabResult,
  type PortfolioMetrics,
  type PortfolioPlan,
  type TwoAssetMarketAssumptions,
} from "./contracts";
import {
  createPortfolioRandomSource,
  PORTFOLIO_RANDOM_STREAM_VERSION,
  type PortfolioRandomSource,
} from "./semantic-random";

export const PORTFOLIO_LAB_ENGINE_VERSION = "portfolio-lab-engine@1";
export const PORTFOLIO_LAB_EVENT_ORDER_VERSION =
  "market-cashflow-rebalance-record@1";

const MAX_SAMPLE_PATHS = 160;
const THIRTY_PERCENT_DRAWDOWN = 0.3;
const COOPERATIVE_PATH_BATCH_SIZE = 16;
const REGIME_ORDER: readonly HmmRegime[] = ["bull", "bear", "sideways"];

interface StepMarketModel {
  readonly stockDrift: number;
  readonly stockDiffusion: number;
  readonly bondDrift: number;
  readonly bondDiffusion: number;
  readonly correlation: number;
  readonly independentBondWeight: number;
}

type CaseMarketModel =
  | {
      readonly kind: "gbm";
      readonly market: StepMarketModel;
    }
  | {
      readonly kind: "hmm";
      readonly regimes: Readonly<Record<HmmRegime, StepMarketModel>>;
      readonly transitionMatrix: Readonly<
        Record<HmmRegime, HmmRegimeProbabilities>
      >;
      readonly initialStateProbabilities: HmmRegimeProbabilities;
    };

interface CaseSimulationContext {
  readonly requestCase: MarketCase;
  readonly plan: PortfolioPlan;
  readonly execution: PortfolioLabExecution;
  readonly model: CaseMarketModel;
  readonly randomSource: PortfolioRandomSource;
}

interface PathAnalysis {
  readonly wealth: number[];
  readonly drawdowns: number[];
  readonly maximumDrawdown: number;
  readonly recoverySteps: number[];
  readonly hasUnrecoveredDrawdown: boolean;
  readonly regimes: HmmRegime[];
}

interface CaseSimulation {
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

export class PortfolioLabEngineCancelledError extends Error {
  constructor() {
    super("The portfolio-lab run was cancelled.");
    this.name = "PortfolioLabEngineCancelledError";
  }
}

export class PortfolioLabNumericalError extends Error {
  readonly caseId: PortfolioCaseId;
  readonly location?: {
    readonly pathIndex?: number;
    readonly stepIndex?: number;
    readonly quantity?: string;
  };

  constructor(
    caseId: PortfolioCaseId,
    message: string,
    location?: PortfolioLabNumericalError["location"],
  ) {
    super(message);
    this.name = "PortfolioLabNumericalError";
    this.caseId = caseId;
    this.location = location;
  }
}

export function executeValidatedPortfolioLabRequest(
  request: PortfolioLabRequest,
): PortfolioLabResult {
  const selectedPathIndexes = selectPortfolioLabSampleIndexes(
    request.execution.paths,
  );
  const comparisons: PortfolioCaseSummary[] = [];
  let primary: PortfolioCaseDetail | undefined;

  for (const requestCase of request.cases) {
    const simulation = simulateCase(request, requestCase);
    if (requestCase.id === request.primaryCaseId) {
      primary = buildCaseDetail(simulation, selectedPathIndexes);
    } else {
      comparisons.push(buildCaseSummary(simulation));
    }
  }

  return buildResult(
    request,
    requirePrimary(primary),
    comparisons,
    selectedPathIndexes,
  );
}

export async function executeValidatedPortfolioLabRequestCooperatively(
  request: PortfolioLabRequest,
  signal: AbortSignal,
): Promise<PortfolioLabResult> {
  throwIfCancelled(signal);

  const selectedPathIndexes = selectPortfolioLabSampleIndexes(
    request.execution.paths,
  );
  const comparisons: PortfolioCaseSummary[] = [];
  let primary: PortfolioCaseDetail | undefined;

  for (const requestCase of request.cases) {
    const simulation = await simulateCaseCooperatively(
      request,
      requestCase,
      signal,
    );
    if (requestCase.id === request.primaryCaseId) {
      primary = buildCaseDetail(simulation, selectedPathIndexes);
    } else {
      comparisons.push(buildCaseSummary(simulation));
    }
  }

  throwIfCancelled(signal);
  return buildResult(
    request,
    requirePrimary(primary),
    comparisons,
    selectedPathIndexes,
  );
}

export function selectPortfolioLabSampleIndexes(pathCount: number): number[] {
  if (pathCount <= MAX_SAMPLE_PATHS) {
    return Array.from({ length: pathCount }, (_, index) => index);
  }

  return Array.from({ length: MAX_SAMPLE_PATHS }, (_, sampleIndex) =>
    Math.round(
      (sampleIndex * (pathCount - 1)) / (MAX_SAMPLE_PATHS - 1),
    ),
  );
}

export function sampleRegime(
  probabilities: HmmRegimeProbabilities,
  randomValue: number,
): HmmRegime {
  let cumulativeProbability = 0;

  for (const regime of REGIME_ORDER) {
    cumulativeProbability += probabilities[regime];
    if (randomValue <= cumulativeProbability) {
      return regime;
    }
  }

  return REGIME_ORDER.at(-1)!;
}

function simulateCase(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
): CaseSimulation {
  const context = createCaseSimulationContext(request, requestCase);
  const paths = Array.from(
    { length: request.execution.paths },
    (_, pathIndex) => simulatePath(context, pathIndex),
  );

  return {
    requestCase,
    plan: request.plan,
    execution: request.execution,
    paths,
  };
}

async function simulateCaseCooperatively(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
  signal: AbortSignal,
): Promise<CaseSimulation> {
  const context = createCaseSimulationContext(request, requestCase);
  const paths: PathAnalysis[] = [];

  await Promise.resolve();
  throwIfCancelled(signal);

  for (let pathIndex = 0; pathIndex < request.execution.paths; pathIndex += 1) {
    paths.push(simulatePath(context, pathIndex));

    if ((pathIndex + 1) % COOPERATIVE_PATH_BATCH_SIZE === 0) {
      await yieldToEventLoop();
      throwIfCancelled(signal);
    }
  }

  throwIfCancelled(signal);
  return {
    requestCase,
    plan: request.plan,
    execution: request.execution,
    paths,
  };
}

function createCaseSimulationContext(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
): CaseSimulationContext {
  const { model } = requestCase;
  const stepYears = request.execution.stepYears;
  const caseModel: CaseMarketModel =
    model.kind === "gbm"
      ? {
          kind: "gbm",
          market: createStepMarketModel(model.market, stepYears),
        }
      : {
          kind: "hmm",
          regimes: {
            bull: createStepMarketModel(model.regimes.bull, stepYears),
            bear: createStepMarketModel(model.regimes.bear, stepYears),
            sideways: createStepMarketModel(
              model.regimes.sideways,
              stepYears,
            ),
          },
          transitionMatrix: model.transitionMatrix,
          initialStateProbabilities: model.initialStateProbabilities,
        };

  return {
    requestCase,
    plan: request.plan,
    execution: request.execution,
    model: caseModel,
    randomSource: createPortfolioRandomSource(request.execution.seed),
  };
}

function createStepMarketModel(
  assumptions: TwoAssetMarketAssumptions,
  stepYears: number,
): StepMarketModel {
  const stockVariance = assumptions.stocks.annualVolatility ** 2;
  const bondVariance = assumptions.bonds.annualVolatility ** 2;

  return {
    stockDrift:
      (assumptions.stocks.annualDrift - stockVariance / 2) * stepYears,
    stockDiffusion:
      assumptions.stocks.annualVolatility * Math.sqrt(stepYears),
    bondDrift:
      (assumptions.bonds.annualDrift - bondVariance / 2) * stepYears,
    bondDiffusion:
      assumptions.bonds.annualVolatility * Math.sqrt(stepYears),
    correlation: assumptions.correlation,
    independentBondWeight: Math.sqrt(
      Math.max(0, 1 - assumptions.correlation ** 2),
    ),
  };
}

function simulatePath(
  context: CaseSimulationContext,
  pathIndex: number,
): PathAnalysis {
  const { plan, execution, model, randomSource, requestCase } = context;
  let stockValue = plan.initialCapital * plan.targetWeights.stocks;
  let bondValue = plan.initialCapital - stockValue;
  let navStockValue = plan.targetWeights.stocks;
  let navBondValue = 1 - navStockValue;
  const wealth = [plan.initialCapital];
  const navValues = [1];
  let regime =
    model.kind === "hmm"
      ? sampleRegime(
          model.initialStateProbabilities,
          randomSource.uniformAt(pathIndex, 0, "regime/initial"),
        )
      : null;
  const regimes: HmmRegime[] = regime ? [regime] : [];

  for (let stepIndex = 1; stepIndex <= execution.steps; stepIndex += 1) {
    if (model.kind === "hmm" && regime) {
      regime = sampleRegime(
        model.transitionMatrix[regime],
        randomSource.uniformAt(
          pathIndex,
          stepIndex,
          "regime/transition",
        ),
      );
      regimes.push(regime);
    }

    const marketModel =
      model.kind === "gbm" ? model.market : model.regimes[regime!];
    const stockShock = randomSource.normalAt(
      pathIndex,
      stepIndex,
      "diffusion/stocks",
    );
    const independentBondShock = randomSource.normalAt(
      pathIndex,
      stepIndex,
      "diffusion/bonds-independent",
    );
    const bondShock =
      marketModel.correlation * stockShock +
      marketModel.independentBondWeight * independentBondShock;
    const stockGrowth = Math.exp(
      marketModel.stockDrift + marketModel.stockDiffusion * stockShock,
    );
    const bondGrowth = Math.exp(
      marketModel.bondDrift + marketModel.bondDiffusion * bondShock,
    );

    stockValue =
      stockValue * stockGrowth +
      plan.contributionPerStep * plan.targetWeights.stocks;
    bondValue =
      bondValue * bondGrowth +
      plan.contributionPerStep * (1 - plan.targetWeights.stocks);
    navStockValue *= stockGrowth;
    navBondValue *= bondGrowth;

    if (shouldRebalance(plan, stepIndex)) {
      [stockValue, bondValue] = rebalance(
        stockValue,
        bondValue,
        plan.targetWeights.stocks,
      );
      [navStockValue, navBondValue] = rebalance(
        navStockValue,
        navBondValue,
        plan.targetWeights.stocks,
      );
    }

    const portfolioValue = stockValue + bondValue;
    const navValue = navStockValue + navBondValue;
    if (!Number.isFinite(portfolioValue) || !Number.isFinite(navValue)) {
      throw new PortfolioLabNumericalError(
        requestCase.id,
        "Asset assumptions produced a non-finite portfolio value.",
        {
          pathIndex,
          stepIndex,
          quantity: !Number.isFinite(portfolioValue)
            ? "nominalWealth"
            : "cashFlowNeutralIndex",
        },
      );
    }

    wealth.push(portfolioValue);
    navValues.push(navValue);
  }

  return {
    wealth,
    regimes,
    ...analyzeDrawdowns(navValues),
  };
}

function shouldRebalance(plan: PortfolioPlan, stepIndex: number): boolean {
  return (
    plan.rebalance.kind === "periodic" &&
    stepIndex % plan.rebalance.everySteps === 0
  );
}

function rebalance(
  stockValue: number,
  bondValue: number,
  stockWeight: number,
): [stockValue: number, bondValue: number] {
  const portfolioValue = stockValue + bondValue;
  return [
    portfolioValue * stockWeight,
    portfolioValue * (1 - stockWeight),
  ];
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

function buildCaseSummary(
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

function buildCaseDetail(
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

function buildDistribution(
  simulation: CaseSimulation,
): PortfolioCaseDetail["distribution"] {
  const { paths } = simulation;
  const stepCount = paths[0].wealth.length;
  const wealthPercentiles = buildPercentileSeries(
    paths.map((path) => path.wealth),
    stepCount,
  );
  const drawdownPercentiles = buildPercentileSeries(
    paths.map((path) => path.drawdowns),
    stepCount,
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
  const { paths } = simulation;
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
  const { plan, execution } = simulation;
  const totalContributed =
    plan.initialCapital + plan.contributionPerStep * execution.steps;
  const inflationFactor =
    (1 + plan.annualInflationRate) **
    (execution.steps * execution.stepYears);
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

  return {
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

function buildResult(
  request: PortfolioLabRequest,
  primary: PortfolioCaseDetail,
  comparisons: readonly PortfolioCaseSummary[],
  selectedPathIndexes: readonly number[],
): PortfolioLabResult {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.result,
    primary,
    comparisons,
    warnings: [],
    provenance: {
      contract: PORTFOLIO_LAB_CONTRACT.provenance,
      requestContract: request.contract,
      engineVersion: PORTFOLIO_LAB_ENGINE_VERSION,
      randomStreamVersion: PORTFOLIO_RANDOM_STREAM_VERSION,
      eventOrderVersion: PORTFOLIO_LAB_EVENT_ORDER_VERSION,
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

function requirePrimary(
  primary: PortfolioCaseDetail | undefined,
): PortfolioCaseDetail {
  if (!primary) {
    throw new Error("The primary case ID must reference a case.");
  }
  return primary;
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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PortfolioLabEngineCancelledError();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
