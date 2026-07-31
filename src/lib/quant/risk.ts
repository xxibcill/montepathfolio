import {
  QUANT_CORE_VERSION,
  QuantError,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  assertProbability,
  cholesky,
  clamp,
  createSemanticRandom,
  inverseNormalCdf,
  matrixVectorMultiply,
  mean,
  normalPdf,
  quantile,
  sampleVariance,
  type ModelEnvelope,
  type NumericMatrix,
} from "./core";

export const RISK_LAB_VERSION = "risk-lab@1";

export type LossSeries = {
  readonly kind: "positive-loss";
  readonly values: readonly number[];
};

export interface RiskDataProvenance {
  readonly label: string;
  readonly kind: "illustrative" | "user-imported" | "historical";
}

export interface HistoricalRiskMethod {
  readonly kind: "historical";
  /** Positive values are losses; negative values are gains. */
  readonly losses: LossSeries;
  readonly provenance?: RiskDataProvenance;
}

export interface ParametricRiskMethod {
  readonly kind: "parametric-normal";
  /** Per-period arithmetic mean return. */
  readonly meanReturn: number;
  /** Per-period return standard deviation. */
  readonly volatility: number;
}

export interface MonteCarloRiskMethod {
  readonly kind: "monte-carlo-normal";
  readonly meanReturn: number;
  readonly volatility: number;
  readonly seed: number;
  readonly samples: number;
}

export interface VarCvarInput {
  readonly contract: "risk-lab/var-cvar@1";
  readonly method:
    | HistoricalRiskMethod
    | ParametricRiskMethod
    | MonteCarloRiskMethod;
  readonly confidenceLevel: number;
  readonly holdingPeriods: number;
  readonly portfolioValue: number;
}

export interface VarCvarResult {
  readonly contract: "risk-lab/var-cvar-result@1";
  readonly method: VarCvarInput["method"]["kind"];
  readonly valueAtRisk: number;
  readonly conditionalValueAtRisk: number;
  readonly confidenceLevel: number;
  readonly holdingPeriods: number;
  readonly tailObservationCount: number | null;
  readonly finiteSampleConvention:
    | "all-observations-at-or-above-r7-var"
    | "analytical-normal-tail";
  readonly lossConvention: "positive-values-are-losses";
  readonly sampledLosses?: LossSeries;
  readonly dataProvenance?: RiskDataProvenance;
}

export function calculateVarCvar(
  input: VarCvarInput,
): ModelEnvelope<VarCvarResult> {
  validateRiskInput(input);
  if (input.method.kind === "parametric-normal") {
    return parametricVarCvar(input, input.method);
  }
  const sampledLosses =
    input.method.kind === "historical"
      ? scaleHistoricalLosses(input)
      : simulateMonteCarloLosses(input, input.method);
  const valueAtRisk = Math.max(0, quantile(sampledLosses.values, input.confidenceLevel));
  const tail = sampledLosses.values.filter((loss) => loss >= valueAtRisk);
  const conditionalValueAtRisk = Math.max(valueAtRisk, mean(tail));
  return envelope(input, {
    contract: "risk-lab/var-cvar-result@1",
    method: input.method.kind,
    valueAtRisk,
    conditionalValueAtRisk,
    confidenceLevel: input.confidenceLevel,
    holdingPeriods: input.holdingPeriods,
    tailObservationCount: tail.length,
    finiteSampleConvention: "all-observations-at-or-above-r7-var",
    lossConvention: "positive-values-are-losses",
    sampledLosses,
    dataProvenance:
      input.method.kind === "historical"
        ? input.method.provenance
        : undefined,
  });
}

export interface ParametricRiskAttributionInput {
  readonly contract: "risk-lab/parametric-attribution@1";
  readonly weights: readonly number[];
  readonly covariance: NumericMatrix;
  readonly portfolioValue: number;
  readonly confidenceLevel: number;
}

export interface ParametricRiskAttributionResult {
  readonly contract: "risk-lab/parametric-attribution-result@1";
  readonly portfolioVolatility: number;
  readonly valueAtRisk: number;
  readonly marginalContributions: readonly number[];
  readonly componentContributions: readonly number[];
  readonly contributionSum: number;
}

