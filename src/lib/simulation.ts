import type {
  PercentileSeries,
  RegimeProbabilities,
  SimulationCaseResult,
  SimulationInputs,
  SimulationMetrics,
  SimulationModel,
  SimulationResult,
} from "../types/simulation";
import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type MarketCase,
  type PortfolioCaseDetail,
  type PortfolioLabRequest,
  type PortfolioMetrics,
} from "./portfolio-lab/contracts";
import {
  executeValidatedPortfolioLabRequest,
  executeValidatedPortfolioLabRequestCooperatively,
  selectPortfolioLabSampleIndexes,
} from "./portfolio-lab/engine";
import { REGIME_ORDER } from "./regimes";

export {
  PortfolioLabEngineCancelledError as SimulationCancelledError,
  sampleRegime,
} from "./portfolio-lab/engine";

const DEFAULT_PATH_COUNT = 1_000;
const MONTHS_PER_YEAR = 12;
const LEGACY_GBM_CASE_ID = asPortfolioCaseId("legacy/gbm");
const LEGACY_HMM_CASE_ID = asPortfolioCaseId("legacy/hmm");

export function runSimulation(rawInputs: SimulationInputs): SimulationResult {
  const { inputs, monthCount } = prepareSimulation(rawInputs);
  const request = buildPortfolioLabRequest(inputs, monthCount, [
    "constant",
    "hmm",
  ]);
  const result = executeValidatedPortfolioLabRequest(request);
  const selectedResult = toSimulationCaseResult(result.primary);
  const comparisonMetrics = toLegacyComparisonMetrics(result);

  return {
    ...selectedResult,
    inputs,
    months: Array.from({ length: monthCount + 1 }, (_, month) => month),
    comparisonMetrics,
    computedAt: Date.now(),
  };
}

export const simulatePortfolio = runSimulation;

export async function runSimulationCase(
  rawInputs: SimulationInputs,
  signal: AbortSignal,
): Promise<SimulationCaseResult> {
  const { inputs, monthCount } = prepareSimulation(rawInputs);
  const request = buildPortfolioLabRequest(inputs, monthCount, [inputs.model]);
  const result = await executeValidatedPortfolioLabRequestCooperatively(
    request,
    signal,
  );

  return toSimulationCaseResult(result.primary);
}

export const selectSimulationSampleIndexes =
  selectPortfolioLabSampleIndexes;

function prepareSimulation(rawInputs: SimulationInputs): {
  readonly inputs: SimulationInputs;
  readonly monthCount: number;
} {
  const inputs = normalizeInputs(rawInputs);
  return {
    inputs,
    monthCount: Math.round(inputs.horizonYears * MONTHS_PER_YEAR),
  };
}

function buildPortfolioLabRequest(
  inputs: SimulationInputs,
  monthCount: number,
  requestedModels: readonly SimulationModel[],
): PortfolioLabRequest {
  const cases = requestedModels.map((model) =>
    model === "constant" ? buildGbmCase(inputs) : buildHmmCase(inputs),
  );

  return {
    contract: PORTFOLIO_LAB_CONTRACT.request,
    plan: {
      initialCapital: inputs.initialCapital,
      contributionPerStep: inputs.monthlyContribution,
      targetWeights: {
        stocks: inputs.stockAllocation,
        bonds: 1 - inputs.stockAllocation,
      },
      rebalance: toPortfolioLabRebalance(inputs.rebalanceFrequency),
      annualInflationRate: inputs.inflationRate,
      targetValue: inputs.targetValue,
    },
    primaryCaseId:
      inputs.model === "constant"
        ? LEGACY_GBM_CASE_ID
        : LEGACY_HMM_CASE_ID,
    cases,
    execution: {
      seed: inputs.seed,
      paths: inputs.pathCount,
      steps: monthCount,
      stepYears: 1 / MONTHS_PER_YEAR,
    },
  };
}

