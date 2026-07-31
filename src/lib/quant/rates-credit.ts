/**
 * Rates and credit models for the educational quantitative laboratory.
 *
 * Conventions are intentionally carried in field names and results: rates are
 * annual decimals, time is measured in years, and discounting is continuous.
 * Short-rate bond prices use risk-neutral parameters. Hazard and Merton default
 * probabilities are kept separate because they answer different questions.
 */

import {
  QuantError,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  assertProbability,
  clamp,
  createSemanticRandom,
  normalCdf,
  solveLinearSystem,
  type ModelEnvelope,
  type ModelWarning,
  type SemanticRandom,
} from "./core";
import {
  evaluateBlackScholes,
  type BlackScholesResult,
} from "./derivatives";

export const RATES_CREDIT_ENGINE_VERSION = "rates-credit@1";

export const VASICEK_REQUEST_CONTRACT = "rates-credit/vasicek-request@1";
export const VASICEK_RESULT_CONTRACT = "rates-credit/vasicek-result@1";
export const CIR_REQUEST_CONTRACT = "rates-credit/cir-request@1";
export const CIR_RESULT_CONTRACT = "rates-credit/cir-result@1";
export const SHORT_RATE_COMPARISON_REQUEST_CONTRACT =
  "rates-credit/short-rate-comparison-request@1";
export const SHORT_RATE_COMPARISON_RESULT_CONTRACT =
  "rates-credit/short-rate-comparison-result@1";
export const NELSON_SIEGEL_FIT_REQUEST_CONTRACT =
  "rates-credit/nelson-siegel-fit-request@1";
export const NELSON_SIEGEL_FIT_RESULT_CONTRACT =
  "rates-credit/nelson-siegel-fit-result@1";
export const HAZARD_CREDIT_REQUEST_CONTRACT =
  "rates-credit/hazard-credit-request@1";
export const HAZARD_CREDIT_RESULT_CONTRACT =
  "rates-credit/hazard-credit-result@1";
export const MERTON_CREDIT_REQUEST_CONTRACT =
  "rates-credit/merton-credit-request@1";
export const MERTON_CREDIT_RESULT_CONTRACT =
  "rates-credit/merton-credit-result@1";

const MAX_PATH_COUNT = 20_000;
const MAX_STEP_COUNT = 10_000;
const MAX_SIMULATED_POINTS = 2_000_000;
const MAX_CURVE_POINTS = 10_000;
const MAX_BOND_PERIODS = 2_000;
const MAX_MATURITY_YEARS = 100;
const MAX_ABSOLUTE_ANNUAL_RATE = 5;
const MAX_ANNUAL_VOLATILITY = 5;
const MAX_MEAN_REVERSION_SPEED = 100;
const MAX_MONETARY_AMOUNT = 1_000_000_000_000;

export interface ShortRateConventions {
  readonly rateUnit: "annual-decimal";
  readonly volatilityUnit: "annual-decimal";
  readonly timeUnit: "years";
  readonly discounting: "continuous";
  readonly pricingMeasure: "risk-neutral";
  readonly timeIndexZero: "initial-short-rate";
}

const SHORT_RATE_CONVENTIONS: ShortRateConventions = {
  rateUnit: "annual-decimal",
  volatilityUnit: "annual-decimal",
  timeUnit: "years",
  discounting: "continuous",
  pricingMeasure: "risk-neutral",
  timeIndexZero: "initial-short-rate",
};

export interface ShortRateExecution {
  readonly seed: number;
  readonly pathCount: number;
  readonly stepCount: number;
  readonly stepYears: number;
}

export interface ConditionalMoments {
  readonly mean: number;
  readonly variance: number;
  readonly standardDeviation: number;
}

export interface ShortRateFanPoint {
  readonly timeYears: number;
  readonly p05AnnualRate: number;
  readonly medianAnnualRate: number;
  readonly p95AnnualRate: number;
}

export interface ZeroCouponBondAnalytics {
  readonly maturityYears: number;
  readonly pricePerUnitFace: number;
  readonly continuouslyCompoundedZeroYield: number | null;
  /** -1/P times the derivative of price with respect to today's short rate. */
  readonly shortRateDurationYears: number;
  /** 1/P times the second derivative with respect to today's short rate. */
  readonly shortRateConvexityYearsSquared: number;
}

// ---------------------------------------------------------------------------
// Vasicek

export interface VasicekParameters {
  readonly initialAnnualShortRate: number;
  readonly longRunAnnualMeanRate: number;
  readonly meanReversionSpeedPerYear: number;
  readonly annualVolatility: number;
}

export interface VasicekRequest {
  readonly contract: typeof VASICEK_REQUEST_CONTRACT;
  readonly parameters: VasicekParameters;
  readonly execution: ShortRateExecution;
  readonly bondMaturitiesYears: readonly number[];
}

export interface VasicekResult {
  readonly contract: typeof VASICEK_RESULT_CONTRACT;
  readonly conventions: ShortRateConventions;
  readonly simulationMethod: "exact-gaussian-transition";
  readonly parameters: VasicekParameters;
  readonly execution: ShortRateExecution;
  readonly timesYears: readonly number[];
  readonly ratePaths: readonly (readonly number[])[];
  readonly rateFan: readonly ShortRateFanPoint[];
  readonly negativeRateObservationFraction: number;
  readonly zeroCouponBonds: readonly ZeroCouponBondAnalytics[];
  readonly modelNotes: readonly string[];
}

export function vasicekConditionalMoments(
  currentAnnualShortRate: number,
  horizonYears: number,
  parameters: VasicekParameters,
): ConditionalMoments {
  validateVasicekParameters(parameters);
  assertAnnualRate(currentAnnualShortRate, "currentAnnualShortRate");
  assertHorizon(horizonYears, "horizonYears", true);
  return vasicekConditionalMomentsUnchecked(
    currentAnnualShortRate,
    horizonYears,
    parameters,
  );
}

export function vasicekZeroCouponBondAnalytics(
  parameters: VasicekParameters,
  maturityYears: number,
  currentAnnualShortRate = parameters.initialAnnualShortRate,
): ZeroCouponBondAnalytics {
  validateVasicekParameters(parameters);
  assertAnnualRate(currentAnnualShortRate, "currentAnnualShortRate");
  assertHorizon(maturityYears, "maturityYears", true);
  if (maturityYears === 0) return unitMaturityBondAnalytics();

  const speed = parameters.meanReversionSpeedPerYear;
  const loading = -Math.expm1(-speed * maturityYears) / speed;
  const varianceAdjustment =
    parameters.annualVolatility ** 2 / (2 * speed ** 2);
  const logLevel =
    (parameters.longRunAnnualMeanRate - varianceAdjustment) *
      (loading - maturityYears) -
    (parameters.annualVolatility ** 2 * loading ** 2) / (4 * speed);
  const logPrice = logLevel - loading * currentAnnualShortRate;

  return bondAnalyticsFromLogPrice(maturityYears, logPrice, loading);
}

export function runVasicekModel(
  request: VasicekRequest,
): ModelEnvelope<VasicekResult> {
  validateContract(request.contract, VASICEK_REQUEST_CONTRACT);
  validateVasicekParameters(request.parameters);
  validateShortRateExecution(request.execution);
  validateMaturityList(request.bondMaturitiesYears, "bondMaturitiesYears");

  const random = createSemanticRandom(
    request.execution.seed,
    "rates-credit/vasicek@1",
  );
  const ratePaths = simulateVasicekPaths(
    request.parameters,
    request.execution,
    random,
  );
  const timesYears = buildTimes(request.execution);
  const negativeRateObservationFraction = negativeObservationFraction(ratePaths);
  const warnings: ModelWarning[] = [];
  if (negativeRateObservationFraction > 0) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "Vasicek is Gaussian, so negative short rates are possible and occurred in this run.",
    });
  }

  return envelope(
    request.contract,
    VASICEK_RESULT_CONTRACT,
    request.execution.seed,
    warnings,
    {
      contract: VASICEK_RESULT_CONTRACT,
      conventions: SHORT_RATE_CONVENTIONS,
      simulationMethod: "exact-gaussian-transition",
      parameters: { ...request.parameters },
      execution: { ...request.execution },
      timesYears,
      ratePaths,
      rateFan: buildRateFan(ratePaths, timesYears),
      negativeRateObservationFraction,
      zeroCouponBonds: request.bondMaturitiesYears.map((maturity) =>
        vasicekZeroCouponBondAnalytics(request.parameters, maturity),
      ),
      modelNotes: [
        "Each step samples the exact Gaussian conditional distribution; it is not an Euler approximation.",
        "Bond prices treat the supplied Vasicek parameters as risk-neutral parameters.",
        "Duration and convexity measure sensitivity to today's short rate, not a parallel yield-curve shift.",
      ],
    },
  );
}

function simulateVasicekPaths(
  parameters: VasicekParameters,
  execution: ShortRateExecution,
  random: SemanticRandom,
): number[][] {
  return Array.from({ length: execution.pathCount }, (_, pathIndex) => {
    const path = [parameters.initialAnnualShortRate];
    for (let stepIndex = 0; stepIndex < execution.stepCount; stepIndex += 1) {
      const moments = vasicekConditionalMomentsUnchecked(
        path[stepIndex],
        execution.stepYears,
        parameters,
      );
      const nextRate =
        moments.mean +
        moments.standardDeviation *
          random.normal("path", pathIndex, "step", stepIndex, "transition");
      assertFiniteResult(nextRate, "Vasicek transition");
      path.push(nextRate);
    }
    return path;
  });
}