export function calculateParametricRiskAttribution(
  input: ParametricRiskAttributionInput,
): ParametricRiskAttributionResult {
  if (input.contract !== "risk-lab/parametric-attribution@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported parametric-attribution contract.");
  }
  validateWeightCovariance(input.weights, input.covariance);
  assertPositive(input.portfolioValue, "portfolioValue");
  validateConfidence(input.confidenceLevel);
  const covarianceTimesWeights = matrixVectorMultiply(input.covariance, input.weights);
  const variance = input.weights.reduce(
    (total, weight, index) => total + weight * covarianceTimesWeights[index],
    0,
  );
  const portfolioVolatility = Math.sqrt(Math.max(0, variance));
  const z = inverseNormalCdf(input.confidenceLevel);
  const marginalContributions = covarianceTimesWeights.map((value) =>
    portfolioVolatility === 0
      ? 0
      : (z * input.portfolioValue * value) / portfolioVolatility,
  );
  const componentContributions = marginalContributions.map(
    (marginal, index) => marginal * input.weights[index],
  );
  return {
    contract: "risk-lab/parametric-attribution-result@1",
    portfolioVolatility,
    valueAtRisk: z * input.portfolioValue * portfolioVolatility,
    marginalContributions,
    componentContributions,
    contributionSum: componentContributions.reduce((total, value) => total + value, 0),
  };
}

export interface VarBacktestInput {
  readonly contract: "risk-lab/var-backtest@1";
  readonly returns: readonly number[];
  readonly estimationWindow: number;
  readonly confidenceLevel: number;
  readonly portfolioValue: number;
  readonly method: "historical" | "parametric-normal";
  readonly timestamps?: readonly string[];
  readonly provenance?: RiskDataProvenance;
}

export interface VarBacktestPoint {
  readonly testIndex: number;
  readonly estimationStartIndex: number;
  readonly estimationEndIndex: number;
  readonly valueAtRisk: number;
  readonly realizedLoss: number;
  readonly breached: boolean;
  readonly testTimestamp?: string;
}

export interface VarBacktestResult {
  readonly contract: "risk-lab/var-backtest-result@1";
  readonly points: readonly VarBacktestPoint[];
  readonly breaches: number;
  readonly expectedBreaches: number;
  readonly breachRate: number;
  readonly kupiecLikelihoodRatio: number;
  readonly warnings: readonly string[];
  readonly dataProvenance?: RiskDataProvenance;
}

export function backtestValueAtRisk(input: VarBacktestInput): VarBacktestResult {
  if (input.contract !== "risk-lab/var-backtest@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported VaR-backtest contract.");
  }
  if (input.method !== "historical" && input.method !== "parametric-normal") {
    throw new QuantError("INVALID_INPUT", "Unsupported VaR-backtest method.");
  }
  assertIntegerInRange(
    input.estimationWindow,
    2,
    input.returns.length - 1,
    "estimationWindow",
  );
  validateConfidence(input.confidenceLevel);
  assertPositive(input.portfolioValue, "portfolioValue");
  input.returns.forEach((value, index) => assertFinite(value, `returns.${index}`));
  if (input.timestamps) {
    if (input.timestamps.length !== input.returns.length) {
      throw new QuantError("DIMENSION_MISMATCH", "Backtest timestamps must align with returns.");
    }
    let previousTimestamp = "";
    input.timestamps.forEach((timestamp, index) => {
      if (!Number.isFinite(Date.parse(timestamp)) || timestamp <= previousTimestamp) {
        throw new QuantError(
          "INVALID_INPUT",
          "Backtest timestamps must be valid, unique, and increasing.",
          `timestamps.${index}`,
        );
      }
      previousTimestamp = timestamp;
    });
  }
  if (input.provenance && !input.provenance.label.trim()) {
    throw new QuantError("INVALID_INPUT", "Backtest provenance needs a label.");
  }
  const points: VarBacktestPoint[] = [];
  for (let testIndex = input.estimationWindow; testIndex < input.returns.length; testIndex += 1) {
    const estimation = input.returns.slice(testIndex - input.estimationWindow, testIndex);
    const risk = calculateVarCvar({
      contract: "risk-lab/var-cvar@1",
      method:
        input.method === "historical"
          ? {
              kind: "historical",
              losses: {
                kind: "positive-loss",
                values: estimation.map((value) => -value * input.portfolioValue),
              },
            }
          : {
              kind: "parametric-normal",
              meanReturn: mean(estimation),
              volatility: Math.sqrt(sampleVariance(estimation)),
            },
      confidenceLevel: input.confidenceLevel,
      holdingPeriods: 1,
      portfolioValue: input.portfolioValue,
    }).result;
    const realizedLoss = -input.returns[testIndex] * input.portfolioValue;
    points.push({
      testIndex,
      estimationStartIndex: testIndex - input.estimationWindow,
      estimationEndIndex: testIndex - 1,
      valueAtRisk: risk.valueAtRisk,
      realizedLoss,
      breached: realizedLoss > risk.valueAtRisk,
      testTimestamp: input.timestamps?.[testIndex],
    });
  }
  const breaches = points.filter((point) => point.breached).length;
  const expectedProbability = 1 - input.confidenceLevel;
  const observedProbability = breaches / points.length;
  const kupiecLikelihoodRatio = kupiecStatistic(
    points.length,
    breaches,
    expectedProbability,
    observedProbability,
  );
  return {
    contract: "risk-lab/var-backtest-result@1",
    points,
    breaches,
    expectedBreaches: points.length * expectedProbability,
    breachRate: observedProbability,
    kupiecLikelihoodRatio,
    warnings:
      points.length < 250
        ? ["Fewer than 250 test observations make coverage conclusions imprecise."]
        : [],
    dataProvenance: input.provenance,
  };
}

