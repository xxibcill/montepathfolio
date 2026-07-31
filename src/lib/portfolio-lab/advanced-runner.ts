import {
  QuantError,
  asDrawdownSeries,
  asIndexSeries,
  asLossValueSeries,
  asWealthSeries,
  createSemanticRandom,
  factorCorrelationMatrix,
  matrixVectorMultiply,
  mean,
  quantile,
  type NumericMatrix,
  type SemanticRandom,
} from "../quant/core";
import { calculateVarCvar } from "../quant/risk";
import {
  PORTFOLIO_LAB_V2_CONTRACT,
  PORTFOLIO_LAB_V2_MODEL_CONTRACT,
  type PortfolioLabV2Case,
  type PortfolioLabV2CaseDetail,
  type PortfolioLabV2CaseSummary,
  type PortfolioLabV2Diagnostics,
  type PortfolioLabV2Distribution,
  type PortfolioLabV2GarchVariance,
  type PortfolioLabV2Innovation,
  type PortfolioLabV2Issue,
  type PortfolioLabV2JumpAssumption,
  type PortfolioLabV2JumpEvent,
  type PortfolioLabV2Metrics,
  type PortfolioLabV2Model,
  type PortfolioLabV2Outcome,
  type PortfolioLabV2Percentiles,
  type PortfolioLabV2Plan,
  type PortfolioLabV2Problem,
  type PortfolioLabV2Request,
  type PortfolioLabV2Result,
  type PortfolioLabV2SampledPath,
  type PortfolioLabV2Warning,
} from "./advanced-contracts";

export const PORTFOLIO_LAB_V2_LIMITS = {
  cases: 8,
  assets: 16,
  paths: 10_000,
  steps: 1_200,
  pathSteps: 5_000_000,
  samplePaths: 160,
} as const;

const WEIGHT_TOLERANCE = 1e-10;
const PROBABILITY_TOLERANCE = 1e-8;
const THIRTY_PERCENT_DRAWDOWN = 0.3;
const COMPARISON_RANDOM_NAMESPACE = PORTFOLIO_LAB_V2_CONTRACT.request;

type UnknownRecord = Record<string, unknown>;
type IssuePath = readonly (string | number)[];

interface MarketPath {
  readonly growth: readonly (readonly number[])[];
  readonly variances: readonly (readonly number[])[];
  readonly regimes: readonly number[];
  readonly jumpEvents: readonly PortfolioLabV2JumpEvent[];
  readonly jumpCounts: readonly number[];
  readonly hadJump: boolean;
  readonly crashed: boolean;
}

interface AnalyzedPath {
  readonly pathIndex: number;
  readonly wealth: readonly number[];
  readonly cashFlowNeutralIndex: readonly number[];
  readonly drawdown: readonly number[];
  readonly maximumDrawdown: number;
  readonly recoverySteps: readonly number[];
  readonly unrecovered: boolean;
  readonly totalWithdrawn: number;
  readonly terminalEconomicLoss: number;
  readonly sampledHoldings?: readonly (readonly number[])[];
  readonly market: MarketPath;
}

interface CaseSimulation {
  readonly requestCase: PortfolioLabV2Case;
  readonly paths: readonly AnalyzedPath[];
  readonly summary: PortfolioLabV2CaseSummary;
  readonly detail: PortfolioLabV2CaseDetail;
  readonly warnings: readonly PortfolioLabV2Warning[];
}

class PortfolioLabV2NumericalError extends Error {
  constructor(
    message: string,
    readonly caseId?: string,
    readonly location?: {
      readonly pathIndex?: number;
      readonly stepIndex?: number;
      readonly quantity?: string;
    },
  ) {
    super(message);
    this.name = "PortfolioLabV2NumericalError";
  }
}

/**
 * Validates and runs request@2 without mutating or adapting the frozen v1
 * contract. Every failure is returned as structured data suitable for a worker
 * boundary.
 */
export function runPortfolioLabV2(request: unknown): PortfolioLabV2Outcome {
  const preflight = preflightPortfolioLabV2Request(request);
  if (preflight) return { ok: false, problem: preflight };

  const validatedRequest = request as PortfolioLabV2Request;
  try {
    return { ok: true, result: executePortfolioLabV2(validatedRequest) };
  } catch (error) {
    if (error instanceof PortfolioLabV2NumericalError) {
      return {
        ok: false,
        problem: {
          contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
          code: "NUMERICAL_FAILURE",
          message: error.message,
          caseId: error.caseId,
          location: error.location,
        },
      };
    }
    if (error instanceof QuantError) {
      return {
        ok: false,
        problem: {
          contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
          code: "NUMERICAL_FAILURE",
          message: error.message,
        },
      };
    }
    throw error;
  }
}

/** Returns null only when the request is safe to pass to the numeric engine. */
export function preflightPortfolioLabV2Request(
  request: unknown,
): PortfolioLabV2Problem | null {
  if (!isRecord(request)) {
    return invalidProblem([
      issue("MISSING", [], "A portfolio-lab request object is required."),
    ]);
  }
  if (request.contract !== PORTFOLIO_LAB_V2_CONTRACT.request) {
    return {
      contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
      code: "UNSUPPORTED_CONTRACT",
      message: "This runner accepts only the native portfolio-lab request@2 contract.",
      receivedContract:
        typeof request.contract === "string" ? request.contract : null,
      supportedContracts: [PORTFOLIO_LAB_V2_CONTRACT.request],
    };
  }

  const plan = isRecord(request.plan) ? request.plan : null;
  const allocation = plan && Array.isArray(plan.allocation) ? plan.allocation : null;
  if (allocation && allocation.length > PORTFOLIO_LAB_V2_LIMITS.assets) {
    return resourceProblem(
      "ASSETS",
      allocation.length,
      PORTFOLIO_LAB_V2_LIMITS.assets,
    );
  }

  const cases = Array.isArray(request.cases) ? request.cases : null;
  if (cases && cases.length > PORTFOLIO_LAB_V2_LIMITS.cases) {
    return resourceProblem(
      "CASES",
      cases.length,
      PORTFOLIO_LAB_V2_LIMITS.cases,
    );
  }

  const execution = isRecord(request.execution) ? request.execution : null;
  const paths = execution?.paths;
  const steps = execution?.steps;
  if (typeof paths === "number" && paths > PORTFOLIO_LAB_V2_LIMITS.paths) {
    return resourceProblem("PATHS", paths, PORTFOLIO_LAB_V2_LIMITS.paths);
  }
  if (typeof steps === "number" && steps > PORTFOLIO_LAB_V2_LIMITS.steps) {
    return resourceProblem("STEPS", steps, PORTFOLIO_LAB_V2_LIMITS.steps);
  }

  const issues: PortfolioLabV2Issue[] = [];
  const assetIds = validatePlan(request.plan, issues);
  validateCases(cases, assetIds, issues);
  validatePrimaryCaseId(request.primaryCaseId, cases, issues);
  validateRisk(request.risk, issues);
  validateExecution(request.execution, issues);
  if (issues.length > 0) return invalidProblem(issues);

  const pathSteps =
    (paths as number) *
    (steps as number) *
    assetIds.length *
    (cases as readonly unknown[]).length;
  if (pathSteps > PORTFOLIO_LAB_V2_LIMITS.pathSteps) {
    return resourceProblem(
      "PATH_STEPS",
      pathSteps,
      PORTFOLIO_LAB_V2_LIMITS.pathSteps,
    );
  }
  return null;
}

