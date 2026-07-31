import type {
  PercentileSeries,
  Regime,
  RegimeAssumptions,
  RegimeProbabilities,
  SimulationModel,
  SimulationInputs,
  SimulationMetrics,
  SimulationResult,
} from "../types/simulation";
import { REGIME_ORDER } from "./defaults";

const DEFAULT_PATH_COUNT = 1_000;
const MAX_SAMPLE_PATHS = 160;
const MONTHS_PER_YEAR = 12;
const THIRTY_PERCENT_DRAWDOWN = 0.3;

interface MonthlyModel {
  stockDrift: number;
  stockDiffusion: number;
  bondDrift: number;
  bondDiffusion: number;
  correlation: number;
  independentBondWeight: number;
}

interface PathAnalysis {
  values: number[];
  drawdowns: number[];
  maxDrawdown: number;
  recoveryMonths: number[];
  hasUnrecoveredDrawdown: boolean;
  regimes: Regime[];
}

interface MetricSources {
  terminalValues: number[];
  maxDrawdowns: number[];
  recoveryMonths: number[];
  unrecoveredDrawdownCount: number;
}

export function runSimulation(rawInputs: SimulationInputs): SimulationResult {
  const inputs = normalizeInputs(rawInputs);
  const monthCount = Math.round(inputs.horizonYears * MONTHS_PER_YEAR);
  // Both models use identical asset-shock streams. The HMM draws regimes from a
  // separate seeded stream so comparison deltas reflect the model, not luck.
  const pathsByModel: Record<SimulationModel, PathAnalysis[]> = {
    constant: simulatePaths(inputs, monthCount, "constant"),
    hmm: simulatePaths(inputs, monthCount, "hmm"),
  };
  const paths = pathsByModel[inputs.model];
  const pathValues = paths.map((path) => path.values);
  const drawdownValues = paths.map((path) => path.drawdowns);
  const terminalValues = paths.map((path) => path.values[monthCount]);
  const maxDrawdowns = paths.map((path) => path.maxDrawdown);
  const sampleIndexes = selectSampleIndexes(paths.length);
  const comparisonMetrics = {
    constant: buildMetricsFromPaths(
      inputs,
      monthCount,
      pathsByModel.constant,
    ),
    hmm: buildMetricsFromPaths(inputs, monthCount, pathsByModel.hmm),
  };

  return {
    inputs,
    months: Array.from({ length: monthCount + 1 }, (_, month) => month),
    samplePaths: sampleIndexes.map((index) => pathValues[index]),
    sampleDrawdownPaths: sampleIndexes.map((index) => drawdownValues[index]),
    pathPercentiles: buildPercentileSeries(pathValues, monthCount + 1),
    drawdownPercentiles: buildPercentileSeries(drawdownValues, monthCount + 1),
    terminalValues,
    maxDrawdowns,
    sampleRegimePaths:
      inputs.model === "hmm"
        ? sampleIndexes.map((index) => paths[index].regimes)
        : [],
    regimeOccupancy:
      inputs.model === "hmm" ? calculateRegimeOccupancy(paths) : null,
    metrics: comparisonMetrics[inputs.model],
    comparisonMetrics,
    computedAt: Date.now(),
  };
}

export const simulatePortfolio = runSimulation;

function simulatePaths(
  inputs: SimulationInputs,
  monthCount: number,
  modelType: SimulationModel,
): PathAnalysis[] {
  const constantModel = createMonthlyModel({
    stocks: inputs.stocks,
    bonds: inputs.bonds,
    correlation: inputs.correlation,
  });
  const regimeModels = Object.fromEntries(
    REGIME_ORDER.map((regime) => [
      regime,
      createMonthlyModel(inputs.hmm.regimes[regime]),
    ]),
  ) as Record<Regime, MonthlyModel>;
  const paths: PathAnalysis[] = [];

  for (let pathIndex = 0; pathIndex < inputs.pathCount; pathIndex += 1) {
    const pathSeed = derivePathSeed(inputs.seed, pathIndex);
    const nextNormal = createNormalGenerator(pathSeed);
    const regimeSeed = derivePathSeed(inputs.seed ^ 0x51f15e, pathIndex);
    const nextRegimeUniform = createUniformGenerator(regimeSeed);
    paths.push(
      simulatePath(
        inputs,
        monthCount,
        modelType,
        constantModel,
        regimeModels,
        nextNormal,
        nextRegimeUniform,
      ),
    );
  }

  return paths;
}