export type WithdrawalPolicy =
  | {
      readonly kind: "fixed-real";
      /** Annual amount in time-zero purchasing power. */
      readonly annualAmount: number;
    }
  | {
      readonly kind: "percentage";
      /** Fraction of current wealth withdrawn per year. */
      readonly annualRate: number;
    }
  | {
      readonly kind: "guardrails";
      readonly initialAnnualAmount: number;
      readonly lowerWithdrawalRate: number;
      readonly upperWithdrawalRate: number;
      readonly adjustmentRate: number;
    };

interface RetirementInputBase {
  readonly contract: "portfolio-lab/retirement-sequence@1";
  readonly initialCapital: number;
  readonly annualContribution: number;
  readonly accumulationYears: number;
  readonly retirementYears: number;
  readonly periodsPerYear: number;
  readonly annualInflationRate: number;
  readonly withdrawalPolicy: WithdrawalPolicy;
  /** Bounded path detail returned; all paths still contribute to summaries. */
  readonly samplePaths?: number;
}

export interface AggregateRetirementInput extends RetirementInputBase {
  /** Simple portfolio returns; each path needs the full requested horizon. */
  readonly returnPaths: NumericMatrix;
  readonly assetReturnPaths?: never;
  readonly targetWeights?: never;
  readonly rebalance?: never;
}

export type RetirementRebalancePolicy =
  | { readonly kind: "periodic"; readonly everyPeriods: number }
  | { readonly kind: "never" };

export interface MultiAssetRetirementInput extends RetirementInputBase {
  /** Path → period → asset simple returns. */
  readonly assetReturnPaths: readonly NumericMatrix[];
  readonly targetWeights: readonly number[];
  readonly rebalance: RetirementRebalancePolicy;
  readonly returnPaths?: never;
}

export type RetirementInput = AggregateRetirementInput | MultiAssetRetirementInput;

export interface RetirementPathResult {
  readonly wealth: readonly number[];
  readonly realSpending: readonly number[];
  readonly nominalSpending: readonly number[];
  readonly failurePeriod: number | null;
  readonly bequest: number;
  readonly endingHoldings?: readonly number[];
}

export interface RetirementResult {
  readonly contract: "portfolio-lab/retirement-sequence-result@1";
  readonly paths: readonly RetirementPathResult[];
  readonly depletionProbability: number;
  readonly medianFailureYear: number | null;
  readonly medianBequest: number;
  readonly medianRealSpending: number;
  readonly simulatedPathCount: number;
  readonly returnedPathCount: number;
  readonly eventOrder:
    | "return->cash-flow->record"
    | "return->cash-flow->rebalance->record";
  readonly accountingMode: "aggregate-return" | "multi-asset";
  readonly rebalancePolicy: RetirementRebalancePolicy | null;
}