function executePortfolioLabV2(request: PortfolioLabV2Request): PortfolioLabV2Result {
  const selectedPathIndexes = selectSampleIndexes(
    request.execution.paths,
    Math.min(
      request.execution.samplePaths ?? 32,
      PORTFOLIO_LAB_V2_LIMITS.samplePaths,
    ),
  );
  const selected = new Set(selectedPathIndexes);
  const simulations = request.cases.map((requestCase) =>
    simulateCase(request, requestCase, selected, selectedPathIndexes),
  );
  const primary = simulations.find(
    (simulation) => simulation.requestCase.id === request.primaryCaseId,
  );
  if (!primary) {
    throw new PortfolioLabV2NumericalError(
      "The validated primary case could not be resolved.",
    );
  }
  const precisionWarnings: PortfolioLabV2Warning[] =
    request.execution.paths < 500
      ? [
          {
            contract: PORTFOLIO_LAB_V2_CONTRACT.warning,
            code: "PRECISION",
            message:
              "Fewer than 500 paths can make five-percent tail estimates visibly noisy.",
          },
        ]
      : [];
  return {
    contract: PORTFOLIO_LAB_V2_CONTRACT.result,
    primary: primary.detail,
    comparisons: simulations
      .filter((simulation) => simulation !== primary)
      .map((simulation) => simulation.summary),
    warnings: [
      ...precisionWarnings,
      ...simulations.flatMap((simulation) => simulation.warnings),
    ],
    provenance: {
      contract: PORTFOLIO_LAB_V2_CONTRACT.provenance,
      requestContract: PORTFOLIO_LAB_V2_CONTRACT.request,
      engineVersion: "portfolio-lab-engine@2",
      randomStreamVersion: "semantic-keyed-streams@2",
      eventOrderVersion:
        "market->contribution->withdrawal->rebalance->record@2",
      quantileMethod: "linear-r7",
      seed: request.execution.seed,
      timeGrid: {
        steps: request.execution.steps,
        stepYears: request.execution.stepYears,
      },
      selectedPathIndexes,
      requestedCaseIds: request.cases.map((requestCase) => requestCase.id),
    },
  };
}

function simulateCase(
  request: PortfolioLabV2Request,
  requestCase: PortfolioLabV2Case,
  selected: ReadonlySet<number>,
  selectedPathIndexes: readonly number[],
): CaseSimulation {
  const random = createSemanticRandom(
    request.execution.seed,
    COMPARISON_RANDOM_NAMESPACE,
  );
  const correlation = modelCorrelation(requestCase.model);
  const lower = factorCorrelationMatrix(correlation);
  const paths = Array.from({ length: request.execution.paths }, (_, pathIndex) => {
    const recordSample = selected.has(pathIndex);
    const market = simulateMarketPath(
      request,
      requestCase,
      random,
      lower,
      pathIndex,
      recordSample,
    );
    return simulatePortfolioPath(
      request.plan,
      requestCase,
      market,
      pathIndex,
      recordSample,
      request.execution.steps,
    );
  });
  const metrics = buildMetrics(request, paths);
  const summary: PortfolioLabV2CaseSummary = {
    id: requestCase.id,
    label: requestCase.label,
    model: requestCase.model.kind,
    modelContract: requestCase.model.contract,
    metrics,
  };
  const detail: PortfolioLabV2CaseDetail = {
    ...summary,
    samples: selectedPathIndexes.map((pathIndex) =>
      buildSampledPath(request.plan, paths[pathIndex]),
    ),
    distribution: buildDistribution(paths),
    diagnostics: buildDiagnostics(
      request,
      requestCase,
      paths,
      selectedPathIndexes,
    ),
  };
  return {
    requestCase,
    paths,
    summary,
    detail,
    warnings: caseWarnings(requestCase),
  };
}

function simulateMarketPath(
  request: PortfolioLabV2Request,
  requestCase: PortfolioLabV2Case,
  random: SemanticRandom,
  lower: NumericMatrix,
  pathIndex: number,
  recordSample: boolean,
): MarketPath {
  const { model } = requestCase;
  const assetCount = request.plan.allocation.length;
  const growth: number[][] = [];
  const variances: number[][] = [];
  const regimes: number[] = [];
  const jumpEvents: PortfolioLabV2JumpEvent[] = [];
  const jumpCounts = Array(assetCount).fill(0) as number[];
  let hadJump = false;
  let crashed = false;
  let regime =
    model.kind === "composite"
      ? sampleCategorical(
          model.regimes.initialProbabilities,
          random.uniform("regime/initial", pathIndex),
        )
      : 0;
  let conditionalVariances = initialConditionalVariances(model);
  let priorInnovations = Array(assetCount).fill(0) as number[];

  for (let stepIndex = 1; stepIndex <= request.execution.steps; stepIndex += 1) {
    if (model.kind === "composite" && model.enabled.regimes) {
      regime = sampleCategorical(
        model.regimes.transitionMatrix[regime],
        random.uniform("regime/transition", pathIndex, stepIndex),
      );
    }
    regimes.push(regime);

    if (stepIndex > 1 && usesDynamicVariance(model)) {
      conditionalVariances = conditionalVariances.map((priorVariance, assetIndex) => {
        const parameters = varianceParameters(model, assetIndex);
        return Math.max(
          0,
          parameters.omega +
            parameters.alpha * priorInnovations[assetIndex] ** 2 +
            parameters.beta * priorVariance,
        );
      });
    }

    const innovations = correlatedInnovations(
      random,
      lower,
      modelInnovation(model),
      pathIndex,
      stepIndex,
      model.kind !== "composite" || model.enabled.dependence,
    );
    const stepGrowth = Array(assetCount).fill(0) as number[];
    const nextPriorInnovations = Array(assetCount).fill(0) as number[];

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
      const annualVariance = conditionalVarianceFor(
        model,
        conditionalVariances,
        assetIndex,
      );
      const annualDrift = driftFor(model, regime, assetIndex);
      nextPriorInnovations[assetIndex] =
        Math.sqrt(annualVariance) * innovations[assetIndex];
      const jump = jumpFor(model, assetIndex);
      const intensity = jump?.annualIntensity ?? 0;
      const count = random.poisson(
        intensity * request.execution.stepYears,
        "jump/arrival",
        pathIndex,
        stepIndex,
        assetIndex,
      );
      let aggregateLogJump = 0;
      for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
        aggregateLogJump +=
          jump!.meanLogJump +
          jump!.logJumpVolatility *
            random.normal(
              "jump/size",
              pathIndex,
              stepIndex,
              assetIndex,
              eventIndex,
            );
      }
      const expectedJumpMultiplier = jump
        ? Math.exp(jump.meanLogJump + 0.5 * jump.logJumpVolatility ** 2) - 1
        : 0;
      const logGrowth =
        (annualDrift - 0.5 * annualVariance - intensity * expectedJumpMultiplier) *
          request.execution.stepYears +
        Math.sqrt(annualVariance * request.execution.stepYears) *
          innovations[assetIndex] +
        aggregateLogJump;
      stepGrowth[assetIndex] = Math.exp(logGrowth);
      if (!Number.isFinite(stepGrowth[assetIndex])) {
        throw new PortfolioLabV2NumericalError(
          "Market dynamics produced a non-finite growth factor.",
          requestCase.id,
          { pathIndex, stepIndex, quantity: `growth.${assetIndex}` },
        );
      }
      jumpCounts[assetIndex] += count;
      hadJump ||= count > 0;
      crashed ||= aggregateLogJump < Math.log(0.8);
      if (recordSample && count > 0) {
        jumpEvents.push({
          pathIndex,
          stepIndex,
          assetIndex,
          count,
          aggregateLogJump,
        });
      }
    }
    growth.push(stepGrowth);
    if (
      recordSample &&
      (model.kind === "garch" || model.kind === "composite")
    ) {
      variances.push([...conditionalVariances]);
    }
    priorInnovations = nextPriorInnovations;
  }

  return {
    growth,
    variances,
    regimes,
    jumpEvents,
    jumpCounts,
    hadJump,
    crashed,
  };
}

