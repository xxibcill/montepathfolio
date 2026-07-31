import type {
  PercentileSeries,
  SimulationInputs,
  SimulationMetrics,
  SimulationResult,
} from "../types/simulation";

const DEFAULT_PATH_COUNT = 1_000;
const MAX_SAMPLE_PATHS = 160;
const MONTHS_PER_YEAR = 12;
const THIRTY_PERCENT_DRAWDOWN = 0.3;

interface MonthlyModel {
  stockDrift: number;
  stockDiffusion: number;
  bondDrift: number;
  bondDiffusion: number;
  independentBondWeight: number;
}

interface PathAnalysis {
  values: number[];
  drawdowns: number[];
  maxDrawdown: number;
  recoveryMonths: number[];
  hasUnrecoveredDrawdown: boolean;
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
  const paths = simulatePaths(inputs, monthCount);
  const pathValues = paths.map((path) => path.values);
  const drawdownValues = paths.map((path) => path.drawdowns);
  const terminalValues = paths.map((path) => path.values[monthCount]);
  const maxDrawdowns = paths.map((path) => path.maxDrawdown);
  const recoveryMonths = paths.flatMap((path) => path.recoveryMonths);
  const unrecoveredDrawdownCount = paths.filter(
    (path) => path.hasUnrecoveredDrawdown,
  ).length;

  return {
    inputs,
    months: Array.from({ length: monthCount + 1 }, (_, month) => month),
    samplePaths: selectSamplePaths(pathValues),
    sampleDrawdownPaths: selectSamplePaths(drawdownValues),
    pathPercentiles: buildPercentileSeries(pathValues, monthCount + 1),
    drawdownPercentiles: buildPercentileSeries(drawdownValues, monthCount + 1),
    terminalValues,
    maxDrawdowns,
    metrics: buildMetrics(inputs, monthCount, {
      terminalValues,
      maxDrawdowns,
      recoveryMonths,
      unrecoveredDrawdownCount,
    }),
    computedAt: Date.now(),
  };
}

export const simulatePortfolio = runSimulation;

function simulatePaths(
  inputs: SimulationInputs,
  monthCount: number,
): PathAnalysis[] {
  const model = createMonthlyModel(inputs);
  const paths: PathAnalysis[] = [];

  for (let pathIndex = 0; pathIndex < inputs.pathCount; pathIndex += 1) {
    const pathSeed = derivePathSeed(inputs.seed, pathIndex);
    const nextNormal = createNormalGenerator(pathSeed);
    paths.push(simulatePath(inputs, monthCount, model, nextNormal));
  }

  return paths;
}

function simulatePath(
  inputs: SimulationInputs,
  monthCount: number,
  model: MonthlyModel,
  nextNormal: () => number,
): PathAnalysis {
  let stockValue = inputs.initialCapital * inputs.stockAllocation;
  let bondValue = inputs.initialCapital - stockValue;
  let navStockValue = inputs.stockAllocation;
  let navBondValue = 1 - inputs.stockAllocation;
  const values = [inputs.initialCapital];
  const navValues = [1];

  for (let month = 1; month <= monthCount; month += 1) {
    const stockShock = nextNormal();
    const bondShock =
      inputs.correlation * stockShock +
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

  return { values, ...analyzeDrawdowns(navValues) };
}

function createMonthlyModel(inputs: SimulationInputs): MonthlyModel {
  const stockVariance = inputs.stocks.volatility ** 2;
  const bondVariance = inputs.bonds.volatility ** 2;

  return {
    stockDrift: (inputs.stocks.expectedReturn - stockVariance / 2) / 12,
    stockDiffusion: inputs.stocks.volatility / Math.sqrt(12),
    bondDrift: (inputs.bonds.expectedReturn - bondVariance / 2) / 12,
    bondDiffusion: inputs.bonds.volatility / Math.sqrt(12),
    independentBondWeight: Math.sqrt(
      Math.max(0, 1 - inputs.correlation ** 2),
    ),
  };
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

function analyzeDrawdowns(values: number[]): Omit<PathAnalysis, "values"> {
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

function selectSamplePaths(paths: number[][]): number[][] {
  if (paths.length <= MAX_SAMPLE_PATHS) {
    return paths;
  }

  return Array.from({ length: MAX_SAMPLE_PATHS }, (_, sampleIndex) => {
    const pathIndex = Math.round(
      (sampleIndex * (paths.length - 1)) / (MAX_SAMPLE_PATHS - 1),
    );
    return paths[pathIndex];
  });
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