export function runRetirementSequence(
  input: RetirementInput,
): ModelEnvelope<RetirementResult> {
  validateRetirementInput(input);
  const accumulationPeriods = input.accumulationYears * input.periodsPerYear;
  const totalPeriods =
    accumulationPeriods + input.retirementYears * input.periodsPerYear;
  const allPaths = isMultiAssetRetirementInput(input)
    ? input.assetReturnPaths.map((returns) =>
        simulateMultiAssetRetirementPath(
          input,
          returns.slice(0, totalPeriods),
          accumulationPeriods,
        ),
      )
    : input.returnPaths.map((returns) =>
        simulateRetirementPath(
          input,
          returns.slice(0, totalPeriods),
          accumulationPeriods,
        ),
      );
  const failed = allPaths.filter((path) => path.failurePeriod !== null);
  const failureYears = failed
    .map((path) => (path.failurePeriod! - accumulationPeriods) / input.periodsPerYear)
    .filter((value) => value >= 0);
  const realSpending = allPaths.flatMap((path) => path.realSpending);
  const returnedPathCount = Math.min(
    input.samplePaths ?? 64,
    allPaths.length,
  );
  const result: RetirementResult = {
    contract: "portfolio-lab/retirement-sequence-result@1",
    paths: allPaths.slice(0, returnedPathCount),
    depletionProbability: failed.length / allPaths.length,
    medianFailureYear: failureYears.length === 0 ? null : quantile(failureYears, 0.5),
    medianBequest: quantile(allPaths.map((path) => path.bequest), 0.5),
    medianRealSpending: realSpending.length === 0 ? 0 : quantile(realSpending, 0.5),
    simulatedPathCount: allPaths.length,
    returnedPathCount,
    eventOrder: isMultiAssetRetirementInput(input)
      ? "return->cash-flow->rebalance->record"
      : "return->cash-flow->record",
    accountingMode: isMultiAssetRetirementInput(input)
      ? "multi-asset"
      : "aggregate-return",
    rebalancePolicy: isMultiAssetRetirementInput(input) ? input.rebalance : null,
  };
  return envelope(input, result);
}

export interface SequenceRiskComparison {
  readonly forward: RetirementResult;
  readonly reversed: RetirementResult;
  readonly sameReturnMultiset: true;
  readonly endingWealthDifference: number;
}

export function compareReversedRetirementReturns(
  input: RetirementInput,
  pathIndex = 0,
): SequenceRiskComparison {
  const accumulationPeriods = input.accumulationYears * input.periodsPerYear;
  const totalPeriods =
    accumulationPeriods + input.retirementYears * input.periodsPerYear;
  if (isMultiAssetRetirementInput(input)) {
    assertIntegerInRange(pathIndex, 0, input.assetReturnPaths.length - 1, "pathIndex");
    const boundedReturns = input.assetReturnPaths[pathIndex].slice(0, totalPeriods);
    const reversedReturns = [
      ...boundedReturns.slice(0, accumulationPeriods),
      ...boundedReturns.slice(accumulationPeriods).reverse(),
    ];
    const forward = runRetirementSequence({
      ...input,
      assetReturnPaths: [boundedReturns],
      samplePaths: 1,
    }).result;
    const reversed = runRetirementSequence({
      ...input,
      assetReturnPaths: [reversedReturns],
      samplePaths: 1,
    }).result;
    return sequenceComparison(forward, reversed);
  }

  assertIntegerInRange(pathIndex, 0, input.returnPaths.length - 1, "pathIndex");
  const returns = input.returnPaths[pathIndex];
  const boundedReturns = returns.slice(0, totalPeriods);
  const reversedReturns = [
    ...boundedReturns.slice(0, accumulationPeriods),
    ...boundedReturns.slice(accumulationPeriods).reverse(),
  ];
  const forward = runRetirementSequence({
    ...input,
    returnPaths: [boundedReturns],
    samplePaths: 1,
  }).result;
  const reversed = runRetirementSequence({
    ...input,
    returnPaths: [reversedReturns],
    samplePaths: 1,
  }).result;
  return sequenceComparison(forward, reversed);
}