function simulatePortfolioPath(
  plan: PortfolioLabV2Plan,
  requestCase: PortfolioLabV2Case,
  market: MarketPath,
  pathIndex: number,
  recordSample: boolean,
  steps: number,
): AnalyzedPath {
  const weights = plan.allocation.map((allocation) => allocation.targetWeight);
  let holdings = weights.map((weight) => plan.initialCapital * weight);
  let neutralHoldings = [...weights];
  const wealth = [plan.initialCapital];
  const cashFlowNeutralIndex = [1];
  const sampledHoldings = recordSample
    ? holdings.map((holding) => [holding])
    : undefined;
  let totalWithdrawn = 0;

  for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
    const growth = market.growth[stepIndex - 1];
    holdings = holdings.map((holding, assetIndex) => holding * growth[assetIndex]);
    neutralHoldings = neutralHoldings.map(
      (holding, assetIndex) => holding * growth[assetIndex],
    );

    holdings = holdings.map(
      (holding, assetIndex) =>
        holding + plan.contributionPerStep * weights[assetIndex],
    );
    const beforeWithdrawal = sum(holdings);
    const actualWithdrawal = Math.min(plan.withdrawalPerStep, beforeWithdrawal);
    if (actualWithdrawal > 0) {
      const remainingRatio =
        beforeWithdrawal === 0 ? 0 : (beforeWithdrawal - actualWithdrawal) / beforeWithdrawal;
      holdings = holdings.map((holding) => holding * remainingRatio);
    }
    totalWithdrawn += actualWithdrawal;

    if (
      plan.rebalance.kind === "periodic" &&
      stepIndex % plan.rebalance.everySteps === 0
    ) {
      holdings = rebalance(holdings, weights);
      neutralHoldings = rebalance(neutralHoldings, weights);
    }
    const portfolioValue = sum(holdings);
    const neutralValue = sum(neutralHoldings);
    if (!Number.isFinite(portfolioValue) || !Number.isFinite(neutralValue)) {
      throw new PortfolioLabV2NumericalError(
        "Portfolio accounting produced a non-finite value.",
        requestCase.id,
        {
          pathIndex,
          stepIndex,
          quantity: Number.isFinite(portfolioValue)
            ? "cashFlowNeutralIndex"
            : "wealth",
        },
      );
    }
    wealth.push(portfolioValue);
    cashFlowNeutralIndex.push(neutralValue);
    sampledHoldings?.forEach((series, assetIndex) =>
      series.push(holdings[assetIndex]),
    );
  }
  const drawdownAnalysis = analyzeDrawdown(cashFlowNeutralIndex);
  const investedCapital =
    plan.initialCapital + plan.contributionPerStep * steps;
  return {
    pathIndex,
    wealth,
    cashFlowNeutralIndex,
    drawdown: drawdownAnalysis.drawdown,
    maximumDrawdown: drawdownAnalysis.maximumDrawdown,
    recoverySteps: drawdownAnalysis.recoverySteps,
    unrecovered: drawdownAnalysis.unrecovered,
    totalWithdrawn,
    terminalEconomicLoss:
      investedCapital - totalWithdrawn - wealth.at(-1)!,
    sampledHoldings,
    market,
  };
}