function vasicekConditionalMomentsUnchecked(
  currentAnnualShortRate: number,
  horizonYears: number,
  parameters: VasicekParameters,
): ConditionalMoments {
  const decay = Math.exp(-parameters.meanReversionSpeedPerYear * horizonYears);
  const mean =
    parameters.longRunAnnualMeanRate +
    (currentAnnualShortRate - parameters.longRunAnnualMeanRate) * decay;
  const variance =
    (parameters.annualVolatility ** 2 * (1 - decay ** 2)) /
    (2 * parameters.meanReversionSpeedPerYear);
  return {
    mean,
    variance: Math.max(0, variance),
    standardDeviation: Math.sqrt(Math.max(0, variance)),
  };
}

// ---------------------------------------------------------------------------
// Cox-Ingersoll-Ross

export interface CirParameters {
  readonly initialAnnualShortRate: number;
  readonly longRunAnnualMeanRate: number;
  readonly meanReversionSpeedPerYear: number;
  readonly annualVolatility: number;
}

export interface CirRequest {
  readonly contract: typeof CIR_REQUEST_CONTRACT;
  readonly parameters: CirParameters;
  readonly execution: ShortRateExecution;
  readonly bondMaturitiesYears: readonly number[];
}

export interface CirResult {
  readonly contract: typeof CIR_RESULT_CONTRACT;
  readonly conventions: ShortRateConventions;
  readonly simulationMethod: "noncentral-chi-square-transition";
  readonly parameters: CirParameters;
  readonly execution: ShortRateExecution;
  readonly timesYears: readonly number[];
  readonly ratePaths: readonly (readonly number[])[];
  readonly rateFan: readonly ShortRateFanPoint[];
  readonly fellerConditionSatisfied: boolean;
  readonly fellerLeftSide: number;
  readonly fellerRightSide: number;
  readonly zeroCouponBonds: readonly ZeroCouponBondAnalytics[];
  readonly modelNotes: readonly string[];
}

export interface ShortRateModelComparisonRequest {
  readonly contract: typeof SHORT_RATE_COMPARISON_REQUEST_CONTRACT;
  readonly vasicekParameters: VasicekParameters;
  readonly cirParameters: CirParameters;
  readonly execution: ShortRateExecution;
  readonly bondMaturitiesYears: readonly number[];
}

export interface ShortRateFanComparisonPoint {
  readonly timeYears: number;
  readonly vasicek: ShortRateFanPoint;
  readonly cir: ShortRateFanPoint;
  readonly cirMinusVasicekMedianAnnualRate: number;
}

export interface ShortRateBondComparisonPoint {
  readonly maturityYears: number;
  readonly vasicek: ZeroCouponBondAnalytics;
  readonly cir: ZeroCouponBondAnalytics;
  readonly cirMinusVasicekPricePerUnitFace: number;
  readonly cirMinusVasicekZeroYield: number | null;
}

export interface ShortRateModelComparisonResult {
  readonly contract: typeof SHORT_RATE_COMPARISON_RESULT_CONTRACT;
  readonly conventions: ShortRateConventions;
  readonly execution: ShortRateExecution;
  readonly vasicekParameters: VasicekParameters;
  readonly cirParameters: CirParameters;
  readonly rateFanComparison: readonly ShortRateFanComparisonPoint[];
  readonly bondComparison: readonly ShortRateBondComparisonPoint[];
  readonly diagnostics: {
    readonly vasicekNegativeRateObservationFraction: number;
    readonly cirMinimumSimulatedAnnualRate: number;
    readonly cirFellerConditionSatisfied: boolean;
  };
  readonly modelNotes: readonly string[];
}

export function cirConditionalMoments(
  currentAnnualShortRate: number,
  horizonYears: number,
  parameters: CirParameters,
): ConditionalMoments {
  validateCirParameters(parameters);
  assertNonNegative(currentAnnualShortRate, "currentAnnualShortRate");
  assertHorizon(horizonYears, "horizonYears", true);
  return cirConditionalMomentsUnchecked(
    currentAnnualShortRate,
    horizonYears,
    parameters,
  );
}

export function cirZeroCouponBondAnalytics(
  parameters: CirParameters,
  maturityYears: number,
  currentAnnualShortRate = parameters.initialAnnualShortRate,
): ZeroCouponBondAnalytics {
  validateCirParameters(parameters);
  assertNonNegative(currentAnnualShortRate, "currentAnnualShortRate");
  assertHorizon(maturityYears, "maturityYears", true);
  if (maturityYears === 0) return unitMaturityBondAnalytics();

  const speed = parameters.meanReversionSpeedPerYear;
  if (parameters.annualVolatility === 0) {
    const loading = -Math.expm1(-speed * maturityYears) / speed;
    const logPrice =
      -parameters.longRunAnnualMeanRate * maturityYears -
      (currentAnnualShortRate - parameters.longRunAnnualMeanRate) * loading;
    return bondAnalyticsFromLogPrice(maturityYears, logPrice, loading);
  }

  const variance = parameters.annualVolatility ** 2;
  const gamma = Math.sqrt(speed ** 2 + 2 * variance);
  const negativeGammaTime = Math.exp(-gamma * maturityYears);
  const scaledDenominator =
    (gamma + speed) * (1 - negativeGammaTime) +
    2 * gamma * negativeGammaTime;
  const loading =
    (2 * (1 - negativeGammaTime)) / scaledDenominator;
  const power = (2 * speed * parameters.longRunAnnualMeanRate) / variance;
  const logLevel =
    power *
    (Math.log(2 * gamma) +
      ((speed - gamma) * maturityYears) / 2 -
      Math.log(scaledDenominator));
  const logPrice = logLevel - loading * currentAnnualShortRate;

  return bondAnalyticsFromLogPrice(maturityYears, logPrice, loading);
}

export function runCirModel(request: CirRequest): ModelEnvelope<CirResult> {
  validateContract(request.contract, CIR_REQUEST_CONTRACT);
  validateCirParameters(request.parameters);
  validateShortRateExecution(request.execution);
  validateMaturityList(request.bondMaturitiesYears, "bondMaturitiesYears");

  const random = createSemanticRandom(
    request.execution.seed,
    "rates-credit/cir@1",
  );
  const ratePaths = simulateCirPaths(
    request.parameters,
    request.execution,
    random,
  );
  const timesYears = buildTimes(request.execution);
  const fellerLeftSide =
    2 *
    request.parameters.meanReversionSpeedPerYear *
    request.parameters.longRunAnnualMeanRate;
  const fellerRightSide = request.parameters.annualVolatility ** 2;
  const fellerConditionSatisfied = fellerLeftSide >= fellerRightSide;
  const warnings: ModelWarning[] = [];
  if (!fellerConditionSatisfied) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "The CIR Feller condition 2κθ ≥ σ² is violated. Rates remain nonnegative under this sampler, but zero is attainable.",
    });
  }

  return envelope(
    request.contract,
    CIR_RESULT_CONTRACT,
    request.execution.seed,
    warnings,
    {
      contract: CIR_RESULT_CONTRACT,
      conventions: SHORT_RATE_CONVENTIONS,
      simulationMethod: "noncentral-chi-square-transition",
      parameters: { ...request.parameters },
      execution: { ...request.execution },
      timesYears,
      ratePaths,
      rateFan: buildRateFan(ratePaths, timesYears),
      fellerConditionSatisfied,
      fellerLeftSide,
      fellerRightSide,
      zeroCouponBonds: request.bondMaturitiesYears.map((maturity) =>
        cirZeroCouponBondAnalytics(request.parameters, maturity),
      ),
      modelNotes: [
        "The transition is sampled from CIR's noncentral chi-square law, which preserves nonnegativity without clipping an Euler step.",
        "The Feller condition determines whether zero is unattainable; violating it does not make the CIR model undefined.",
        "Bond prices treat the supplied CIR parameters as risk-neutral parameters.",
      ],
    },
  );
}

/** Place Vasicek and CIR summaries on identical horizons and bond maturities. */
export function compareVasicekAndCir(
  request: ShortRateModelComparisonRequest,
): ModelEnvelope<ShortRateModelComparisonResult> {
  validateContract(request.contract, SHORT_RATE_COMPARISON_REQUEST_CONTRACT);
  const vasicek = runVasicekModel({
    contract: VASICEK_REQUEST_CONTRACT,
    parameters: request.vasicekParameters,
    execution: request.execution,
    bondMaturitiesYears: request.bondMaturitiesYears,
  });
  const cir = runCirModel({
    contract: CIR_REQUEST_CONTRACT,
    parameters: request.cirParameters,
    execution: request.execution,
    bondMaturitiesYears: request.bondMaturitiesYears,
  });

  return envelope(
    request.contract,
    SHORT_RATE_COMPARISON_RESULT_CONTRACT,
    request.execution.seed,
    mergeWarnings(vasicek.warnings, cir.warnings),
    {
      contract: SHORT_RATE_COMPARISON_RESULT_CONTRACT,
      conventions: SHORT_RATE_CONVENTIONS,
      execution: { ...request.execution },
      vasicekParameters: { ...request.vasicekParameters },
      cirParameters: { ...request.cirParameters },
      rateFanComparison: vasicek.result.rateFan.map((point, index) => ({
        timeYears: point.timeYears,
        vasicek: point,
        cir: cir.result.rateFan[index],
        cirMinusVasicekMedianAnnualRate:
          cir.result.rateFan[index].medianAnnualRate - point.medianAnnualRate,
      })),
      bondComparison: vasicek.result.zeroCouponBonds.map((bond, index) => {
        const cirBond = cir.result.zeroCouponBonds[index];
        const vasicekYield = bond.continuouslyCompoundedZeroYield;
        const cirYield = cirBond.continuouslyCompoundedZeroYield;
        return {
          maturityYears: bond.maturityYears,
          vasicek: bond,
          cir: cirBond,
          cirMinusVasicekPricePerUnitFace:
            cirBond.pricePerUnitFace - bond.pricePerUnitFace,
          cirMinusVasicekZeroYield:
            vasicekYield === null || cirYield === null
              ? null
              : cirYield - vasicekYield,
        };
      }),
      diagnostics: {
        vasicekNegativeRateObservationFraction:
          vasicek.result.negativeRateObservationFraction,
        cirMinimumSimulatedAnnualRate: minimumPathObservation(
          cir.result.ratePaths,
        ),
        cirFellerConditionSatisfied: cir.result.fellerConditionSatisfied,
      },
      modelNotes: [
        "Both models use the same seed, time grid, path count, and requested bond maturities.",
        "Their semantic random streams are model-specific, so fan differences compare distributions rather than paired paths.",
        "Vasicek is Gaussian and can cross zero; CIR is nonnegative and has state-dependent volatility.",
      ],
    },
  );
}