function sequenceComparison(
  forward: RetirementResult,
  reversed: RetirementResult,
): SequenceRiskComparison {
  return {
    forward,
    reversed,
    sameReturnMultiset: true,
    endingWealthDifference:
      forward.paths[0].bequest - reversed.paths[0].bequest,
  };
}

function parametricVarCvar(
  input: VarCvarInput,
  method: ParametricRiskMethod,
): ModelEnvelope<VarCvarResult> {
  const meanLoss = -method.meanReturn * input.holdingPeriods * input.portfolioValue;
  const lossVolatility =
    method.volatility * Math.sqrt(input.holdingPeriods) * input.portfolioValue;
  const z = inverseNormalCdf(input.confidenceLevel);
  const valueAtRisk = Math.max(0, meanLoss + z * lossVolatility);
  const conditionalValueAtRisk = Math.max(
    valueAtRisk,
    meanLoss +
      (lossVolatility * normalPdf(z)) / (1 - input.confidenceLevel),
  );
  return envelope(input, {
    contract: "risk-lab/var-cvar-result@1",
    method: method.kind,
    valueAtRisk,
    conditionalValueAtRisk,
    confidenceLevel: input.confidenceLevel,
    holdingPeriods: input.holdingPeriods,
    tailObservationCount: null,
    finiteSampleConvention: "analytical-normal-tail",
    lossConvention: "positive-values-are-losses",
  });
}

function scaleHistoricalLosses(input: VarCvarInput): LossSeries {
  const method = input.method as HistoricalRiskMethod;
  const holdingScale = Math.sqrt(input.holdingPeriods);
  return {
    kind: "positive-loss",
    values: method.losses.values.map((loss) => loss * holdingScale),
  };
}

function simulateMonteCarloLosses(
  input: VarCvarInput,
  method: MonteCarloRiskMethod,
): LossSeries {
  const random = createSemanticRandom(method.seed, input.contract);
  const meanReturn = method.meanReturn * input.holdingPeriods;
  const volatility = method.volatility * Math.sqrt(input.holdingPeriods);
  return {
    kind: "positive-loss",
    values: Array.from({ length: method.samples }, (_, sampleIndex) => {
      const portfolioReturn =
        meanReturn + volatility * random.normal("loss", sampleIndex);
      return -portfolioReturn * input.portfolioValue;
    }),
  };
}

function validateRiskInput(input: VarCvarInput): void {
  if (input.contract !== "risk-lab/var-cvar@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported VaR/CVaR contract.");
  }
  validateConfidence(input.confidenceLevel);
  assertIntegerInRange(input.holdingPeriods, 1, 10_000, "holdingPeriods");
  assertPositive(input.portfolioValue, "portfolioValue");
  if (input.method.kind === "historical") {
    if (input.method.losses.kind !== "positive-loss" || input.method.losses.values.length < 2) {
      throw new QuantError("INVALID_INPUT", "Historical risk needs at least two losses.");
    }
    input.method.losses.values.forEach((loss, index) =>
      assertFinite(loss, `method.losses.${index}`),
    );
    if (input.method.provenance && !input.method.provenance.label.trim()) {
      throw new QuantError("INVALID_INPUT", "Historical risk provenance needs a label.");
    }
  } else {
    assertFinite(input.method.meanReturn, "method.meanReturn");
    assertNonNegative(input.method.volatility, "method.volatility");
    if (input.method.kind === "monte-carlo-normal") {
      assertIntegerInRange(input.method.samples, 100, 1_000_000, "method.samples");
    }
  }
}

function validateConfidence(confidenceLevel: number): void {
  assertProbability(confidenceLevel, "confidenceLevel");
  if (confidenceLevel <= 0.5 || confidenceLevel >= 1) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Confidence level must be above 50% and below 100%.",
    );
  }
}