function buildMetrics(
  request: PortfolioLabV2Request,
  paths: readonly AnalyzedPath[],
): PortfolioLabV2Metrics {
  const terminalWealth = paths.map((path) => path.wealth.at(-1)!);
  const terminalLosses = paths.map((path) => path.terminalEconomicLoss);
  const maximumDrawdowns = paths.map((path) => path.maximumDrawdown);
  const totalContributed =
    request.plan.initialCapital +
    request.plan.contributionPerStep * request.execution.steps;
  const economicTerminalValues = paths.map(
    (path) => path.wealth.at(-1)! + path.totalWithdrawn,
  );
  const sortedEconomicValues = [...economicTerminalValues].sort(ascending);
  const tailCount = Math.max(1, Math.ceil(paths.length * 0.05));
  const targetShortfalls = terminalWealth
    .filter((value) => value < request.plan.targetValue)
    .map((value) =>
      request.plan.targetValue === 0
        ? 0
        : 1 - value / request.plan.targetValue,
    );
  const completedRecoveries = paths.flatMap((path) => path.recoverySteps);
  const elapsedYears = request.execution.steps * request.execution.stepYears;
  const inflationFactor =
    (1 + request.plan.annualInflationRate) ** elapsedYears;
  if (!Number.isFinite(inflationFactor) || inflationFactor <= 0) {
    throw new PortfolioLabV2NumericalError(
      "Inflation assumptions produced a non-finite real-value conversion.",
    );
  }
  const medianTerminalValue = quantile(terminalWealth, 0.5);
  const rawVar = Math.max(
    0,
    quantile(terminalLosses, request.risk.confidenceLevel),
  );
  const tail = terminalLosses.filter((loss) => loss >= rawVar);
  const risk =
    tail.length === 0
      ? {
          valueAtRisk: rawVar,
          conditionalValueAtRisk: rawVar,
          tailObservationCount: 0,
        }
      : calculateVarCvar({
          contract: "risk-lab/var-cvar@1",
          method: {
            kind: "historical",
            losses: { kind: "positive-loss", values: terminalLosses },
            provenance: {
              label: "Portfolio Projection Lab request@2 terminal scenarios",
              kind: "illustrative",
            },
          },
          confidenceLevel: request.risk.confidenceLevel,
          holdingPeriods: 1,
          portfolioValue: 1,
        }).result;

  return {
    wealth: {
      medianTerminalValue,
      meanTerminalValue: mean(terminalWealth),
      medianRealTerminalValue: medianTerminalValue / inflationFactor,
      totalContributed,
      meanTotalWithdrawn: mean(paths.map((path) => path.totalWithdrawn)),
    },
    goal: {
      probabilityOfTarget:
        terminalWealth.filter((value) => value >= request.plan.targetValue).length /
        paths.length,
      averageShortfallRatio:
        targetShortfalls.length === 0 ? 0 : mean(targetShortfalls),
    },
    loss: {
      probabilityBelowNetInvestedCapital:
        economicTerminalValues.filter((value) => value < totalContributed).length /
        paths.length,
      tailCapitalShortfall: mean(
        sortedEconomicValues.slice(0, tailCount).map((value) =>
          totalContributed === 0
            ? 0
            : Math.max(0, 1 - value / totalContributed),
        ),
      ),
    },
    drawdown: {
      medianMaximumDrawdown: quantile(maximumDrawdowns, 0.5),
      probabilityOverThirtyPercent:
        maximumDrawdowns.filter((value) => value > THIRTY_PERCENT_DRAWDOWN)
          .length / paths.length,
      probabilityUnrecovered:
        paths.filter((path) => path.unrecovered).length / paths.length,
      averageCompletedRecoverySteps:
        completedRecoveries.length === 0 ? null : mean(completedRecoveries),
    },
    risk: {
      valueAtRisk: risk.valueAtRisk,
      conditionalValueAtRisk: risk.conditionalValueAtRisk,
      confidenceLevel: request.risk.confidenceLevel,
      tailObservationCount: risk.tailObservationCount ?? tail.length,
      lossConvention: "positive-terminal-economic-loss",
      finiteSampleConvention: "all-observations-at-or-above-r7-var",
    },
  };
}

function buildDistribution(
  paths: readonly AnalyzedPath[],
): PortfolioLabV2Distribution {
  const wealthPercentiles = buildPercentiles(paths.map((path) => path.wealth));
  const drawdownPercentiles = buildPercentiles(paths.map((path) => path.drawdown));
  return {
    terminalWealth: asWealthSeries(paths.map((path) => path.wealth.at(-1)!)),
    terminalEconomicLosses: asLossValueSeries(
      paths.map((path) => path.terminalEconomicLoss),
    ),
    maximumDrawdowns: asDrawdownSeries(
      paths.map((path) => path.maximumDrawdown),
    ),
    wealthPercentiles: mapPercentileSeries(wealthPercentiles, asWealthSeries),
    drawdownPercentiles: mapPercentileSeries(
      drawdownPercentiles,
      asDrawdownSeries,
    ),
  };
}

function buildSampledPath(
  plan: PortfolioLabV2Plan,
  path: AnalyzedPath,
): PortfolioLabV2SampledPath {
  if (!path.sampledHoldings) {
    throw new PortfolioLabV2NumericalError(
      "A selected sample path is missing holdings detail.",
    );
  }
  return {
    pathIndex: path.pathIndex,
    wealth: asWealthSeries(path.wealth),
    holdings: plan.allocation.map((allocation, assetIndex) => ({
      assetId: allocation.assetId,
      values: asWealthSeries(path.sampledHoldings![assetIndex]),
    })),
    cashFlowNeutralIndex: asIndexSeries(path.cashFlowNeutralIndex),
    drawdown: asDrawdownSeries(path.drawdown),
    totalWithdrawn: path.totalWithdrawn,
  };
}

function buildDiagnostics(
  request: PortfolioLabV2Request,
  requestCase: PortfolioLabV2Case,
  paths: readonly AnalyzedPath[],
  selectedPathIndexes: readonly number[],
): PortfolioLabV2Diagnostics {
  const { model } = requestCase;
  if (model.kind === "gbm") {
    return {
      kind: "gbm",
      annualDrifts: model.assets.map((asset) => asset.annualDrift),
      annualVolatilities: model.assets.map((asset) => asset.annualVolatility),
    };
  }
  if (model.kind === "jumpDiffusion") {
    const jumped = paths.filter((path) => path.market.hadJump);
    return {
      kind: "jumpDiffusion",
      empiricalAnnualJumpCounts: model.assets.map((_, assetIndex) =>
        sum(paths.map((path) => path.market.jumpCounts[assetIndex])) /
        (paths.length * request.execution.steps * request.execution.stepYears),
      ),
      probabilityOfAnyCrash:
        paths.filter((path) => path.market.crashed).length / paths.length,
      jumpConditionedMeanMaximumDrawdown:
        jumped.length === 0
          ? null
          : mean(jumped.map((path) => path.maximumDrawdown)),
      sampledJumpEvents: selectedPathIndexes.flatMap(
        (pathIndex) => paths[pathIndex].market.jumpEvents,
      ),
    };
  }
  if (model.kind === "garch") {
    return {
      kind: "garch",
      persistence: model.assets.map(
        (asset) => asset.variance.alpha + asset.variance.beta,
      ),
      unconditionalVariance: model.assets.map((asset) =>
        unconditionalVariance(asset.variance),
      ),
      sampledConditionalVariances: selectedPathIndexes.map(
        (pathIndex) => paths[pathIndex].market.variances,
      ),
    };
  }
  const occupancy = Array(model.regimes.labels.length).fill(0) as number[];
  paths.forEach((path) =>
    path.market.regimes.forEach((state) => {
      occupancy[state] += 1;
    }),
  );
  const observations = paths.length * request.execution.steps;
  return {
    kind: "composite",
    updateOrder: "hmm->garch->copula->jump->portfolio",
    regimeOccupancy: occupancy.map((count) => count / observations),
    sampledRegimes: selectedPathIndexes.map(
      (pathIndex) => paths[pathIndex].market.regimes,
    ),
    sampledConditionalVariances: selectedPathIndexes.map(
      (pathIndex) => paths[pathIndex].market.variances,
    ),
    sampledJumpEvents: selectedPathIndexes.flatMap(
      (pathIndex) => paths[pathIndex].market.jumpEvents,
    ),
    enabled: model.enabled,
  };
}