function buildGbmCase(inputs: SimulationInputs): MarketCase {
  return {
    id: LEGACY_GBM_CASE_ID,
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

function buildHmmCase(inputs: SimulationInputs): MarketCase {
  return {
    id: LEGACY_HMM_CASE_ID,
    label: "Regime switching",
    model: {
      contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
      kind: "hmm",
      regimes: Object.fromEntries(
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
      ) as Extract<MarketCase["model"], { kind: "hmm" }>["regimes"],
      transitionMatrix: inputs.hmm.transitionMatrix,
      initialStateProbabilities: inputs.hmm.currentStateProbabilities,
    },
  };
}

function toPortfolioLabRebalance(
  frequency: SimulationInputs["rebalanceFrequency"],
): PortfolioLabRequest["plan"]["rebalance"] {
  if (frequency === "never") {
    return { kind: "never" };
  }

  return {
    kind: "periodic",
    everySteps: frequency === "monthly" ? 1 : MONTHS_PER_YEAR,
  };
}

function toSimulationCaseResult(
  detail: PortfolioCaseDetail,
): SimulationCaseResult {
  const { distribution } = detail;

  return {
    samplePaths: detail.samples.map((sample) => [...sample.wealth.values]),
    sampleDrawdownPaths: detail.samples.map((sample) => [
      ...sample.drawdown.values,
    ]),
    pathPercentiles: toLegacyPercentiles(
      distribution.wealthPercentiles,
    ),
    drawdownPercentiles: toLegacyPercentiles(
      distribution.drawdownPercentiles,
    ),
    terminalValues: [...distribution.terminalWealth.values],
    maxDrawdowns: [...distribution.maximumDrawdowns.values],
    sampleRegimePaths:
      detail.model === "hmm"
        ? detail.diagnostics.sampledStatePaths.map((path) => [
            ...path.states,
          ])
        : [],
    regimeOccupancy:
      detail.model === "hmm"
        ? { ...detail.diagnostics.regimeOccupancy }
        : null,
    metrics: toLegacyMetrics(detail.metrics),
  };
}

function toLegacyComparisonMetrics(
  result: ReturnType<typeof executeValidatedPortfolioLabRequest>,
): Record<SimulationModel, SimulationMetrics> {
  const metrics: Partial<Record<SimulationModel, SimulationMetrics>> = {};

  for (const summary of [result.primary, ...result.comparisons]) {
    metrics[summary.model === "gbm" ? "constant" : "hmm"] =
      toLegacyMetrics(summary.metrics);
  }

  if (!metrics.constant || !metrics.hmm) {
    throw new Error("The legacy simulation requires GBM and HMM summaries.");
  }

  return {
    constant: metrics.constant,
    hmm: metrics.hmm,
  };
}

function toLegacyMetrics(metrics: PortfolioMetrics): SimulationMetrics {
  return {
    medianTerminalValue: metrics.wealth.medianTerminalValue,
    meanTerminalValue: metrics.wealth.meanTerminalValue,
    medianRealValue: metrics.wealth.medianRealTerminalValue,
    probabilityOfTarget: metrics.goal.probabilityOfTarget,
    probabilityOfLoss: metrics.loss.probabilityBelowContributions,
    medianMaxDrawdown: metrics.drawdown.medianMaximumDrawdown,
    probabilityOfThirtyPercentDrawdown:
      metrics.drawdown.probabilityOverThirtyPercent,
    probabilityOfUnrecoveredDrawdown:
      metrics.drawdown.probabilityUnrecovered,
    averageRecoveryMonths:
      metrics.drawdown.averageCompletedRecoverySteps,
    expectedShortfall: metrics.loss.tailCapitalShortfall,
    averageTargetShortfall: metrics.goal.averageShortfallRatio,
    totalContributed: metrics.wealth.totalContributed,
  };
}

function toLegacyPercentiles(
  percentiles:
    | PortfolioCaseDetail["distribution"]["wealthPercentiles"]
    | PortfolioCaseDetail["distribution"]["drawdownPercentiles"],
): PercentileSeries {
  return {
    p05: [...percentiles.p05.values],
    p10: [...percentiles.p10.values],
    p50: [...percentiles.p50.values],
    p90: [...percentiles.p90.values],
    p95: [...percentiles.p95.values],
  };
}

function normalizeInputs(rawInputs: SimulationInputs): SimulationInputs {
  if (!rawInputs || typeof rawInputs !== "object") {
    throw new Error("Simulation inputs are required");
  }

  const inputs: SimulationInputs = {
    ...rawInputs,
    stocks: { ...rawInputs.stocks },
    bonds: { ...rawInputs.bonds },
    hmm: {
      regimes: Object.fromEntries(
        REGIME_ORDER.map((regime) => [
          regime,
          {
            stocks: { ...rawInputs.hmm.regimes[regime].stocks },
            bonds: { ...rawInputs.hmm.regimes[regime].bonds },
            correlation: rawInputs.hmm.regimes[regime].correlation,
          },
        ]),
      ) as SimulationInputs["hmm"]["regimes"],
      transitionMatrix: Object.fromEntries(
        REGIME_ORDER.map((regime) => [
          regime,
          { ...rawInputs.hmm.transitionMatrix[regime] },
        ]),
      ) as SimulationInputs["hmm"]["transitionMatrix"],
      currentStateProbabilities: {
        ...rawInputs.hmm.currentStateProbabilities,
      },
    },
    pathCount: rawInputs.pathCount ?? DEFAULT_PATH_COUNT,
    seed: Math.trunc(rawInputs.seed),
  };

  validateInputs(inputs);
  return inputs;
}

function validateInputs(inputs: SimulationInputs): void {
  assertNonNegative("initialCapital", inputs.initialCapital);
  assertNonNegative("monthlyContribution", inputs.monthlyContribution);
  assertPositive("horizonYears", inputs.horizonYears);
  assertInRange("stockAllocation", inputs.stockAllocation, 0, 1);
  assertAssetAssumptions("stocks", inputs.stocks);
  assertAssetAssumptions("bonds", inputs.bonds);
  assertInRange("correlation", inputs.correlation, -1, 1);
  assertHMMConfiguration(inputs);
  assertFiniteNumber("inflationRate", inputs.inflationRate);
  assertNonNegative("targetValue", inputs.targetValue);
  assertPositiveInteger("pathCount", inputs.pathCount);
  assertFiniteNumber("seed", inputs.seed);

  if (inputs.inflationRate <= -1) {
    throw new Error("inflationRate must be greater than -1");
  }
  if (Math.round(inputs.horizonYears * MONTHS_PER_YEAR) < 1) {
    throw new Error("horizonYears must include at least one month");
  }
  if (!["monthly", "annual", "never"].includes(inputs.rebalanceFrequency)) {
    throw new Error("rebalanceFrequency is invalid");
  }
  if (!["constant", "hmm"].includes(inputs.model)) {
    throw new Error("model is invalid");
  }
}

function assertHMMConfiguration(inputs: SimulationInputs): void {
  if (!inputs.hmm || typeof inputs.hmm !== "object") {
    throw new Error("hmm configuration is required");
  }

  for (const regime of REGIME_ORDER) {
    const assumptions = inputs.hmm.regimes?.[regime];
    if (!assumptions || typeof assumptions !== "object") {
      throw new Error(`hmm.regimes.${regime} assumptions are required`);
    }
    assertAssetAssumptions(
      `hmm.regimes.${regime}.stocks`,
      assumptions.stocks,
    );
    assertAssetAssumptions(
      `hmm.regimes.${regime}.bonds`,
      assumptions.bonds,
    );
    assertInRange(
      `hmm.regimes.${regime}.correlation`,
      assumptions.correlation,
      -1,
      1,
    );
    assertProbabilityDistribution(
      `hmm.transitionMatrix.${regime}`,
      inputs.hmm.transitionMatrix?.[regime],
    );
  }

  assertProbabilityDistribution(
    "hmm.currentStateProbabilities",
    inputs.hmm.currentStateProbabilities,
  );
}

function assertProbabilityDistribution(
  name: string,
  probabilities: RegimeProbabilities | undefined,
): void {
  if (!probabilities || typeof probabilities !== "object") {
    throw new Error(`${name} is required`);
  }

  let sum = 0;
  for (const regime of REGIME_ORDER) {
    assertInRange(`${name}.${regime}`, probabilities[regime], 0, 1);
    sum += probabilities[regime];
  }

  if (Math.abs(sum - 1) > 1e-8) {
    throw new Error(`${name} probabilities must sum to 1`);
  }
}

function assertAssetAssumptions(
  name: string,
  assumptions: SimulationInputs["stocks"],
): void {
  if (!assumptions || typeof assumptions !== "object") {
    throw new Error(`${name} assumptions are required`);
  }
  assertFiniteNumber(`${name}.expectedReturn`, assumptions.expectedReturn);
  assertNonNegative(`${name}.volatility`, assumptions.volatility);
}

function assertInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  assertFiniteNumber(name, value);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function assertNonNegative(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertPositive(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}