function simulatePath(
  inputs: SimulationInputs,
  monthCount: number,
  modelType: SimulationModel,
  constantModel: MonthlyModel,
  regimeModels: Record<Regime, MonthlyModel>,
  nextNormal: () => number,
  nextRegimeUniform: () => number,
): PathAnalysis {
  let stockValue = inputs.initialCapital * inputs.stockAllocation;
  let bondValue = inputs.initialCapital - stockValue;
  let navStockValue = inputs.stockAllocation;
  let navBondValue = 1 - inputs.stockAllocation;
  const values = [inputs.initialCapital];
  const navValues = [1];
  let regime =
    modelType === "hmm"
      ? sampleRegime(inputs.hmm.currentStateProbabilities, nextRegimeUniform())
      : null;
  const regimes: Regime[] = regime ? [regime] : [];

  for (let month = 1; month <= monthCount; month += 1) {
    if (regime) {
      regime = sampleRegime(
        inputs.hmm.transitionMatrix[regime],
        nextRegimeUniform(),
      );
      regimes.push(regime);
    }
    const model = regime ? regimeModels[regime] : constantModel;
    const stockShock = nextNormal();
    const bondShock =
      model.correlation * stockShock +
      model.independentBondWeight * nextNormal();
    const stockGrowth = Math.exp(
      model.stockDrift + model.stockDiffusion * stockShock,
    );
    const bondGrowth = Math.exp(
      model.bondDrift + model.bondDiffusion * bondShock,
    );

    stockValue *= stockGrowth;
    bondValue *= bondGrowth;
    navStockValue *= stockGrowth;
    navBondValue *= bondGrowth;
    stockValue += inputs.monthlyContribution * inputs.stockAllocation;
    bondValue += inputs.monthlyContribution * (1 - inputs.stockAllocation);

    if (shouldRebalance(inputs.rebalanceFrequency, month)) {
      const rebalanced = rebalance(stockValue, bondValue, inputs.stockAllocation);
      const rebalancedNav = rebalance(
        navStockValue,
        navBondValue,
        inputs.stockAllocation,
      );
      stockValue = rebalanced.stockValue;
      bondValue = rebalanced.bondValue;
      navStockValue = rebalancedNav.stockValue;
      navBondValue = rebalancedNav.bondValue;
    }

    const portfolioValue = stockValue + bondValue;
    const navValue = navStockValue + navBondValue;
    if (!Number.isFinite(portfolioValue) || !Number.isFinite(navValue)) {
      throw new Error("Asset assumptions produced a non-finite portfolio value");
    }
    values.push(portfolioValue);
    navValues.push(navValue);
  }

  return { values, regimes, ...analyzeDrawdowns(navValues) };
}

function createMonthlyModel(assumptions: RegimeAssumptions): MonthlyModel {
  const stockVariance = assumptions.stocks.volatility ** 2;
  const bondVariance = assumptions.bonds.volatility ** 2;

  return {
    stockDrift:
      (assumptions.stocks.expectedReturn - stockVariance / 2) /
      MONTHS_PER_YEAR,
    stockDiffusion:
      assumptions.stocks.volatility / Math.sqrt(MONTHS_PER_YEAR),
    bondDrift:
      (assumptions.bonds.expectedReturn - bondVariance / 2) /
      MONTHS_PER_YEAR,
    bondDiffusion:
      assumptions.bonds.volatility / Math.sqrt(MONTHS_PER_YEAR),
    correlation: assumptions.correlation,
    independentBondWeight: Math.sqrt(
      Math.max(0, 1 - assumptions.correlation ** 2),
    ),
  };
}

export function sampleRegime(
  probabilities: RegimeProbabilities,
  randomValue: number,
): Regime {
  let cumulativeProbability = 0;

  for (const regime of REGIME_ORDER) {
    cumulativeProbability += probabilities[regime];
    if (randomValue <= cumulativeProbability) {
      return regime;
    }
  }

  // Floating-point rounding can leave the cumulative value infinitesimally
  // below one. The final state is the deterministic fallback.
  return REGIME_ORDER.at(-1)!;
}

function shouldRebalance(
  frequency: SimulationInputs["rebalanceFrequency"],
  month: number,
): boolean {
  return (
    frequency === "monthly" || (frequency === "annual" && month % 12 === 0)
  );
}

function rebalance(
  stockValue: number,
  bondValue: number,
  stockAllocation: number,
): { stockValue: number; bondValue: number } {
  const portfolioValue = stockValue + bondValue;

  return {
    stockValue: portfolioValue * stockAllocation,
    bondValue: portfolioValue * (1 - stockAllocation),
  };
}

function analyzeDrawdowns(
  values: number[],
): Omit<PathAnalysis, "values" | "regimes"> {
  let peak = values[0];
  let underwaterSince: number | null = null;
  let maxDrawdown = 0;
  const drawdowns = [0];
  const recoveryMonths: number[] = [];

  for (let month = 1; month < values.length; month += 1) {
    const value = values[month];
    if (value >= peak) {
      if (underwaterSince !== null) {
        recoveryMonths.push(month - underwaterSince);
        underwaterSince = null;
      }
      peak = value;
      drawdowns.push(0);
      continue;
    }

    underwaterSince ??= month - 1;
    const drawdown = peak === 0 ? 0 : Math.max(0, 1 - value / peak);
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    drawdowns.push(drawdown);
  }

  return {
    drawdowns,
    maxDrawdown,
    recoveryMonths,
    hasUnrecoveredDrawdown: underwaterSince !== null,
  };
}