function validateWeightCovariance(
  weights: readonly number[],
  covariance: NumericMatrix,
): void {
  if (
    weights.length === 0 ||
    covariance.length !== weights.length ||
    covariance.some((row) => row.length !== weights.length)
  ) {
    throw new QuantError("DIMENSION_MISMATCH", "Weights and covariance dimensions must agree.");
  }
  weights.forEach((weight, index) => assertFinite(weight, `weights.${index}`));
  cholesky(covariance);
  const weightSum = weights.reduce((total, value) => total + value, 0);
  if (Math.abs(weightSum - 1) > 1e-8) {
    throw new QuantError("OUT_OF_RANGE", "Weights must sum to one.");
  }
}

function kupiecStatistic(
  observations: number,
  breaches: number,
  expectedProbability: number,
  observedProbability: number,
): number {
  const expectedLogLikelihood =
    (observations - breaches) * Math.log(1 - expectedProbability) +
    breaches * Math.log(expectedProbability);
  const observedLogLikelihood =
    breaches === 0 || breaches === observations
      ? 0
      : (observations - breaches) * Math.log(1 - observedProbability) +
        breaches * Math.log(observedProbability);
  return Math.max(0, -2 * (expectedLogLikelihood - observedLogLikelihood));
}

function validateRetirementInput(input: RetirementInput): void {
  if (input.contract !== "portfolio-lab/retirement-sequence@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported retirement contract.");
  }
  assertNonNegative(input.initialCapital, "initialCapital");
  assertNonNegative(input.annualContribution, "annualContribution");
  assertIntegerInRange(input.accumulationYears, 0, 100, "accumulationYears");
  assertIntegerInRange(input.retirementYears, 1, 100, "retirementYears");
  assertIntegerInRange(input.periodsPerYear, 1, 365, "periodsPerYear");
  assertFinite(input.annualInflationRate, "annualInflationRate");
  if (input.annualInflationRate <= -1) {
    throw new QuantError("OUT_OF_RANGE", "Annual inflation must exceed -100%.");
  }
  const totalPeriods =
    (input.accumulationYears + input.retirementYears) * input.periodsPerYear;
  const pathCount = isMultiAssetRetirementInput(input)
    ? input.assetReturnPaths.length
    : input.returnPaths.length;
  assertIntegerInRange(pathCount, 1, 10_000, "pathCount");
  if (input.samplePaths !== undefined) {
    assertIntegerInRange(input.samplePaths, 1, pathCount, "samplePaths");
  }
  const assetCount = isMultiAssetRetirementInput(input)
    ? input.targetWeights.length
    : 1;
  if (pathCount * totalPeriods * assetCount > 5_000_000) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Retirement simulation exceeds the five-million return-cell limit.",
    );
  }
  if (isMultiAssetRetirementInput(input)) {
    validateTargetWeights(input.targetWeights);
    if (input.assetReturnPaths.length === 0) {
      throw new QuantError("INVALID_INPUT", "At least one asset-return path is required.");
    }
    input.assetReturnPaths.forEach((path, pathIndex) => {
      if (path.length < totalPeriods) {
        throw new QuantError(
          "DIMENSION_MISMATCH",
          "Every asset-return path must cover the complete horizon.",
          `assetReturnPaths.${pathIndex}`,
        );
      }
      path.forEach((row, periodIndex) => {
        if (row.length !== input.targetWeights.length) {
          throw new QuantError(
            "DIMENSION_MISMATCH",
            "Every asset-return row must match the target allocation.",
            `assetReturnPaths.${pathIndex}.${periodIndex}`,
          );
        }
        row.forEach((value, assetIndex) =>
          validateSimpleReturn(
            value,
            `assetReturnPaths.${pathIndex}.${periodIndex}.${assetIndex}`,
          ),
        );
      });
    });
    if (input.rebalance.kind === "periodic") {
      assertIntegerInRange(
        input.rebalance.everyPeriods,
        1,
        totalPeriods,
        "rebalance.everyPeriods",
      );
    }
  } else {
    if (input.returnPaths.length === 0) {
      throw new QuantError("INVALID_INPUT", "At least one return path is required.");
    }
    input.returnPaths.forEach((path, pathIndex) => {
      if (path.length < totalPeriods) {
        throw new QuantError(
          "DIMENSION_MISMATCH",
          "Every return path must cover the complete horizon.",
          `returnPaths.${pathIndex}`,
        );
      }
      path.forEach((value, periodIndex) =>
        validateSimpleReturn(value, `returnPaths.${pathIndex}.${periodIndex}`),
      );
    });
  }
  validateWithdrawalPolicy(input.withdrawalPolicy);
}