function minimumPathObservation(
  paths: readonly (readonly number[])[],
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    for (const observation of path) minimum = Math.min(minimum, observation);
  }
  return minimum;
}

function simulateCirPaths(
  parameters: CirParameters,
  execution: ShortRateExecution,
  random: SemanticRandom,
): number[][] {
  return Array.from({ length: execution.pathCount }, (_, pathIndex) => {
    const path = [parameters.initialAnnualShortRate];
    for (let stepIndex = 0; stepIndex < execution.stepCount; stepIndex += 1) {
      path.push(
        sampleCirTransition(
          path[stepIndex],
          execution.stepYears,
          parameters,
          random,
          ["path", pathIndex, "step", stepIndex, "transition"],
        ),
      );
    }
    return path;
  });
}

function sampleCirTransition(
  currentRate: number,
  stepYears: number,
  parameters: CirParameters,
  random: SemanticRandom,
  address: readonly (string | number)[],
): number {
  const speed = parameters.meanReversionSpeedPerYear;
  const decay = Math.exp(-speed * stepYears);
  if (parameters.annualVolatility === 0) {
    return (
      parameters.longRunAnnualMeanRate +
      (currentRate - parameters.longRunAnnualMeanRate) * decay
    );
  }

  const variance = parameters.annualVolatility ** 2;
  const oneMinusDecay = 1 - decay;
  const scale = (variance * oneMinusDecay) / (4 * speed);
  const degreesOfFreedom =
    (4 * speed * parameters.longRunAnnualMeanRate) / variance;
  const noncentrality =
    (4 * speed * decay * currentRate) / (variance * oneMinusDecay);
  const chiSquare = sampleNoncentralChiSquare(
    degreesOfFreedom,
    noncentrality,
    random,
    address,
  );
  const nextRate = scale * chiSquare;
  assertFiniteResult(nextRate, "CIR transition");
  return Math.max(0, nextRate);
}

function sampleNoncentralChiSquare(
  degreesOfFreedom: number,
  noncentrality: number,
  random: SemanticRandom,
  address: readonly (string | number)[],
): number {
  if (degreesOfFreedom > 1) {
    const shiftedNormal =
      random.normal(...address, "noncentral-normal") + Math.sqrt(noncentrality);
    const centralRemainder = random.gamma(
      (degreesOfFreedom - 1) / 2,
      2,
      ...address,
      "central-remainder",
    );
    return shiftedNormal ** 2 + centralRemainder;
  }

  const poissonCount = sampleExactPoisson(
    noncentrality / 2,
    random,
    address,
  );
  const gammaShape = degreesOfFreedom / 2 + poissonCount;
  return gammaShape === 0
    ? 0
    : random.gamma(gammaShape, 2, ...address, "poisson-gamma");
}

function sampleExactPoisson(
  intensity: number,
  random: SemanticRandom,
  address: readonly (string | number)[],
): number {
  if (intensity === 0) return 0;
  if (intensity < 30) {
    const threshold = Math.exp(-intensity);
    let product = 1;
    for (let count = 0; count < 10_000; count += 1) {
      product *= random.uniform(...address, "poisson-small", count);
      if (product <= threshold) return count;
    }
  } else {
    const squareRoot = Math.sqrt(intensity);
    const b = 0.931 + 2.53 * squareRoot;
    const a = -0.059 + 0.02483 * b;
    const inverseAlpha = 1.1239 + 1.1328 / (b - 3.4);
    const squeeze = 0.9277 - 3.6224 / (b - 2);
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const centeredUniform =
        random.uniform(...address, "poisson-large-u", attempt) - 0.5;
      const secondUniform = random.uniform(
        ...address,
        "poisson-large-v",
        attempt,
      );
      const distance = 0.5 - Math.abs(centeredUniform);
      const candidate = Math.floor(
        ((2 * a) / distance + b) * centeredUniform + intensity + 0.43,
      );
      if (
        candidate >= 0 &&
        distance >= 0.07 &&
        secondUniform <= squeeze
      ) {
        return candidate;
      }
      if (candidate < 0 || (distance < 0.013 && secondUniform > distance)) {
        continue;
      }
      const logAcceptance = Math.log(
        (secondUniform * inverseAlpha) / (a / distance ** 2 + b),
      );
      const logProbability =
        -intensity +
        candidate * Math.log(intensity) -
        logGamma(candidate + 1);
      if (logAcceptance <= logProbability) return candidate;
    }
  }
  throw new QuantError(
    "NUMERICAL_FAILURE",
    "The exact Poisson sampler did not converge.",
  );
}

function cirConditionalMomentsUnchecked(
  currentAnnualShortRate: number,
  horizonYears: number,
  parameters: CirParameters,
): ConditionalMoments {
  const speed = parameters.meanReversionSpeedPerYear;
  const decay = Math.exp(-speed * horizonYears);
  const oneMinusDecay = 1 - decay;
  const mean =
    parameters.longRunAnnualMeanRate +
    (currentAnnualShortRate - parameters.longRunAnnualMeanRate) * decay;
  const variance =
    (currentAnnualShortRate * parameters.annualVolatility ** 2 * decay * oneMinusDecay) /
      speed +
    (parameters.longRunAnnualMeanRate *
      parameters.annualVolatility ** 2 *
      oneMinusDecay ** 2) /
      (2 * speed);
  return {
    mean,
    variance: Math.max(0, variance),
    standardDeviation: Math.sqrt(Math.max(0, variance)),
  };
}

// ---------------------------------------------------------------------------
// Nelson-Siegel

export interface NelsonSiegelParameters {
  readonly levelAnnualYield: number;
  readonly slopeAnnualYield: number;
  readonly curvatureAnnualYield: number;
  readonly decayYears: number;
}

export interface NelsonSiegelCurvePoint {
  readonly maturityYears: number;
  readonly annualContinuouslyCompoundedYield: number;
}

export interface NelsonSiegelFitRequest {
  readonly contract: typeof NELSON_SIEGEL_FIT_REQUEST_CONTRACT;
  readonly maturitiesYears: readonly number[];
  readonly observedAnnualYields: readonly number[];
  /** Omit to fit decay on a bounded log-scale search from 0.05 to 30 years. */
  readonly fixedDecayYears?: number;
}

export interface NelsonSiegelFitResult {
  readonly contract: typeof NELSON_SIEGEL_FIT_RESULT_CONTRACT;
  readonly yieldConvention: "annual-decimal-continuously-compounded";
  readonly maturityUnit: "years";
  readonly parameters: NelsonSiegelParameters;
  readonly observedCurve: readonly NelsonSiegelCurvePoint[];
  readonly fittedCurve: readonly NelsonSiegelCurvePoint[];
  readonly residualAnnualYields: readonly number[];
  readonly rmseAnnualYield: number;
  readonly fittingMethod:
    | "linear-least-squares-fixed-decay"
    | "bounded-decay-search-with-linear-least-squares";
  readonly decaySearchBoundsYears: readonly [number, number] | null;
  readonly converged: boolean;
  readonly modelNotes: readonly string[];
}

export type NelsonSiegelShockName =
  | "parallel-up"
  | "parallel-down"
  | "steepening"
  | "flattening"
  | "more-curvature"
  | "less-curvature";

export interface NelsonSiegelShock {
  readonly name: NelsonSiegelShockName;
  readonly annualYieldMagnitude: number;
}

export type NelsonSiegelNamedCurveShock =
  | "parallel"
  | "steepen"
  | "flatten"
  | "curvature";

export interface NelsonSiegelShockCurvePoint {
  readonly maturityYears: number;
  readonly baseAnnualYield: number;
  readonly shockedAnnualYield: number;
  readonly annualYieldChange: number;
}

export interface NelsonSiegelNamedShockCurve {
  readonly name: NelsonSiegelNamedCurveShock;
  readonly parameterShock: NelsonSiegelShock;
  readonly shockedParameters: NelsonSiegelParameters;
  readonly curve: readonly NelsonSiegelShockCurvePoint[];
}

interface NelsonSiegelCandidate {
  readonly parameters: NelsonSiegelParameters;
  readonly fitted: readonly number[];
  readonly residuals: readonly number[];
  readonly sumSquaredError: number;
}

const NELSON_SIEGEL_DECAY_BOUNDS: readonly [number, number] = [0.05, 30];

export function evaluateNelsonSiegelYield(
  parameters: NelsonSiegelParameters,
  maturityYears: number,
): number {
  validateNelsonSiegelParameters(parameters);
  assertHorizon(maturityYears, "maturityYears", true);
  const [levelLoading, slopeLoading, curvatureLoading] =
    nelsonSiegelLoadings(maturityYears, parameters.decayYears);
  const annualYield =
    levelLoading * parameters.levelAnnualYield +
    slopeLoading * parameters.slopeAnnualYield +
    curvatureLoading * parameters.curvatureAnnualYield;
  assertFiniteResult(annualYield, "Nelson-Siegel yield");
  return annualYield;
}

export function evaluateNelsonSiegelCurve(
  parameters: NelsonSiegelParameters,
  maturitiesYears: readonly number[],
): NelsonSiegelCurvePoint[] {
  if (maturitiesYears.length > MAX_CURVE_POINTS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `maturitiesYears cannot contain more than ${MAX_CURVE_POINTS} points.`,
      "maturitiesYears",
    );
  }
  return maturitiesYears.map((maturityYears) => ({
    maturityYears,
    annualContinuouslyCompoundedYield: evaluateNelsonSiegelYield(
      parameters,
      maturityYears,
    ),
  }));
}