function buildPercentileSeries(
  paths: number[][],
  pointCount: number,
): PercentileSeries {
  const series: PercentileSeries = {
    p05: [],
    p10: [],
    p50: [],
    p90: [],
    p95: [],
  };

  for (let point = 0; point < pointCount; point += 1) {
    const values = paths
      .map((path) => path[point])
      .sort((left, right) => left - right);
    series.p05.push(percentile(values, 0.05));
    series.p10.push(percentile(values, 0.1));
    series.p50.push(percentile(values, 0.5));
    series.p90.push(percentile(values, 0.9));
    series.p95.push(percentile(values, 0.95));
  }

  return series;
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

function buildMetricsFromPaths(
  inputs: SimulationInputs,
  monthCount: number,
  paths: PathAnalysis[],
): SimulationMetrics {
  return buildMetrics(inputs, monthCount, {
    terminalValues: paths.map((path) => path.values[monthCount]),
    maxDrawdowns: paths.map((path) => path.maxDrawdown),
    recoveryMonths: paths.flatMap((path) => path.recoveryMonths),
    unrecoveredDrawdownCount: paths.filter(
      (path) => path.hasUnrecoveredDrawdown,
    ).length,
  });
}

function calculateRegimeOccupancy(
  paths: PathAnalysis[],
): RegimeProbabilities {
  const counts: RegimeProbabilities = { bull: 0, bear: 0, sideways: 0 };
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

function buildMetrics(
  inputs: SimulationInputs,
  monthCount: number,
  sources: MetricSources,
): SimulationMetrics {
  const {
    terminalValues,
    maxDrawdowns,
    recoveryMonths,
    unrecoveredDrawdownCount,
  } = sources;
  const sortedTerminalValues = [...terminalValues].sort(
    (left, right) => left - right,
  );
  const sortedMaxDrawdowns = [...maxDrawdowns].sort(
    (left, right) => left - right,
  );
  const totalContributed =
    inputs.initialCapital + inputs.monthlyContribution * monthCount;
  const inflationFactor = (1 + inputs.inflationRate) ** (monthCount / 12);
  const medianTerminalValue = percentile(sortedTerminalValues, 0.5);
  const tailCount = Math.max(1, Math.ceil(sortedTerminalValues.length * 0.05));
  const expectedShortfall = mean(
    sortedTerminalValues
      .slice(0, tailCount)
      .map((value) =>
        totalContributed === 0
          ? 0
          : Math.max(0, 1 - value / totalContributed),
      ),
  );

  return {
    medianTerminalValue,
    meanTerminalValue: mean(terminalValues),
    medianRealValue: medianTerminalValue / inflationFactor,
    probabilityOfTarget:
      countWhere(terminalValues, (value) => value >= inputs.targetValue) /
      terminalValues.length,
    probabilityOfLoss:
      countWhere(terminalValues, (value) => value < totalContributed) /
      terminalValues.length,
    medianMaxDrawdown: percentile(sortedMaxDrawdowns, 0.5),
    probabilityOfThirtyPercentDrawdown:
      countWhere(
        maxDrawdowns,
        (drawdown) => drawdown > THIRTY_PERCENT_DRAWDOWN,
      ) / maxDrawdowns.length,
    probabilityOfUnrecoveredDrawdown:
      unrecoveredDrawdownCount / maxDrawdowns.length,
    // Open episodes are reported separately and are not assigned a duration.
    averageRecoveryMonths:
      recoveryMonths.length === 0 ? null : mean(recoveryMonths),
    expectedShortfall,
    totalContributed,
  };
}

function percentile(sortedValues: number[], probability: number): number {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const interpolationWeight = position - lowerIndex;

  return (
    sortedValues[lowerIndex] * (1 - interpolationWeight) +
    sortedValues[upperIndex] * interpolationWeight
  );
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countWhere(
  values: number[],
  predicate: (value: number) => boolean,
): number {
  return values.reduce(
    (count, value) => count + Number(predicate(value)),
    0,
  );
}

function createNormalGenerator(seed: number): () => number {
  const nextUniform = createUniformGenerator(seed);
  let spareNormal: number | null = null;

  return () => {
    if (spareNormal !== null) {
      const normal = spareNormal;
      spareNormal = null;
      return normal;
    }

    let firstUniform = nextUniform();
    while (firstUniform === 0) {
      firstUniform = nextUniform();
    }
    const secondUniform = nextUniform();
    const magnitude = Math.sqrt(-2 * Math.log(firstUniform));
    const angle = 2 * Math.PI * secondUniform;
    spareNormal = magnitude * Math.sin(angle);

    return magnitude * Math.cos(angle);
  };
}

function derivePathSeed(seed: number, pathIndex: number): number {
  let value =
    (Math.trunc(seed) + Math.imul(pathIndex + 1, 0x9e3779b9)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);

  return (value ^ (value >>> 16)) >>> 0;
}

function createUniformGenerator(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
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