function caseWarnings(
  requestCase: PortfolioLabV2Case,
): PortfolioLabV2Warning[] {
  const variances =
    requestCase.model.kind === "garch"
      ? requestCase.model.assets.map((asset) => asset.variance)
      : requestCase.model.kind === "composite" &&
          requestCase.model.enabled.dynamicVariance
        ? requestCase.model.garch
        : [];
  return variances.flatMap((variance, assetIndex) => {
    const persistence = variance.alpha + variance.beta;
    if (persistence < 0.98) return [];
    return [
      {
        contract: PORTFOLIO_LAB_V2_CONTRACT.warning,
        code: "STATIONARITY",
        caseId: requestCase.id,
        message:
          persistence >= 1
            ? `Asset ${assetIndex} has nonstationary GARCH persistence ${persistence.toFixed(4)}.`
            : `Asset ${assetIndex} has near-unit GARCH persistence ${persistence.toFixed(4)}.`,
      } satisfies PortfolioLabV2Warning,
    ];
  });
}

function correlatedInnovations(
  random: SemanticRandom,
  lower: NumericMatrix,
  innovation: PortfolioLabV2Innovation,
  pathIndex: number,
  stepIndex: number,
  sharedScale: boolean,
): number[] {
  const independent = lower.map((_, assetIndex) =>
    random.normal("diffusion", pathIndex, stepIndex, assetIndex),
  );
  const correlated = matrixVectorMultiply(lower, independent);
  if (innovation.kind === "gaussian") return correlated;
  const degreesOfFreedom = innovation.degreesOfFreedom;
  if (sharedScale) {
    const chiSquare = random.gamma(
      degreesOfFreedom / 2,
      2,
      "diffusion/student-scale",
      pathIndex,
      stepIndex,
    );
    const scale = Math.sqrt((degreesOfFreedom - 2) / chiSquare);
    return correlated.map((value) => value * scale);
  }
  return correlated.map((value, assetIndex) => {
    const chiSquare = random.gamma(
      degreesOfFreedom / 2,
      2,
      "diffusion/student-scale",
      pathIndex,
      stepIndex,
      assetIndex,
    );
    return value * Math.sqrt((degreesOfFreedom - 2) / chiSquare);
  });
}

function initialConditionalVariances(model: PortfolioLabV2Model): number[] {
  if (model.kind === "gbm" || model.kind === "jumpDiffusion") {
    return model.assets.map((asset) => asset.annualVolatility ** 2);
  }
  if (model.kind === "garch") {
    return model.assets.map((asset) => resolveInitialVariance(asset.variance));
  }
  return model.garch.map((variance, assetIndex) =>
    model.enabled.dynamicVariance
      ? resolveInitialVariance(variance)
      : model.baseAssets[assetIndex].annualVolatility ** 2,
  );
}

function conditionalVarianceFor(
  model: PortfolioLabV2Model,
  conditionalVariances: readonly number[],
  assetIndex: number,
): number {
  if (model.kind === "gbm" || model.kind === "jumpDiffusion") {
    return model.assets[assetIndex].annualVolatility ** 2;
  }
  if (model.kind === "composite" && !model.enabled.dynamicVariance) {
    return model.baseAssets[assetIndex].annualVolatility ** 2;
  }
  return conditionalVariances[assetIndex];
}

function varianceParameters(
  model: PortfolioLabV2Model,
  assetIndex: number,
): PortfolioLabV2GarchVariance {
  if (model.kind === "garch") return model.assets[assetIndex].variance;
  if (model.kind === "composite") return model.garch[assetIndex];
  throw new PortfolioLabV2NumericalError(
    "A non-GARCH model requested dynamic variance parameters.",
  );
}

function usesDynamicVariance(model: PortfolioLabV2Model): boolean {
  return model.kind === "garch" ||
    (model.kind === "composite" && model.enabled.dynamicVariance);
}

function driftFor(
  model: PortfolioLabV2Model,
  regime: number,
  assetIndex: number,
): number {
  if (model.kind === "gbm" || model.kind === "jumpDiffusion") {
    return model.assets[assetIndex].annualDrift;
  }
  if (model.kind === "garch") return model.assets[assetIndex].annualDrift;
  return model.enabled.regimes
    ? model.regimes.annualDrifts[regime][assetIndex]
    : model.baseAssets[assetIndex].annualDrift;
}

function jumpFor(
  model: PortfolioLabV2Model,
  assetIndex: number,
): PortfolioLabV2JumpAssumption | null {
  if (model.kind === "jumpDiffusion") return model.assets[assetIndex].jump;
  if (model.kind === "composite" && model.enabled.jumps) {
    return model.jumps[assetIndex];
  }
  return null;
}

function modelInnovation(model: PortfolioLabV2Model): PortfolioLabV2Innovation {
  if (model.kind === "garch") return model.innovation;
  if (model.kind === "composite") return model.copula.innovation;
  return { kind: "gaussian" };
}

function modelCorrelation(model: PortfolioLabV2Model): NumericMatrix {
  if (model.kind === "composite") {
    if (model.enabled.dependence) return model.copula.correlation;
    return identityMatrix(model.baseAssets.length);
  }
  return model.correlation;
}

function resolveInitialVariance(variance: PortfolioLabV2GarchVariance): number {
  return variance.initialVariance === "unconditional"
    ? variance.omega / (1 - variance.alpha - variance.beta)
    : variance.initialVariance;
}

function unconditionalVariance(
  variance: PortfolioLabV2GarchVariance,
): number | null {
  const persistence = variance.alpha + variance.beta;
  return persistence < 1 ? variance.omega / (1 - persistence) : null;
}

function rebalance(
  holdings: readonly number[],
  weights: readonly number[],
): number[] {
  const wealth = sum(holdings);
  return weights.map((weight) => wealth * weight);
}

function analyzeDrawdown(values: readonly number[]): {
  readonly drawdown: readonly number[];
  readonly maximumDrawdown: number;
  readonly recoverySteps: readonly number[];
  readonly unrecovered: boolean;
} {
  let peak = values[0];
  let underwaterSince: number | null = null;
  let maximumDrawdown = 0;
  const drawdown = [0];
  const recoverySteps: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] >= peak) {
      if (underwaterSince !== null) {
        recoverySteps.push(index - underwaterSince);
        underwaterSince = null;
      }
      peak = values[index];
      drawdown.push(0);
      continue;
    }
    underwaterSince ??= index - 1;
    const value = peak === 0 ? 0 : Math.max(0, 1 - values[index] / peak);
    maximumDrawdown = Math.max(maximumDrawdown, value);
    drawdown.push(value);
  }
  return {
    drawdown,
    maximumDrawdown,
    recoverySteps,
    unrecovered: underwaterSince !== null,
  };
}

function buildPercentiles(
  paths: readonly (readonly number[])[],
): PortfolioLabV2Percentiles {
  const result: Record<"p05" | "p10" | "p50" | "p90" | "p95", number[]> = {
    p05: [],
    p10: [],
    p50: [],
    p90: [],
    p95: [],
  };
  const probabilities = [
    ["p05", 0.05],
    ["p10", 0.1],
    ["p50", 0.5],
    ["p90", 0.9],
    ["p95", 0.95],
  ] as const;
  for (let pointIndex = 0; pointIndex < paths[0].length; pointIndex += 1) {
    const values = paths.map((path) => path[pointIndex]);
    probabilities.forEach(([key, probability]) =>
      result[key].push(quantile(values, probability)),
    );
  }
  return result;
}