function validateTargetWeights(weights: readonly number[]): void {
  if (weights.length === 0) {
    throw new QuantError("INVALID_INPUT", "Target weights cannot be empty.");
  }
  weights.forEach((weight, index) => {
    assertNonNegative(weight, `targetWeights.${index}`);
  });
  if (Math.abs(weights.reduce((total, weight) => total + weight, 0) - 1) > 1e-8) {
    throw new QuantError("OUT_OF_RANGE", "Target weights must sum to one.");
  }
}

function validateSimpleReturn(value: number, path: string): void {
  assertFinite(value, path);
  if (value < -1) {
    throw new QuantError("OUT_OF_RANGE", "A simple return cannot be below -100%.", path);
  }
}

function validateWithdrawalPolicy(policy: WithdrawalPolicy): void {
  if (policy.kind === "fixed-real") {
    assertNonNegative(policy.annualAmount, "withdrawalPolicy.annualAmount");
  } else if (policy.kind === "percentage") {
    assertProbability(policy.annualRate, "withdrawalPolicy.annualRate");
  } else {
    assertNonNegative(policy.initialAnnualAmount, "withdrawalPolicy.initialAnnualAmount");
    assertProbability(policy.lowerWithdrawalRate, "withdrawalPolicy.lowerWithdrawalRate");
    assertProbability(policy.upperWithdrawalRate, "withdrawalPolicy.upperWithdrawalRate");
    assertProbability(policy.adjustmentRate, "withdrawalPolicy.adjustmentRate");
    if (policy.lowerWithdrawalRate >= policy.upperWithdrawalRate) {
      throw new QuantError("OUT_OF_RANGE", "Guardrail lower rate must be below the upper rate.");
    }
  }
}

function simulateRetirementPath(
  input: AggregateRetirementInput,
  returns: readonly number[],
  accumulationPeriods: number,
): RetirementPathResult {
  let wealth = input.initialCapital;
  let previousAnnualWithdrawal = initialAnnualWithdrawal(input.withdrawalPolicy);
  let failurePeriod: number | null = null;
  const wealthPath = [wealth];
  const realSpending: number[] = [];
  const nominalSpending: number[] = [];
  const periodicContribution = input.annualContribution / input.periodsPerYear;

  for (let period = 0; period < returns.length; period += 1) {
    wealth *= 1 + returns[period];
    if (period < accumulationPeriods) {
      wealth += periodicContribution;
    } else {
      const yearsElapsed = period / input.periodsPerYear;
      const inflationFactor = (1 + input.annualInflationRate) ** yearsElapsed;
      const periodicInflationFactor =
        (1 + input.annualInflationRate) ** (1 / input.periodsPerYear);
      const annualWithdrawal = chooseAnnualWithdrawal(
        input.withdrawalPolicy,
        wealth,
        previousAnnualWithdrawal,
        inflationFactor,
        periodicInflationFactor,
        period === accumulationPeriods,
      );
      previousAnnualWithdrawal = annualWithdrawal;
      const requested = annualWithdrawal / input.periodsPerYear;
      const spending = Math.min(wealth, requested);
      wealth = Math.max(0, wealth - spending);
      nominalSpending.push(spending);
      realSpending.push(spending / inflationFactor);
      if (wealth === 0 && failurePeriod === null) failurePeriod = period + 1;
    }
    wealthPath.push(wealth);
  }
  return {
    wealth: wealthPath,
    realSpending,
    nominalSpending,
    failurePeriod,
    bequest: wealth,
  };
}