export function applyNelsonSiegelShock(
  parameters: NelsonSiegelParameters,
  shock: NelsonSiegelShock,
): NelsonSiegelParameters {
  validateNelsonSiegelParameters(parameters);
  assertNonNegative(shock.annualYieldMagnitude, "shock.annualYieldMagnitude");
  assertAtMost(
    shock.annualYieldMagnitude,
    1,
    "shock.annualYieldMagnitude",
  );

  const magnitude = shock.annualYieldMagnitude;
  const shocked = { ...parameters };
  switch (shock.name) {
    case "parallel-up":
      shocked.levelAnnualYield += magnitude;
      break;
    case "parallel-down":
      shocked.levelAnnualYield -= magnitude;
      break;
    case "steepening":
      shocked.slopeAnnualYield -= magnitude;
      break;
    case "flattening":
      shocked.slopeAnnualYield += magnitude;
      break;
    case "more-curvature":
      shocked.curvatureAnnualYield += magnitude;
      break;
    case "less-curvature":
      shocked.curvatureAnnualYield -= magnitude;
      break;
    default:
      throw new QuantError(
        "INVALID_INPUT",
        "Unknown Nelson-Siegel shock name.",
        "shock.name",
      );
  }
  validateNelsonSiegelParameters(shocked);
  return shocked;
}

/** Build the four canonical teaching scenarios on one shared maturity grid. */
export function buildNelsonSiegelNamedShockCurves(
  parameters: NelsonSiegelParameters,
  maturitiesYears: readonly number[],
  annualYieldMagnitude: number,
): NelsonSiegelNamedShockCurve[] {
  if (maturitiesYears.length === 0) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Named Nelson-Siegel shock curves need at least one maturity.",
      "maturitiesYears",
    );
  }
  const scenarios: readonly [
    NelsonSiegelNamedCurveShock,
    NelsonSiegelShockName,
  ][] = [
    ["parallel", "parallel-up"],
    ["steepen", "steepening"],
    ["flatten", "flattening"],
    ["curvature", "more-curvature"],
  ];
  const baseCurve = evaluateNelsonSiegelCurve(parameters, maturitiesYears);
  return scenarios.map(([name, shockName]) => {
    const parameterShock = { name: shockName, annualYieldMagnitude } as const;
    const shockedParameters = applyNelsonSiegelShock(
      parameters,
      parameterShock,
    );
    const shockedCurve = evaluateNelsonSiegelCurve(
      shockedParameters,
      maturitiesYears,
    );
    return {
      name,
      parameterShock,
      shockedParameters,
      curve: baseCurve.map((base, index) => ({
        maturityYears: base.maturityYears,
        baseAnnualYield: base.annualContinuouslyCompoundedYield,
        shockedAnnualYield:
          shockedCurve[index].annualContinuouslyCompoundedYield,
        annualYieldChange:
          shockedCurve[index].annualContinuouslyCompoundedYield -
          base.annualContinuouslyCompoundedYield,
      })),
    };
  });
}

export function fitNelsonSiegelCurve(
  request: NelsonSiegelFitRequest,
): ModelEnvelope<NelsonSiegelFitResult> {
  validateContract(request.contract, NELSON_SIEGEL_FIT_REQUEST_CONTRACT);
  validateNelsonSiegelObservations(
    request.maturitiesYears,
    request.observedAnnualYields,
  );

  const fixedDecay = request.fixedDecayYears;
  let candidate: NelsonSiegelCandidate;
  let fittingMethod: NelsonSiegelFitResult["fittingMethod"];
  let bounds: readonly [number, number] | null;
  if (fixedDecay !== undefined) {
    assertDecay(fixedDecay, "fixedDecayYears");
    candidate = fitNelsonSiegelAtDecay(
      request.maturitiesYears,
      request.observedAnnualYields,
      fixedDecay,
    );
    fittingMethod = "linear-least-squares-fixed-decay";
    bounds = null;
  } else {
    candidate = searchNelsonSiegelDecay(
      request.maturitiesYears,
      request.observedAnnualYields,
    );
    fittingMethod = "bounded-decay-search-with-linear-least-squares";
    bounds = NELSON_SIEGEL_DECAY_BOUNDS;
  }

  validateNelsonSiegelParameters(candidate.parameters);
  const rmseAnnualYield = Math.sqrt(
    candidate.sumSquaredError / request.maturitiesYears.length,
  );
  const warnings: ModelWarning[] = [];
  if (
    fixedDecay === undefined &&
    isAtDecayBoundary(candidate.parameters.decayYears)
  ) {
    warnings.push({
      code: "CALIBRATION",
      message:
        "The fitted decay reached the search boundary; widen the range or inspect curve identifiability.",
    });
  }

  return envelope(
    request.contract,
    NELSON_SIEGEL_FIT_RESULT_CONTRACT,
    undefined,
    warnings,
    {
      contract: NELSON_SIEGEL_FIT_RESULT_CONTRACT,
      yieldConvention: "annual-decimal-continuously-compounded",
      maturityUnit: "years",
      parameters: candidate.parameters,
      observedCurve: request.maturitiesYears.map((maturityYears, index) => ({
        maturityYears,
        annualContinuouslyCompoundedYield:
          request.observedAnnualYields[index],
      })),
      fittedCurve: request.maturitiesYears.map((maturityYears, index) => ({
        maturityYears,
        annualContinuouslyCompoundedYield: candidate.fitted[index],
      })),
      residualAnnualYields: candidate.residuals,
      rmseAnnualYield,
      fittingMethod,
      decaySearchBoundsYears: bounds,
      converged: true,
      modelNotes: [
        "Level controls the long end, slope mainly controls the short end, and curvature creates a medium-maturity hump.",
        "For a fixed decay, the three factors are fitted by ordinary least squares.",
        "This is a cross-sectional curve representation, not a stochastic interest-rate process.",
      ],
    },
  );
}

function searchNelsonSiegelDecay(
  maturitiesYears: readonly number[],
  observedAnnualYields: readonly number[],
): NelsonSiegelCandidate {
  const [lowerDecay, upperDecay] = NELSON_SIEGEL_DECAY_BOUNDS;
  const lowerLog = Math.log(lowerDecay);
  const upperLog = Math.log(upperDecay);
  const gridSize = 121;
  const candidates: Array<NelsonSiegelCandidate | null> = [];
  for (let index = 0; index < gridSize; index += 1) {
    const logDecay = lowerLog + ((upperLog - lowerLog) * index) / (gridSize - 1);
    candidates.push(
      tryFitNelsonSiegelAtDecay(
        maturitiesYears,
        observedAnnualYields,
        Math.exp(logDecay),
      ),
    );
  }

  let bestIndex = -1;
  for (let index = 0; index < candidates.length; index += 1) {
    if (
      candidates[index] !== null &&
      (bestIndex < 0 ||
        candidates[index]!.sumSquaredError <
          candidates[bestIndex]!.sumSquaredError)
    ) {
      bestIndex = index;
    }
  }
  if (bestIndex < 0) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "Nelson-Siegel fitting failed for every decay candidate.",
    );
  }

  const gridStep = (upperLog - lowerLog) / (gridSize - 1);
  let left = Math.max(lowerLog, lowerLog + (bestIndex - 1) * gridStep);
  let right = Math.min(upperLog, lowerLog + (bestIndex + 1) * gridStep);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let first = right - ratio * (right - left);
  let second = left + ratio * (right - left);
  let firstCandidate = fitNelsonSiegelAtDecay(
    maturitiesYears,
    observedAnnualYields,
    Math.exp(first),
  );
  let secondCandidate = fitNelsonSiegelAtDecay(
    maturitiesYears,
    observedAnnualYields,
    Math.exp(second),
  );
  for (let iteration = 0; iteration < 100 && right - left > 1e-12; iteration += 1) {
    if (firstCandidate.sumSquaredError <= secondCandidate.sumSquaredError) {
      right = second;
      second = first;
      secondCandidate = firstCandidate;
      first = right - ratio * (right - left);
      firstCandidate = fitNelsonSiegelAtDecay(
        maturitiesYears,
        observedAnnualYields,
        Math.exp(first),
      );
    } else {
      left = first;
      first = second;
      firstCandidate = secondCandidate;
      second = left + ratio * (right - left);
      secondCandidate = fitNelsonSiegelAtDecay(
        maturitiesYears,
        observedAnnualYields,
        Math.exp(second),
      );
    }
  }

  const refined =
    firstCandidate.sumSquaredError <= secondCandidate.sumSquaredError
      ? firstCandidate
      : secondCandidate;
  return refined.sumSquaredError <= candidates[bestIndex]!.sumSquaredError
    ? refined
    : candidates[bestIndex]!;
}

function tryFitNelsonSiegelAtDecay(
  maturitiesYears: readonly number[],
  observedAnnualYields: readonly number[],
  decayYears: number,
): NelsonSiegelCandidate | null {
  try {
    return fitNelsonSiegelAtDecay(
      maturitiesYears,
      observedAnnualYields,
      decayYears,
    );
  } catch (error) {
    if (error instanceof QuantError) return null;
    throw error;
  }
}