function mapPercentileSeries<Series extends readonly number[]>(
  percentiles: PortfolioLabV2Percentiles,
  tag: (values: readonly number[]) => Series,
): PortfolioLabV2Percentiles<Series> {
  return {
    p05: tag(percentiles.p05),
    p10: tag(percentiles.p10),
    p50: tag(percentiles.p50),
    p90: tag(percentiles.p90),
    p95: tag(percentiles.p95),
  };
}

function selectSampleIndexes(pathCount: number, sampleCount: number): number[] {
  return Array.from(
    { length: Math.min(pathCount, sampleCount) },
    (_, index) => index,
  );
}

function validatePlan(
  value: unknown,
  issues: PortfolioLabV2Issue[],
): string[] {
  const path = ["plan"] as const;
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A portfolio plan is required."));
    return [];
  }
  validatePositiveNumber(value.initialCapital, [...path, "initialCapital"], issues);
  validateNonNegativeNumber(
    value.contributionPerStep,
    [...path, "contributionPerStep"],
    issues,
  );
  validateNonNegativeNumber(
    value.withdrawalPerStep,
    [...path, "withdrawalPerStep"],
    issues,
  );
  validateFiniteNumber(
    value.annualInflationRate,
    [...path, "annualInflationRate"],
    issues,
  );
  if (
    typeof value.annualInflationRate === "number" &&
    value.annualInflationRate <= -1
  ) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        [...path, "annualInflationRate"],
        "Annual inflation must be greater than -1.",
      ),
    );
  }
  validateNonNegativeNumber(value.targetValue, [...path, "targetValue"], issues);
  validateRebalance(value.rebalance, [...path, "rebalance"], issues);
  if (!Array.isArray(value.allocation) || value.allocation.length === 0) {
    issues.push(
      issue("MISSING", [...path, "allocation"], "At least one allocation is required."),
    );
    return [];
  }
  if (value.allocation.length > PORTFOLIO_LAB_V2_LIMITS.assets) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        [...path, "allocation"],
        `Allocations are limited to ${PORTFOLIO_LAB_V2_LIMITS.assets} assets.`,
      ),
    );
  }
  const assetIds: string[] = [];
  const seen = new Set<string>();
  let weightSum = 0;
  value.allocation.forEach((allocation, index) => {
    const allocationPath = [...path, "allocation", index];
    if (!isRecord(allocation)) {
      issues.push(issue("MISSING", allocationPath, "Allocation must be an object."));
      return;
    }
    if (typeof allocation.assetId !== "string" || !allocation.assetId.trim()) {
      issues.push(issue("MISSING", [...allocationPath, "assetId"], "Asset ID is required."));
    } else {
      if (seen.has(allocation.assetId)) {
        issues.push(
          issue(
            "DUPLICATE_ID",
            [...allocationPath, "assetId"],
            "Allocation asset IDs must be unique.",
          ),
        );
      }
      seen.add(allocation.assetId);
      assetIds.push(allocation.assetId);
    }
    validateNonNegativeNumber(
      allocation.targetWeight,
      [...allocationPath, "targetWeight"],
      issues,
    );
    if (typeof allocation.targetWeight === "number") {
      weightSum += allocation.targetWeight;
    }
  });
  if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
    issues.push(
      issue(
        "INVALID_DISTRIBUTION",
        [...path, "allocation"],
        "Target weights must sum to one.",
      ),
    );
  }
  return assetIds;
}

function validateCases(
  cases: readonly unknown[] | null,
  assetIds: readonly string[],
  issues: PortfolioLabV2Issue[],
): void {
  if (!cases || cases.length === 0) {
    issues.push(issue("MISSING", ["cases"], "At least one market case is required."));
    return;
  }
  const ids = new Set<string>();
  cases.forEach((requestCase, caseIndex) => {
    const path = ["cases", caseIndex] as const;
    if (!isRecord(requestCase)) {
      issues.push(issue("MISSING", path, "Each market case must be an object."));
      return;
    }
    if (typeof requestCase.id !== "string" || !requestCase.id.trim()) {
      issues.push(issue("MISSING", [...path, "id"], "Case ID is required."));
    } else if (ids.has(requestCase.id)) {
      issues.push(issue("DUPLICATE_ID", [...path, "id"], "Case IDs must be unique."));
    } else {
      ids.add(requestCase.id);
    }
    if (typeof requestCase.label !== "string" || !requestCase.label.trim()) {
      issues.push(issue("MISSING", [...path, "label"], "Case label is required."));
    }
    validateModel(requestCase.model, assetIds, [...path, "model"], issues);
  });
}

function validateModel(
  value: unknown,
  assetIds: readonly string[],
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A market model is required."));
    return;
  }
  const expectedContract =
    value.kind === "gbm"
      ? PORTFOLIO_LAB_V2_MODEL_CONTRACT.gbm
      : value.kind === "jumpDiffusion"
        ? PORTFOLIO_LAB_V2_MODEL_CONTRACT.jumpDiffusion
        : value.kind === "garch"
          ? PORTFOLIO_LAB_V2_MODEL_CONTRACT.garch
          : value.kind === "composite"
            ? PORTFOLIO_LAB_V2_MODEL_CONTRACT.composite
            : null;
  if (!expectedContract) {
    issues.push(
      issue(
        "UNSUPPORTED_MODEL",
        [...path, "kind"],
        "Supported v2 models are GBM, jump diffusion, GARCH, and the sanctioned composite.",
      ),
    );
    return;
  }
  if (value.contract !== expectedContract) {
    issues.push(
      issue(
        "UNSUPPORTED_MODEL",
        [...path, "contract"],
        `Model kind ${String(value.kind)} requires contract ${expectedContract}.`,
      ),
    );
  }
  if (value.kind === "gbm" || value.kind === "jumpDiffusion") {
    validateDiffusionAssets(
      value.assets,
      assetIds,
      [...path, "assets"],
      issues,
      value.kind === "jumpDiffusion",
    );
    validateCorrelation(value.correlation, assetIds.length, [...path, "correlation"], issues);
    return;
  }
  if (value.kind === "garch") {
    validateGarchAssets(value.assets, assetIds, [...path, "assets"], issues);
    validateCorrelation(value.correlation, assetIds.length, [...path, "correlation"], issues);
    validateInnovation(value.innovation, [...path, "innovation"], issues);
    return;
  }
  validateComposite(value, assetIds, path, issues);
}