function simulateMultiAssetRetirementPath(
  input: MultiAssetRetirementInput,
  returns: NumericMatrix,
  accumulationPeriods: number,
): RetirementPathResult {
  let holdings = input.targetWeights.map(
    (weight) => input.initialCapital * weight,
  );
  let wealth = input.initialCapital;
  let previousAnnualWithdrawal = initialAnnualWithdrawal(input.withdrawalPolicy);
  let failurePeriod: number | null = null;
  const wealthPath = [wealth];
  const realSpending: number[] = [];
  const nominalSpending: number[] = [];
  const periodicContribution = input.annualContribution / input.periodsPerYear;

  for (let period = 0; period < returns.length; period += 1) {
    holdings = holdings.map(
      (holding, assetIndex) => holding * (1 + returns[period][assetIndex]),
    );
    wealth = holdings.reduce((total, holding) => total + holding, 0);

    if (period < accumulationPeriods) {
      holdings = holdings.map(
        (holding, assetIndex) =>
          holding + periodicContribution * input.targetWeights[assetIndex],
      );
      wealth += periodicContribution;
    } else {
      const yearsElapsed = period / input.periodsPerYear;
      const inflationFactor = (1 + input.annualInflationRate) ** yearsElapsed;
      const periodicInflationFactor =
        (1 + input.annualInflationRate) ** (1 / input.periodsPerYear);
      const annualWithdrawal = chooseAnnualWithdrawal(
        input.withdrawalPolicy,
        wealth,
        previousAnnualWithdrawal,
        inflationFactor,
        periodicInflationFactor,
        period === accumulationPeriods,
      );
      previousAnnualWithdrawal = annualWithdrawal;
      const spending = Math.min(wealth, annualWithdrawal / input.periodsPerYear);
      const remainingWealth = Math.max(0, wealth - spending);
      const remainingRatio = wealth === 0 ? 0 : remainingWealth / wealth;
      holdings = holdings.map((holding) => holding * remainingRatio);
      wealth = remainingWealth;
      nominalSpending.push(spending);
      realSpending.push(spending / inflationFactor);
      if (wealth === 0 && failurePeriod === null) failurePeriod = period + 1;
    }

    if (
      input.rebalance.kind === "periodic" &&
      (period + 1) % input.rebalance.everyPeriods === 0
    ) {
      holdings = input.targetWeights.map((weight) => wealth * weight);
    }
    wealthPath.push(wealth);
  }

  return {
    wealth: wealthPath,
    realSpending,
    nominalSpending,
    failurePeriod,
    bequest: wealth,
    endingHoldings: holdings,
  };
}

function isMultiAssetRetirementInput(
  input: RetirementInput,
): input is MultiAssetRetirementInput {
  return "assetReturnPaths" in input && Array.isArray(input.assetReturnPaths);
}

function initialAnnualWithdrawal(policy: WithdrawalPolicy): number {
  if (policy.kind === "fixed-real") return policy.annualAmount;
  if (policy.kind === "guardrails") return policy.initialAnnualAmount;
  return 0;
}

function chooseAnnualWithdrawal(
  policy: WithdrawalPolicy,
  wealth: number,
  previousAnnualWithdrawal: number,
  inflationFactor: number,
  periodicInflationFactor: number,
  firstWithdrawalPeriod: boolean,
): number {
  if (policy.kind === "fixed-real") return policy.annualAmount * inflationFactor;
  if (policy.kind === "percentage") return wealth * policy.annualRate;
  let withdrawal = firstWithdrawalPeriod
    ? policy.initialAnnualAmount * inflationFactor
    : previousAnnualWithdrawal * periodicInflationFactor;
  const rate = wealth === 0 ? Number.POSITIVE_INFINITY : withdrawal / wealth;
  if (rate > policy.upperWithdrawalRate) {
    withdrawal *= 1 - policy.adjustmentRate;
  } else if (rate < policy.lowerWithdrawalRate) {
    withdrawal *= 1 + policy.adjustmentRate;
  }
  return clamp(withdrawal, 0, wealth);
}

function envelope<Input extends { readonly contract: string }, Result>(
  input: Input,
  result: Result,
): ModelEnvelope<Result> {
  return {
    result,
    warnings: [],
    provenance: {
      engineVersion: `${RISK_LAB_VERSION}+${QUANT_CORE_VERSION}`,
      inputContract: input.contract,
      resultContract:
        typeof result === "object" && result !== null && "contract" in result
          ? String(result.contract)
          : `${input.contract}/result`,
    },
  };
}