function fitNelsonSiegelAtDecay(
  maturitiesYears: readonly number[],
  observedAnnualYields: readonly number[],
  decayYears: number,
): NelsonSiegelCandidate {
  const rows = maturitiesYears.map((maturity) =>
    nelsonSiegelLoadings(maturity, decayYears),
  );
  const normalMatrix = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      rows.reduce(
        (total, loadings) => total + loadings[row] * loadings[column],
        0,
      ),
    ),
  );
  const rightSide = Array.from({ length: 3 }, (_, column) =>
    rows.reduce(
      (total, loadings, index) =>
        total + loadings[column] * observedAnnualYields[index],
      0,
    ),
  );
  const [levelAnnualYield, slopeAnnualYield, curvatureAnnualYield] =
    solveLinearSystem(normalMatrix, rightSide, 1e-14);
  const fitted = rows.map(
    (loadings) =>
      levelAnnualYield * loadings[0] +
      slopeAnnualYield * loadings[1] +
      curvatureAnnualYield * loadings[2],
  );
  const residuals = observedAnnualYields.map(
    (observed, index) => observed - fitted[index],
  );
  const sumSquaredError = residuals.reduce(
    (total, residual) => total + residual ** 2,
    0,
  );
  assertFiniteResult(sumSquaredError, "Nelson-Siegel fitting objective");
  return {
    parameters: {
      levelAnnualYield,
      slopeAnnualYield,
      curvatureAnnualYield,
      decayYears,
    },
    fitted,
    residuals,
    sumSquaredError,
  };
}

function nelsonSiegelLoadings(
  maturityYears: number,
  decayYears: number,
): [number, number, number] {
  const scaledMaturity = maturityYears / decayYears;
  if (scaledMaturity === 0) return [1, 1, 0];
  const slopeLoading =
    Math.abs(scaledMaturity) < 1e-5
      ? 1 -
        scaledMaturity / 2 +
        scaledMaturity ** 2 / 6 -
        scaledMaturity ** 3 / 24
      : -Math.expm1(-scaledMaturity) / scaledMaturity;
  const curvatureLoading = slopeLoading - Math.exp(-scaledMaturity);
  return [1, slopeLoading, curvatureLoading];
}

// ---------------------------------------------------------------------------
// Reduced-form hazard credit

export interface ConstantHazardCurve {
  readonly kind: "constant";
  /** Continuous default intensity per year, expressed as an annual decimal. */
  readonly annualHazardRate: number;
}

export interface PiecewiseHazardSegment {
  /** The first segment starts at zero; the last segment extends indefinitely. */
  readonly startYears: number;
  readonly annualHazardRate: number;
}

export interface PiecewiseConstantHazardCurve {
  readonly kind: "piecewise-constant";
  readonly segments: readonly PiecewiseHazardSegment[];
}

export type HazardCurve = ConstantHazardCurve | PiecewiseConstantHazardCurve;

export interface RiskyBondSpec {
  readonly faceValue: number;
  /** Annual simple coupon rate; each coupon is face × rate ÷ frequency. */
  readonly annualCouponRate: number;
  readonly couponFrequencyPerYear: number;
  readonly maturityYears: number;
  readonly continuouslyCompoundedRiskFreeRate: number;
}

export interface HazardCreditRequest {
  readonly contract: typeof HAZARD_CREDIT_REQUEST_CONTRACT;
  readonly hazardCurve: HazardCurve;
  readonly evaluationTimesYears: readonly number[];
  readonly exposureAtDefault: number;
  readonly recoveryFraction: number;
  readonly bond?: RiskyBondSpec;
}

export interface HazardCurvePoint {
  readonly timeYears: number;
  readonly cumulativeHazard: number;
  readonly survivalProbability: number;
  readonly cumulativeDefaultProbability: number;
  readonly intervalDefaultProbability: number;
  readonly expectedRecovery: number;
  readonly expectedLoss: number;
}

export interface RiskyScheduledCashFlow {
  readonly paymentTimeYears: number;
  readonly promisedCoupon: number;
  readonly promisedPrincipal: number;
  readonly survivalProbability: number;
  readonly expectedPayment: number;
  readonly discountFactor: number;
  readonly presentValue: number;
}

export interface RiskyRecoveryCashFlow {
  readonly intervalStartYears: number;
  readonly intervalEndYears: number;
  readonly annualHazardRate: number;
  readonly defaultProbability: number;
  readonly expectedRecovery: number;
  readonly presentValue: number;
}

export interface RiskyBondValuation {
  readonly recoveryConvention: "fraction-of-par-paid-at-default";
  readonly couponConvention: "annual-simple-rate-paid-in-equal-periods";
  readonly discounting: "constant-continuously-compounded-risk-free-rate";
  readonly scheduledCashFlows: readonly RiskyScheduledCashFlow[];
  readonly recoveryCashFlows: readonly RiskyRecoveryCashFlow[];
  readonly scheduledPresentValue: number;
  readonly recoveryPresentValue: number;
  readonly price: number;
}

export interface HazardCreditResult {
  readonly contract: typeof HAZARD_CREDIT_RESULT_CONTRACT;
  readonly hazardUnit: "continuous-annual-default-intensity-decimal";
  readonly timeUnit: "years";
  readonly probabilityBounds: readonly [0, 1];
  readonly hazardCurve: HazardCurve;
  readonly recoveryFraction: number;
  readonly curvePoints: readonly HazardCurvePoint[];
  readonly expectedDefaultTimeYearsConditionalOnDefaultThroughHorizon:
    | number
    | null;
  readonly bondValuation?: RiskyBondValuation;
  readonly modelNotes: readonly string[];
}

interface HazardInterval {
  readonly startYears: number;
  readonly endYears: number;
  readonly annualHazardRate: number;
}

export function cumulativeHazard(
  hazardCurve: HazardCurve,
  timeYears: number,
): number {
  validateHazardCurve(hazardCurve);
  assertHorizon(timeYears, "timeYears", true);
  return cumulativeHazardUnchecked(hazardCurve, timeYears);
}

export function survivalProbability(
  hazardCurve: HazardCurve,
  timeYears: number,
): number {
  return clamp(Math.exp(-cumulativeHazard(hazardCurve, timeYears)), 0, 1);
}

export function defaultProbability(
  hazardCurve: HazardCurve,
  startYears: number,
  endYears: number,
): number {
  validateHazardCurve(hazardCurve);
  assertHorizon(startYears, "startYears", true);
  assertHorizon(endYears, "endYears", true);
  if (endYears < startYears) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "endYears must not be before startYears.",
      "endYears",
    );
  }
  return clamp(
    Math.exp(-cumulativeHazardUnchecked(hazardCurve, startYears)) -
      Math.exp(-cumulativeHazardUnchecked(hazardCurve, endYears)),
    0,
    1,
  );
}

export function runHazardCreditAnalysis(
  request: HazardCreditRequest,
): ModelEnvelope<HazardCreditResult> {
  validateContract(request.contract, HAZARD_CREDIT_REQUEST_CONTRACT);
  validateHazardCurve(request.hazardCurve);
  validateEvaluationTimes(request.evaluationTimesYears);
  assertBoundedMoney(request.exposureAtDefault, "exposureAtDefault");
  assertProbability(request.recoveryFraction, "recoveryFraction");
  if (request.bond !== undefined) validateRiskyBond(request.bond);

  const curvePoints = buildHazardCurvePoints(request);
  const horizonYears = request.evaluationTimesYears.at(-1)!;
  const expectedDefaultTime = conditionalExpectedDefaultTime(
    request.hazardCurve,
    horizonYears,
  );
  const bondValuation = request.bond
    ? valueRiskyBond(
        request.hazardCurve,
        request.recoveryFraction,
        request.bond,
      )
    : undefined;
  const warnings: ModelWarning[] = [
    {
      code: "ASSUMPTION",
      message:
        "This reduced-form lesson assumes deterministic hazard rates independent of deterministic risk-free discounting.",
    },
  ];

  return envelope(
    request.contract,
    HAZARD_CREDIT_RESULT_CONTRACT,
    undefined,
    warnings,
    {
      contract: HAZARD_CREDIT_RESULT_CONTRACT,
      hazardUnit: "continuous-annual-default-intensity-decimal",
      timeUnit: "years",
      probabilityBounds: [0, 1],
      hazardCurve: request.hazardCurve,
      recoveryFraction: request.recoveryFraction,
      curvePoints,
      expectedDefaultTimeYearsConditionalOnDefaultThroughHorizon:
        expectedDefaultTime,
      ...(bondValuation === undefined ? {} : { bondValuation }),
      modelNotes: [
        "Survival is exp(-cumulative hazard); interval default probabilities telescope exactly.",
        "Expected loss is exposure × (1 - recovery) × cumulative default probability and is undiscounted.",
        "Bond recovery is a fraction of par paid at the default time, integrated within each constant-hazard interval.",
      ],
    },
  );
}

function buildHazardCurvePoints(
  request: HazardCreditRequest,
): HazardCurvePoint[] {
  let previousSurvival = 1;
  return request.evaluationTimesYears.map((timeYears) => {
    const integratedHazard = cumulativeHazardUnchecked(
      request.hazardCurve,
      timeYears,
    );
    const survival = clamp(Math.exp(-integratedHazard), 0, 1);
    const cumulativeDefault = clamp(1 - survival, 0, 1);
    const intervalDefault = clamp(previousSurvival - survival, 0, 1);
    previousSurvival = survival;
    return {
      timeYears,
      cumulativeHazard: integratedHazard,
      survivalProbability: survival,
      cumulativeDefaultProbability: cumulativeDefault,
      intervalDefaultProbability: intervalDefault,
      expectedRecovery:
        request.exposureAtDefault *
        request.recoveryFraction *
        cumulativeDefault,
      expectedLoss:
        request.exposureAtDefault *
        (1 - request.recoveryFraction) *
        cumulativeDefault,
    };
  });
}