function validateDiffusionAssets(
  value: unknown,
  assetIds: readonly string[],
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
  needsJump: boolean,
): void {
  if (!Array.isArray(value) || value.length !== assetIds.length) {
    issues.push(
      issue("DIMENSION_MISMATCH", path, "Model assets must align with the plan allocation."),
    );
    return;
  }
  value.forEach((asset, index) => {
    if (!isRecord(asset)) {
      issues.push(issue("MISSING", [...path, index], "Asset assumptions are required."));
      return;
    }
    validateAssetIdentity(asset.assetId, assetIds[index], [...path, index, "assetId"], issues);
    validateFiniteNumber(asset.annualDrift, [...path, index, "annualDrift"], issues);
    validateNonNegativeNumber(
      asset.annualVolatility,
      [...path, index, "annualVolatility"],
      issues,
    );
    if (needsJump) validateJump(asset.jump, [...path, index, "jump"], issues);
  });
}

function validateGarchAssets(
  value: unknown,
  assetIds: readonly string[],
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!Array.isArray(value) || value.length !== assetIds.length) {
    issues.push(
      issue("DIMENSION_MISMATCH", path, "GARCH assets must align with the plan allocation."),
    );
    return;
  }
  value.forEach((asset, index) => {
    if (!isRecord(asset)) {
      issues.push(issue("MISSING", [...path, index], "GARCH asset assumptions are required."));
      return;
    }
    validateAssetIdentity(asset.assetId, assetIds[index], [...path, index, "assetId"], issues);
    validateFiniteNumber(asset.annualDrift, [...path, index, "annualDrift"], issues);
    validateGarchVariance(asset.variance, [...path, index, "variance"], issues);
  });
}

function validateComposite(
  model: UnknownRecord,
  assetIds: readonly string[],
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  validateDiffusionAssets(
    model.baseAssets,
    assetIds,
    [...path, "baseAssets"],
    issues,
    false,
  );
  if (!Array.isArray(model.garch) || model.garch.length !== assetIds.length) {
    issues.push(
      issue(
        "DIMENSION_MISMATCH",
        [...path, "garch"],
        "Composite GARCH parameters must align with assets.",
      ),
    );
  } else {
    model.garch.forEach((variance, index) =>
      validateGarchVariance(variance, [...path, "garch", index], issues),
    );
  }
  if (!Array.isArray(model.jumps) || model.jumps.length !== assetIds.length) {
    issues.push(
      issue(
        "DIMENSION_MISMATCH",
        [...path, "jumps"],
        "Composite jump parameters must align with assets.",
      ),
    );
  } else {
    model.jumps.forEach((jump, index) =>
      validateJump(jump, [...path, "jumps", index], issues),
    );
  }
  if (!isRecord(model.copula)) {
    issues.push(issue("MISSING", [...path, "copula"], "Composite copula is required."));
  } else {
    validateCorrelation(
      model.copula.correlation,
      assetIds.length,
      [...path, "copula", "correlation"],
      issues,
    );
    validateInnovation(
      model.copula.innovation,
      [...path, "copula", "innovation"],
      issues,
    );
  }
  validateRegimes(model.regimes, assetIds.length, [...path, "regimes"], issues);
  if (!isRecord(model.enabled)) {
    issues.push(issue("MISSING", [...path, "enabled"], "Composite switches are required."));
  } else {
    for (const key of ["regimes", "dynamicVariance", "dependence", "jumps"] as const) {
      if (typeof model.enabled[key] !== "boolean") {
        issues.push(
          issue("MISSING", [...path, "enabled", key], `${key} must be boolean.`),
        );
      }
    }
  }
}

function validateRegimes(
  value: unknown,
  assetCount: number,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Composite regimes are required."));
    return;
  }
  if (
    !Array.isArray(value.labels) ||
    value.labels.length === 0 ||
    value.labels.some((label) => typeof label !== "string" || !label.trim()) ||
    new Set(value.labels).size !== value.labels.length
  ) {
    issues.push(
      issue("INVALID_DISTRIBUTION", [...path, "labels"], "Regime labels must be unique and non-empty."),
    );
    return;
  }
  const regimeCount = value.labels.length;
  validateProbabilityVector(
    value.initialProbabilities,
    regimeCount,
    [...path, "initialProbabilities"],
    issues,
  );
  if (!Array.isArray(value.transitionMatrix) || value.transitionMatrix.length !== regimeCount) {
    issues.push(
      issue(
        "DIMENSION_MISMATCH",
        [...path, "transitionMatrix"],
        "Transition matrix must have one row per regime.",
      ),
    );
  } else {
    value.transitionMatrix.forEach((row, index) =>
      validateProbabilityVector(
        row,
        regimeCount,
        [...path, "transitionMatrix", index],
        issues,
      ),
    );
  }
  if (!Array.isArray(value.annualDrifts) || value.annualDrifts.length !== regimeCount) {
    issues.push(
      issue(
        "DIMENSION_MISMATCH",
        [...path, "annualDrifts"],
        "Annual drifts must have one row per regime.",
      ),
    );
  } else {
    value.annualDrifts.forEach((row, regimeIndex) => {
      if (!Array.isArray(row) || row.length !== assetCount) {
        issues.push(
          issue(
            "DIMENSION_MISMATCH",
            [...path, "annualDrifts", regimeIndex],
            "Each regime needs one drift per asset.",
          ),
        );
        return;
      }
      row.forEach((drift, assetIndex) =>
        validateFiniteNumber(
          drift,
          [...path, "annualDrifts", regimeIndex, assetIndex],
          issues,
        ),
      );
    });
  }
}

function validateGarchVariance(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "GARCH variance parameters are required."));
    return;
  }
  validatePositiveNumber(value.omega, [...path, "omega"], issues);
  validateNonNegativeNumber(value.alpha, [...path, "alpha"], issues);
  validateNonNegativeNumber(value.beta, [...path, "beta"], issues);
  if (value.initialVariance !== "unconditional") {
    validatePositiveNumber(value.initialVariance, [...path, "initialVariance"], issues);
  } else if (
    typeof value.alpha === "number" &&
    typeof value.beta === "number" &&
    value.alpha + value.beta >= 1
  ) {
    issues.push(
      issue(
        "INVALID_DISTRIBUTION",
        [...path, "initialVariance"],
        "Unconditional initialization requires alpha + beta below one.",
      ),
    );
  }
}

function validateJump(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Jump parameters are required."));
    return;
  }
  validateNonNegativeNumber(value.annualIntensity, [...path, "annualIntensity"], issues);
  validateFiniteNumber(value.meanLogJump, [...path, "meanLogJump"], issues);
  validateNonNegativeNumber(
    value.logJumpVolatility,
    [...path, "logJumpVolatility"],
    issues,
  );
}

function validateInnovation(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value) || (value.kind !== "gaussian" && value.kind !== "student-t")) {
    issues.push(
      issue("UNSUPPORTED_MODEL", [...path, "kind"], "Innovation must be Gaussian or Student-t."),
    );
    return;
  }
  if (value.kind === "student-t") {
    validateFiniteNumber(value.degreesOfFreedom, [...path, "degreesOfFreedom"], issues);
    if (typeof value.degreesOfFreedom === "number" && value.degreesOfFreedom <= 2) {
      issues.push(
        issue(
          "OUT_OF_RANGE",
          [...path, "degreesOfFreedom"],
          "Student-t degrees of freedom must exceed two so variance exists.",
        ),
      );
    }
  }
}