function valueRiskyBond(
  hazardCurve: HazardCurve,
  recoveryFraction: number,
  bond: RiskyBondSpec,
): RiskyBondValuation {
  const periodCount = Math.round(
    bond.maturityYears * bond.couponFrequencyPerYear,
  );
  const coupon =
    (bond.faceValue * bond.annualCouponRate) /
    bond.couponFrequencyPerYear;
  const scheduledCashFlows = Array.from(
    { length: periodCount },
    (_, periodIndex): RiskyScheduledCashFlow => {
      const paymentTimeYears =
        (periodIndex + 1) / bond.couponFrequencyPerYear;
      const survival = Math.exp(
        -cumulativeHazardUnchecked(hazardCurve, paymentTimeYears),
      );
      const promisedPrincipal =
        periodIndex === periodCount - 1 ? bond.faceValue : 0;
      const promisedPayment = coupon + promisedPrincipal;
      const discountFactor = safeExp(
        -bond.continuouslyCompoundedRiskFreeRate * paymentTimeYears,
        "bond discount factor",
      );
      const expectedPayment = promisedPayment * survival;
      return {
        paymentTimeYears,
        promisedCoupon: coupon,
        promisedPrincipal,
        survivalProbability: clamp(survival, 0, 1),
        expectedPayment,
        discountFactor,
        presentValue: expectedPayment * discountFactor,
      };
    },
  );

  const recoveryCashFlows = hazardIntervals(
    hazardCurve,
    bond.maturityYears,
  ).map((interval): RiskyRecoveryCashFlow => {
    const lengthYears = interval.endYears - interval.startYears;
    const survivalAtStart = Math.exp(
      -cumulativeHazardUnchecked(hazardCurve, interval.startYears),
    );
    const discountAtStart = safeExp(
      -bond.continuouslyCompoundedRiskFreeRate * interval.startYears,
      "recovery discount factor",
    );
    const defaultProbabilityInInterval =
      survivalAtStart *
      -Math.expm1(-interval.annualHazardRate * lengthYears);
    const discountedDefaultWeight =
      survivalAtStart *
      discountAtStart *
      interval.annualHazardRate *
      integratedExponentialDecay(
        interval.annualHazardRate +
          bond.continuouslyCompoundedRiskFreeRate,
        lengthYears,
      );
    return {
      intervalStartYears: interval.startYears,
      intervalEndYears: interval.endYears,
      annualHazardRate: interval.annualHazardRate,
      defaultProbability: clamp(defaultProbabilityInInterval, 0, 1),
      expectedRecovery:
        recoveryFraction * bond.faceValue * defaultProbabilityInInterval,
      presentValue:
        recoveryFraction * bond.faceValue * discountedDefaultWeight,
    };
  });

  const scheduledPresentValue = scheduledCashFlows.reduce(
    (total, cashFlow) => total + cashFlow.presentValue,
    0,
  );
  const recoveryPresentValue = recoveryCashFlows.reduce(
    (total, cashFlow) => total + cashFlow.presentValue,
    0,
  );
  const price = scheduledPresentValue + recoveryPresentValue;
  assertFiniteResult(price, "risky bond price");
  return {
    recoveryConvention: "fraction-of-par-paid-at-default",
    couponConvention: "annual-simple-rate-paid-in-equal-periods",
    discounting: "constant-continuously-compounded-risk-free-rate",
    scheduledCashFlows,
    recoveryCashFlows,
    scheduledPresentValue,
    recoveryPresentValue,
    price,
  };
}

function conditionalExpectedDefaultTime(
  hazardCurve: HazardCurve,
  horizonYears: number,
): number | null {
  let firstMoment = 0;
  for (const interval of hazardIntervals(hazardCurve, horizonYears)) {
    const rate = interval.annualHazardRate;
    if (rate === 0) continue;
    const lengthYears = interval.endYears - interval.startYears;
    const survivalAtStart = Math.exp(
      -cumulativeHazardUnchecked(hazardCurve, interval.startYears),
    );
    const exponential = Math.exp(-rate * lengthYears);
    const intervalProbability = survivalAtStart * (1 - exponential);
    const elapsedFirstMoment =
      survivalAtStart * ((1 - exponential) / rate - lengthYears * exponential);
    firstMoment +=
      interval.startYears * intervalProbability + elapsedFirstMoment;
  }
  const cumulativeDefault =
    1 - Math.exp(-cumulativeHazardUnchecked(hazardCurve, horizonYears));
  return cumulativeDefault <= 0
    ? null
    : clamp(firstMoment / cumulativeDefault, 0, horizonYears);
}

function cumulativeHazardUnchecked(
  hazardCurve: HazardCurve,
  timeYears: number,
): number {
  if (hazardCurve.kind === "constant") {
    return hazardCurve.annualHazardRate * timeYears;
  }
  let total = 0;
  for (let index = 0; index < hazardCurve.segments.length; index += 1) {
    const segment = hazardCurve.segments[index];
    if (timeYears <= segment.startYears) break;
    const nextStart =
      hazardCurve.segments[index + 1]?.startYears ?? timeYears;
    const endYears = Math.min(timeYears, nextStart);
    total +=
      segment.annualHazardRate * (endYears - segment.startYears);
  }
  return total;
}

function hazardIntervals(
  hazardCurve: HazardCurve,
  horizonYears: number,
): HazardInterval[] {
  if (hazardCurve.kind === "constant") {
    return [
      {
        startYears: 0,
        endYears: horizonYears,
        annualHazardRate: hazardCurve.annualHazardRate,
      },
    ];
  }
  return hazardCurve.segments
    .filter((segment) => segment.startYears < horizonYears)
    .map((segment, index) => ({
      startYears: segment.startYears,
      endYears: Math.min(
        horizonYears,
        hazardCurve.segments[index + 1]?.startYears ?? horizonYears,
      ),
      annualHazardRate: segment.annualHazardRate,
    }));
}

// ---------------------------------------------------------------------------
// Merton structural credit

export interface MertonCreditRequest {
  readonly contract: typeof MERTON_CREDIT_REQUEST_CONTRACT;
  readonly assetValue: number;
  readonly debtFaceValue: number;
  readonly maturityYears: number;
  readonly continuouslyCompoundedRiskFreeRate: number;
  readonly annualAssetVolatility: number;
  /** Physical-measure expected continuously compounded asset return. */
  readonly physicalExpectedAssetReturn: number;
}

export interface MertonCreditResult {
  readonly contract: typeof MERTON_CREDIT_RESULT_CONTRACT;
  readonly currencyUnit: "same-as-input-values";
  readonly rateUnit: "annual-decimal";
  readonly timeUnit: "years";
  readonly equityInterpretation: "european-call-on-firm-assets";
  readonly equityValue: number;
  readonly riskyDebtValue: number;
  readonly defaultFreeDebtValue: number;
  readonly debtGuaranteePutValue: number;
  readonly riskNeutralDefaultProbability: number;
  readonly physicalDefaultProbability: number;
  readonly distanceToDefault: number | null;
  readonly annualCreditSpread: number;
  readonly equityDeltaToAssetValue: number;
  readonly impliedRecoveryFractionGivenDefault: number | null;
  readonly modelNotes: readonly string[];
}

export function mertonStructuralCredit(
  request: MertonCreditRequest,
): ModelEnvelope<MertonCreditResult> {
  validateMertonRequest(request);
  const defaultFreeDebtValue =
    request.debtFaceValue *
    safeExp(
      -request.continuouslyCompoundedRiskFreeRate * request.maturityYears,
      "default-free debt value",
    );
  const warnings: ModelWarning[] = [
    {
      code: "ASSUMPTION",
      message:
        "Merton default occurs only at debt maturity and assumes firm asset value follows a lognormal diffusion.",
    },
  ];
  const optionValues = priceMertonOptionValues(request);

  const valuation =
    request.annualAssetVolatility === 0
      ? deterministicMertonValuation(
          request,
          optionValues,
          warnings,
        )
      : stochasticMertonValuation(
          request,
          defaultFreeDebtValue,
          optionValues,
        );
  if (valuation.riskyDebtValue <= 0) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "Merton risky debt underflowed; use less extreme maturity or volatility inputs.",
    );
  }
  const riskyDebtYield =
    -Math.log(valuation.riskyDebtValue / request.debtFaceValue) /
    request.maturityYears;
  const annualCreditSpread = Math.max(
    0,
    riskyDebtYield - request.continuouslyCompoundedRiskFreeRate,
  );

  return envelope(
    request.contract,
    MERTON_CREDIT_RESULT_CONTRACT,
    undefined,
    warnings,
    {
      contract: MERTON_CREDIT_RESULT_CONTRACT,
      currencyUnit: "same-as-input-values",
      rateUnit: "annual-decimal",
      timeUnit: "years",
      equityInterpretation: "european-call-on-firm-assets",
      equityValue: valuation.equityValue,
      riskyDebtValue: valuation.riskyDebtValue,
      defaultFreeDebtValue,
      debtGuaranteePutValue: valuation.debtGuaranteePutValue,
      riskNeutralDefaultProbability: valuation.riskNeutralDefaultProbability,
      physicalDefaultProbability: valuation.physicalDefaultProbability,
      distanceToDefault: valuation.distanceToDefault,
      annualCreditSpread,
      equityDeltaToAssetValue: valuation.equityDeltaToAssetValue,
      impliedRecoveryFractionGivenDefault:
        valuation.impliedRecoveryFractionGivenDefault,
      modelNotes: [
        "Equity is a European call on firm assets with strike equal to debt face value.",
        "The equity call, guarantee put, and equity delta use the same validated Black-Scholes evaluator as the derivatives laboratory.",
        "Risky debt equals firm assets minus equity and also equals default-free debt minus a put guarantee.",
        "Risk-neutral default probability prices claims; physical default probability uses the supplied expected asset return for forecasting.",
      ],
    },
  );
}

interface MertonValuation {
  readonly equityValue: number;
  readonly riskyDebtValue: number;
  readonly debtGuaranteePutValue: number;
  readonly riskNeutralDefaultProbability: number;
  readonly physicalDefaultProbability: number;
  readonly distanceToDefault: number | null;
  readonly equityDeltaToAssetValue: number;
  readonly impliedRecoveryFractionGivenDefault: number | null;
}

interface MertonOptionValues {
  readonly equityCall: BlackScholesResult;
  readonly debtGuaranteePut: BlackScholesResult;
}

function priceMertonOptionValues(
  request: MertonCreditRequest,
): MertonOptionValues {
  const sharedInputs = {
    spot: request.assetValue,
    strike: request.debtFaceValue,
    timeToMaturityYears: request.maturityYears,
    riskFreeRate: request.continuouslyCompoundedRiskFreeRate,
    volatility: request.annualAssetVolatility,
    dividendYield: 0,
  } as const;
  return {
    equityCall: evaluateBlackScholes({
      ...sharedInputs,
      optionType: "call",
    }),
    debtGuaranteePut: evaluateBlackScholes({
      ...sharedInputs,
      optionType: "put",
    }),
  };
}

function stochasticMertonValuation(
  request: MertonCreditRequest,
  defaultFreeDebtValue: number,
  optionValues: MertonOptionValues,
): MertonValuation {
  const volatilityTime =
    request.annualAssetVolatility * Math.sqrt(request.maturityYears);
  const logLeverage = Math.log(request.assetValue / request.debtFaceValue);
  const riskNeutralD1 = optionValues.equityCall.d1;
  const riskNeutralD2 = optionValues.equityCall.d2;
  if (riskNeutralD1 === null || riskNeutralD2 === null) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "The stochastic Merton valuation expected finite Black-Scholes d1 and d2 values.",
    );
  }
  const distanceToDefault =
    (logLeverage +
      (request.physicalExpectedAssetReturn -
        request.annualAssetVolatility ** 2 / 2) *
        request.maturityYears) /
    volatilityTime;
  const rawRiskyDebt = request.assetValue - optionValues.equityCall.price;
  const riskyDebtValue = clamp(
    rawRiskyDebt,
    0,
    Math.min(request.assetValue, defaultFreeDebtValue),
  );
  const equityValue = optionValues.equityCall.price;
  const debtGuaranteePutValue = optionValues.debtGuaranteePut.price;
  const riskNeutralDefaultProbability = boundedNormalCdf(-riskNeutralD2);
  const physicalDefaultProbability = boundedNormalCdf(-distanceToDefault);
  const truncatedDefaultAssetExpectation =
    request.assetValue *
    safeExp(
      request.continuouslyCompoundedRiskFreeRate * request.maturityYears,
      "Merton terminal asset expectation",
    ) *
    boundedNormalCdf(-riskNeutralD1);
  const impliedRecoveryFractionGivenDefault =
    riskNeutralDefaultProbability <= 1e-14
      ? null
      : clamp(
          truncatedDefaultAssetExpectation /
            (request.debtFaceValue * riskNeutralDefaultProbability),
          0,
          1,
        );
  return {
    equityValue,
    riskyDebtValue,
    debtGuaranteePutValue,
    riskNeutralDefaultProbability,
    physicalDefaultProbability,
    distanceToDefault,
    equityDeltaToAssetValue: optionValues.equityCall.greeks.delta,
    impliedRecoveryFractionGivenDefault,
  };
}

function deterministicMertonValuation(
  request: MertonCreditRequest,
  optionValues: MertonOptionValues,
  warnings: ModelWarning[],
): MertonValuation {
  warnings.push({
    code: "BOUNDARY",
    message:
      "With zero asset volatility, default is deterministic and distance-to-default is undefined rather than infinite.",
  });
  const riskNeutralTerminalAsset =
    request.assetValue *
    safeExp(
      request.continuouslyCompoundedRiskFreeRate * request.maturityYears,
      "risk-neutral terminal assets",
    );
  const physicalTerminalAsset =
    request.assetValue *
    safeExp(
      request.physicalExpectedAssetReturn * request.maturityYears,
      "physical terminal assets",
    );
  const equityValue = optionValues.equityCall.price;
  const riskyDebtValue = request.assetValue - equityValue;
  const riskNeutralDefaultProbability = Number(
    riskNeutralTerminalAsset < request.debtFaceValue,
  );
  return {
    equityValue,
    riskyDebtValue,
    debtGuaranteePutValue: optionValues.debtGuaranteePut.price,
    riskNeutralDefaultProbability,
    physicalDefaultProbability: Number(
      physicalTerminalAsset < request.debtFaceValue,
    ),
    distanceToDefault: null,
    equityDeltaToAssetValue: optionValues.equityCall.greeks.delta,
    impliedRecoveryFractionGivenDefault:
      riskNeutralDefaultProbability === 0
        ? null
        : clamp(riskNeutralTerminalAsset / request.debtFaceValue, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Unified deep-module entry point

export type RatesCreditLabRequest =
  | VasicekRequest
  | CirRequest
  | ShortRateModelComparisonRequest
  | NelsonSiegelFitRequest
  | HazardCreditRequest
  | MertonCreditRequest;

export type RatesCreditLabEnvelope =
  | ModelEnvelope<VasicekResult>
  | ModelEnvelope<CirResult>
  | ModelEnvelope<ShortRateModelComparisonResult>
  | ModelEnvelope<NelsonSiegelFitResult>
  | ModelEnvelope<HazardCreditResult>
  | ModelEnvelope<MertonCreditResult>;

export function runRatesCreditLab(
  request: RatesCreditLabRequest,
): RatesCreditLabEnvelope {
  switch (request.contract) {
    case VASICEK_REQUEST_CONTRACT:
      return runVasicekModel(request);
    case CIR_REQUEST_CONTRACT:
      return runCirModel(request);
    case SHORT_RATE_COMPARISON_REQUEST_CONTRACT:
      return compareVasicekAndCir(request);
    case NELSON_SIEGEL_FIT_REQUEST_CONTRACT:
      return fitNelsonSiegelCurve(request);
    case HAZARD_CREDIT_REQUEST_CONTRACT:
      return runHazardCreditAnalysis(request);
    case MERTON_CREDIT_REQUEST_CONTRACT:
      return mertonStructuralCredit(request);
  }
}

// ---------------------------------------------------------------------------
// Validation and numerical helpers

function validateVasicekParameters(parameters: VasicekParameters): void {
  assertAnnualRate(
    parameters.initialAnnualShortRate,
    "parameters.initialAnnualShortRate",
  );
  assertAnnualRate(
    parameters.longRunAnnualMeanRate,
    "parameters.longRunAnnualMeanRate",
  );
  assertMeanReversionSpeed(
    parameters.meanReversionSpeedPerYear,
    "parameters.meanReversionSpeedPerYear",
  );
  assertAnnualVolatility(
    parameters.annualVolatility,
    "parameters.annualVolatility",
  );
}

function validateCirParameters(parameters: CirParameters): void {
  assertNonNegative(
    parameters.initialAnnualShortRate,
    "parameters.initialAnnualShortRate",
  );
  assertAtMost(
    parameters.initialAnnualShortRate,
    MAX_ABSOLUTE_ANNUAL_RATE,
    "parameters.initialAnnualShortRate",
  );
  assertNonNegative(
    parameters.longRunAnnualMeanRate,
    "parameters.longRunAnnualMeanRate",
  );
  assertAtMost(
    parameters.longRunAnnualMeanRate,
    MAX_ABSOLUTE_ANNUAL_RATE,
    "parameters.longRunAnnualMeanRate",
  );
  assertMeanReversionSpeed(
    parameters.meanReversionSpeedPerYear,
    "parameters.meanReversionSpeedPerYear",
  );
  assertAnnualVolatility(
    parameters.annualVolatility,
    "parameters.annualVolatility",
  );
}

function validateShortRateExecution(execution: ShortRateExecution): void {
  assertFinite(execution.seed, "execution.seed");
  assertIntegerInRange(
    execution.pathCount,
    1,
    MAX_PATH_COUNT,
    "execution.pathCount",
  );
  assertIntegerInRange(
    execution.stepCount,
    1,
    MAX_STEP_COUNT,
    "execution.stepCount",
  );
  assertPositive(execution.stepYears, "execution.stepYears");
  assertAtMost(execution.stepYears, 10, "execution.stepYears");
  const pointCount = execution.pathCount * (execution.stepCount + 1);
  if (pointCount > MAX_SIMULATED_POINTS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `The request would return ${pointCount} rate points; the limit is ${MAX_SIMULATED_POINTS}.`,
      "execution",
    );
  }
  assertHorizon(
    execution.stepCount * execution.stepYears,
    "execution horizon",
    false,
  );
}

function validateMaturityList(
  maturities: readonly number[],
  path: string,
): void {
  if (maturities.length > 256) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} cannot contain more than 256 maturities.`,
      path,
    );
  }
  maturities.forEach((maturity, index) =>
    assertHorizon(maturity, `${path}.${index}`, true),
  );
}

function validateNelsonSiegelParameters(
  parameters: NelsonSiegelParameters,
): void {
  assertAnnualRate(parameters.levelAnnualYield, "parameters.levelAnnualYield");
  assertAnnualRate(parameters.slopeAnnualYield, "parameters.slopeAnnualYield");
  assertAnnualRate(
    parameters.curvatureAnnualYield,
    "parameters.curvatureAnnualYield",
  );
  assertDecay(parameters.decayYears, "parameters.decayYears");
}

function validateNelsonSiegelObservations(
  maturitiesYears: readonly number[],
  observedAnnualYields: readonly number[],
): void {
  if (maturitiesYears.length !== observedAnnualYields.length) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Maturities and observed yields must have the same length.",
    );
  }
  if (maturitiesYears.length < 3 || maturitiesYears.length > MAX_CURVE_POINTS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `Nelson-Siegel fitting needs 3 to ${MAX_CURVE_POINTS} observations.`,
      "maturitiesYears",
    );
  }
  maturitiesYears.forEach((maturity, index) =>
    assertHorizon(maturity, `maturitiesYears.${index}`, true),
  );
  observedAnnualYields.forEach((annualYield, index) =>
    assertAnnualRate(annualYield, `observedAnnualYields.${index}`),
  );
  if (new Set(maturitiesYears).size < 3) {
    throw new QuantError(
      "INVALID_INPUT",
      "Nelson-Siegel fitting needs at least three distinct maturities.",
      "maturitiesYears",
    );
  }
}

function validateHazardCurve(hazardCurve: HazardCurve): void {
  if (hazardCurve.kind === "constant") {
    assertHazardRate(hazardCurve.annualHazardRate, "hazardCurve.annualHazardRate");
    return;
  }
  if (hazardCurve.kind !== "piecewise-constant") {
    throw new QuantError(
      "INVALID_INPUT",
      "hazardCurve.kind must be constant or piecewise-constant.",
      "hazardCurve.kind",
    );
  }
  if (hazardCurve.segments.length === 0 || hazardCurve.segments.length > 256) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "A piecewise hazard curve needs 1 to 256 segments.",
      "hazardCurve.segments",
    );
  }
  hazardCurve.segments.forEach((segment, index) => {
    assertHorizon(
      segment.startYears,
      `hazardCurve.segments.${index}.startYears`,
      true,
    );
    assertHazardRate(
      segment.annualHazardRate,
      `hazardCurve.segments.${index}.annualHazardRate`,
    );
    if (index === 0 && segment.startYears !== 0) {
      throw new QuantError(
        "INVALID_INPUT",
        "The first piecewise hazard segment must start at year zero.",
        "hazardCurve.segments.0.startYears",
      );
    }
    if (
      index > 0 &&
      segment.startYears <= hazardCurve.segments[index - 1].startYears
    ) {
      throw new QuantError(
        "INVALID_INPUT",
        "Piecewise hazard segment starts must be strictly increasing.",
        `hazardCurve.segments.${index}.startYears`,
      );
    }
  });
}

function validateEvaluationTimes(timesYears: readonly number[]): void {
  if (timesYears.length === 0 || timesYears.length > MAX_CURVE_POINTS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `evaluationTimesYears needs 1 to ${MAX_CURVE_POINTS} points.`,
      "evaluationTimesYears",
    );
  }
  timesYears.forEach((time, index) => {
    assertHorizon(time, `evaluationTimesYears.${index}`, false);
    if (index > 0 && time <= timesYears[index - 1]) {
      throw new QuantError(
        "INVALID_INPUT",
        "evaluationTimesYears must be strictly increasing.",
        `evaluationTimesYears.${index}`,
      );
    }
  });
}

function validateRiskyBond(bond: RiskyBondSpec): void {
  assertBoundedMoney(bond.faceValue, "bond.faceValue");
  assertNonNegative(bond.annualCouponRate, "bond.annualCouponRate");
  assertAtMost(bond.annualCouponRate, 5, "bond.annualCouponRate");
  assertIntegerInRange(
    bond.couponFrequencyPerYear,
    1,
    365,
    "bond.couponFrequencyPerYear",
  );
  assertHorizon(bond.maturityYears, "bond.maturityYears", false);
  assertAnnualRate(
    bond.continuouslyCompoundedRiskFreeRate,
    "bond.continuouslyCompoundedRiskFreeRate",
  );
  const exactPeriodCount =
    bond.maturityYears * bond.couponFrequencyPerYear;
  const roundedPeriodCount = Math.round(exactPeriodCount);
  if (
    roundedPeriodCount < 1 ||
    roundedPeriodCount > MAX_BOND_PERIODS ||
    Math.abs(exactPeriodCount - roundedPeriodCount) > 1e-9
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      `Bond maturity must contain a whole number of coupon periods, up to ${MAX_BOND_PERIODS}.`,
      "bond.maturityYears",
    );
  }
}

function validateMertonRequest(request: MertonCreditRequest): void {
  validateContract(request.contract, MERTON_CREDIT_REQUEST_CONTRACT);
  assertBoundedMoney(request.assetValue, "assetValue");
  assertBoundedMoney(request.debtFaceValue, "debtFaceValue");
  assertHorizon(request.maturityYears, "maturityYears", false);
  assertAnnualRate(
    request.continuouslyCompoundedRiskFreeRate,
    "continuouslyCompoundedRiskFreeRate",
  );
  assertAnnualVolatility(
    request.annualAssetVolatility,
    "annualAssetVolatility",
  );
  assertAnnualRate(
    request.physicalExpectedAssetReturn,
    "physicalExpectedAssetReturn",
  );
}

function validateContract(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new QuantError(
      "INVALID_INPUT",
      `Unsupported contract ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`,
      "contract",
    );
  }
}

function assertAnnualRate(value: number, path: string): void {
  assertFinite(value, path);
  if (Math.abs(value) > MAX_ABSOLUTE_ANNUAL_RATE) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must be an annual decimal between -${MAX_ABSOLUTE_ANNUAL_RATE} and ${MAX_ABSOLUTE_ANNUAL_RATE}.`,
      path,
    );
  }
}