function validateCorrelation(
  value: unknown,
  dimension: number,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (
    !Array.isArray(value) ||
    value.length !== dimension ||
    value.some((row) => !Array.isArray(row) || row.length !== dimension)
  ) {
    issues.push(
      issue("DIMENSION_MISMATCH", path, "Correlation matrix must match the asset count."),
    );
    return;
  }
  try {
    factorCorrelationMatrix(value as NumericMatrix);
  } catch (error) {
    issues.push(
      issue(
        error instanceof QuantError && error.code === "NOT_POSITIVE_SEMIDEFINITE"
          ? "INVALID_DISTRIBUTION"
          : "OUT_OF_RANGE",
        path,
        error instanceof Error ? error.message : "Correlation matrix is invalid.",
      ),
    );
  }
}

function validateProbabilityVector(
  value: unknown,
  expectedLength: number,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    issues.push(
      issue("DIMENSION_MISMATCH", path, "Probability vector has the wrong length."),
    );
    return;
  }
  let total = 0;
  value.forEach((probability, index) => {
    validateFiniteNumber(probability, [...path, index], issues);
    if (typeof probability === "number") {
      total += probability;
      if (probability < 0 || probability > 1) {
        issues.push(
          issue("OUT_OF_RANGE", [...path, index], "Probability must lie in [0, 1]."),
        );
      }
    }
  });
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    issues.push(
      issue("INVALID_DISTRIBUTION", path, "Probabilities must sum to one."),
    );
  }
}

function validatePrimaryCaseId(
  value: unknown,
  cases: readonly unknown[] | null,
  issues: PortfolioLabV2Issue[],
): void {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(issue("MISSING", ["primaryCaseId"], "Primary case ID is required."));
    return;
  }
  const ids = new Set(
    (cases ?? [])
      .filter(isRecord)
      .map((requestCase) => requestCase.id)
      .filter((id): id is string => typeof id === "string"),
  );
  if (!ids.has(value)) {
    issues.push(
      issue(
        "INVALID_REFERENCE",
        ["primaryCaseId"],
        "Primary case ID must reference a requested case.",
      ),
    );
  }
}

function validateRisk(value: unknown, issues: PortfolioLabV2Issue[]): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", ["risk"], "Risk settings are required."));
    return;
  }
  validateFiniteNumber(value.confidenceLevel, ["risk", "confidenceLevel"], issues);
  if (
    typeof value.confidenceLevel === "number" &&
    (value.confidenceLevel <= 0.5 || value.confidenceLevel >= 1)
  ) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        ["risk", "confidenceLevel"],
        "Risk confidence must be above 0.5 and below 1.",
      ),
    );
  }
}

function validateExecution(value: unknown, issues: PortfolioLabV2Issue[]): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", ["execution"], "Execution settings are required."));
    return;
  }
  validateInteger(value.seed, ["execution", "seed"], issues, 0, 0xffffffff);
  validateInteger(value.paths, ["execution", "paths"], issues, 2, PORTFOLIO_LAB_V2_LIMITS.paths);
  validateInteger(value.steps, ["execution", "steps"], issues, 1, PORTFOLIO_LAB_V2_LIMITS.steps);
  validatePositiveNumber(value.stepYears, ["execution", "stepYears"], issues);
  if (value.samplePaths !== undefined) {
    validateInteger(
      value.samplePaths,
      ["execution", "samplePaths"],
      issues,
      1,
      PORTFOLIO_LAB_V2_LIMITS.samplePaths,
    );
    if (
      typeof value.samplePaths === "number" &&
      typeof value.paths === "number" &&
      value.samplePaths > value.paths
    ) {
      issues.push(
        issue(
          "OUT_OF_RANGE",
          ["execution", "samplePaths"],
          "Sample path count cannot exceed simulated paths.",
        ),
      );
    }
  }
}

function validateRebalance(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (!isRecord(value) || (value.kind !== "never" && value.kind !== "periodic")) {
    issues.push(issue("MISSING", path, "Rebalance policy must be never or periodic."));
    return;
  }
  if (value.kind === "periodic") {
    validateInteger(value.everySteps, [...path, "everySteps"], issues, 1, PORTFOLIO_LAB_V2_LIMITS.steps);
  }
}

function validateAssetIdentity(
  value: unknown,
  expected: string,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (value !== expected) {
    issues.push(
      issue(
        "DIMENSION_MISMATCH",
        path,
        `Expected asset ID ${expected}; model assets must use plan order.`,
      ),
    );
  }
}

function validateInteger(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
  minimum: number,
  maximum: number,
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue("NOT_FINITE", path, "Value must be a finite integer."));
  } else if (!Number.isSafeInteger(value)) {
    issues.push(issue("NOT_INTEGER", path, "Value must be an integer."));
  } else if (value < minimum || value > maximum) {
    issues.push(
      issue("OUT_OF_RANGE", path, `Value must be between ${minimum} and ${maximum}.`),
    );
  }
}

function validateFiniteNumber(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue("NOT_FINITE", path, "Value must be finite."));
  }
}

function validatePositiveNumber(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  validateFiniteNumber(value, path, issues);
  if (typeof value === "number" && value <= 0) {
    issues.push(issue("OUT_OF_RANGE", path, "Value must be positive."));
  }
}

function validateNonNegativeNumber(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabV2Issue[],
): void {
  validateFiniteNumber(value, path, issues);
  if (typeof value === "number" && value < 0) {
    issues.push(issue("OUT_OF_RANGE", path, "Value must be non-negative."));
  }
}

function sampleCategorical(probabilities: readonly number[], uniform: number): number {
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (uniform <= cumulative) return index;
  }
  return probabilities.length - 1;
}

function identityMatrix(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => Number(row === column)),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ascending(left: number, right: number): number {
  return left - right;
}

function issue(
  code: PortfolioLabV2Issue["code"],
  path: IssuePath,
  message: string,
): PortfolioLabV2Issue {
  return { code, path, message };
}

function invalidProblem(
  issues: readonly PortfolioLabV2Issue[],
): PortfolioLabV2Problem {
  return {
    contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
    code: "INVALID_REQUEST",
    message: "The portfolio-lab request is invalid.",
    issues,
  };
}

function resourceProblem(
  resource: Extract<PortfolioLabV2Problem, { code: "RESOURCE_LIMIT" }>["resource"],
  requested: number,
  limit: number,
): PortfolioLabV2Problem {
  return {
    contract: PORTFOLIO_LAB_V2_CONTRACT.problem,
    code: "RESOURCE_LIMIT",
    message: `${resource.toLowerCase()} exceeds the portfolio-lab v2 limit.`,
    resource,
    requested,
    limit,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