function assertHazardRate(value: number, path: string): void {
  assertNonNegative(value, path);
  assertAtMost(value, 100, path);
}

function assertAnnualVolatility(value: number, path: string): void {
  assertNonNegative(value, path);
  assertAtMost(value, MAX_ANNUAL_VOLATILITY, path);
}

function assertMeanReversionSpeed(value: number, path: string): void {
  assertPositive(value, path);
  assertAtMost(value, MAX_MEAN_REVERSION_SPEED, path);
}

function assertDecay(value: number, path: string): void {
  assertPositive(value, path);
  assertAtMost(value, MAX_MATURITY_YEARS, path);
}

function assertHorizon(
  value: number,
  path: string,
  allowZero: boolean,
): void {
  if (allowZero) assertNonNegative(value, path);
  else assertPositive(value, path);
  assertAtMost(value, MAX_MATURITY_YEARS, path);
}

function assertBoundedMoney(value: number, path: string): void {
  assertPositive(value, path);
  assertAtMost(value, MAX_MONETARY_AMOUNT, path);
}

function assertAtMost(value: number, maximum: number, path: string): void {
  assertFinite(value, path);
  if (value > maximum) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must be at most ${maximum}.`,
      path,
    );
  }
}

function buildTimes(execution: ShortRateExecution): number[] {
  return Array.from(
    { length: execution.stepCount + 1 },
    (_, index) => index * execution.stepYears,
  );
}

function buildRateFan(
  paths: readonly (readonly number[])[],
  timesYears: readonly number[],
): ShortRateFanPoint[] {
  return timesYears.map((timeYears, timeIndex) => {
    const sortedRates = paths
      .map((path) => path[timeIndex])
      .sort((left, right) => left - right);
    return {
      timeYears,
      p05AnnualRate: sortedQuantile(sortedRates, 0.05),
      medianAnnualRate: sortedQuantile(sortedRates, 0.5),
      p95AnnualRate: sortedQuantile(sortedRates, 0.95),
    };
  });
}

function sortedQuantile(sortedValues: readonly number[], probability: number): number {
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function negativeObservationFraction(
  paths: readonly (readonly number[])[],
): number {
  let negativeCount = 0;
  let observationCount = 0;
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      negativeCount += Number(path[index] < 0);
      observationCount += 1;
    }
  }
  return observationCount === 0 ? 0 : negativeCount / observationCount;
}

function unitMaturityBondAnalytics(): ZeroCouponBondAnalytics {
  return {
    maturityYears: 0,
    pricePerUnitFace: 1,
    continuouslyCompoundedZeroYield: null,
    shortRateDurationYears: 0,
    shortRateConvexityYearsSquared: 0,
  };
}

function bondAnalyticsFromLogPrice(
  maturityYears: number,
  logPrice: number,
  shortRateDurationYears: number,
): ZeroCouponBondAnalytics {
  const pricePerUnitFace = safeExp(logPrice, "zero-coupon bond price");
  return {
    maturityYears,
    pricePerUnitFace,
    continuouslyCompoundedZeroYield: -logPrice / maturityYears,
    shortRateDurationYears,
    shortRateConvexityYearsSquared: shortRateDurationYears ** 2,
  };
}

function integratedExponentialDecay(rate: number, years: number): number {
  return Math.abs(rate) < 1e-12 ? years : -Math.expm1(-rate * years) / rate;
}

function boundedNormalCdf(value: number): number {
  return clamp(normalCdf(value), 0, 1);
}

function safeExp(exponent: number, label: string): number {
  assertFiniteResult(exponent, `${label} exponent`);
  const value = Math.exp(exponent);
  if (!Number.isFinite(value) || value === 0) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      `${label} overflowed or underflowed under the requested inputs.`,
    );
  }
  return value;
}

function assertFiniteResult(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      `${label} was not finite under the requested inputs.`,
    );
  }
}

function isAtDecayBoundary(decayYears: number): boolean {
  const [lower, upper] = NELSON_SIEGEL_DECAY_BOUNDS;
  return (
    Math.abs(decayYears - lower) <= lower * 1e-6 ||
    Math.abs(decayYears - upper) <= upper * 1e-6
  );
}

function mergeWarnings(
  ...groups: (readonly ModelWarning[])[]
): ModelWarning[] {
  const unique = new Map<string, ModelWarning>();
  for (const warning of groups.flat()) {
    unique.set(`${warning.code}:${warning.message}`, warning);
  }
  return [...unique.values()];
}

function envelope<Result>(
  inputContract: string,
  resultContract: string,
  seed: number | undefined,
  warnings: readonly ModelWarning[],
  result: Result,
): ModelEnvelope<Result> {
  return {
    result,
    warnings,
    provenance: {
      engineVersion: RATES_CREDIT_ENGINE_VERSION,
      ...(seed === undefined ? {} : { seed }),
      inputContract,
      resultContract,
    },
  };
}

/** Lanczos approximation used only by the exact Poisson acceptance test. */
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  const shifted = value - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index] / (shifted + index + 1);
  }
  const base = shifted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(base) -
    base +
    Math.log(series)
  );
}
