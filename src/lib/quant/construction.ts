/**
 * Portfolio construction models expressed as plain-data, versioned contracts.
 *
 * All returns, variances, and covariances refer to the same caller-selected
 * period. Rates are decimals: 0.08 means eight percent per period, not 8.
 */
import {
  type ModelEnvelope,
  type ModelWarning,
  type NumericMatrix,
  QuantError,
  addMatrices,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  assertProbability,
  cholesky,
  clamp,
  covarianceMatrix,
  dot,
  identityMatrix,
  matrixMultiply,
  matrixVectorMultiply,
  mean,
  normalCdf,
  scaleMatrix,
  solveLinearSystem,
  sum,
  transpose,
} from "./core";
import {
  type ObservationFrequency,
  type ReturnDataset,
  validateReturnDataset,
} from "./market-models";

export const CONSTRUCTION_ENGINE_VERSION = "portfolio-construction@1";
export const MEAN_VARIANCE_REQUEST_CONTRACT =
  "portfolio-construction/mean-variance-request@1";
export const MEAN_VARIANCE_RESULT_CONTRACT =
  "portfolio-construction/mean-variance-result@1";
export const CAPM_REQUEST_CONTRACT = "portfolio-construction/capm-request@1";
export const CAPM_RESULT_CONTRACT = "portfolio-construction/capm-result@1";
export const FACTOR_MODEL_REQUEST_CONTRACT =
  "portfolio-construction/factor-model-request@1";
export const FACTOR_MODEL_RESULT_CONTRACT =
  "portfolio-construction/factor-model-result@1";
export const FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT =
  "portfolio-construction/factor-dataset-alignment-request@1";
export const ALIGNED_FACTOR_DATASET_CONTRACT =
  "portfolio-construction/aligned-factor-dataset@1";
export const ROLLING_FACTOR_REQUEST_CONTRACT =
  "portfolio-construction/rolling-factor-request@1";
export const ROLLING_FACTOR_RESULT_CONTRACT =
  "portfolio-construction/rolling-factor-result@1";
export const RISK_PARITY_REQUEST_CONTRACT =
  "portfolio-construction/risk-parity-request@1";
export const RISK_PARITY_RESULT_CONTRACT =
  "portfolio-construction/risk-parity-result@1";
export const KELLY_REQUEST_CONTRACT = "portfolio-construction/kelly-request@1";
export const KELLY_RESULT_CONTRACT = "portfolio-construction/kelly-result@1";
export const BLACK_LITTERMAN_REQUEST_CONTRACT =
  "portfolio-construction/black-litterman-request@1";
export const BLACK_LITTERMAN_RESULT_CONTRACT =
  "portfolio-construction/black-litterman-result@1";

const MAX_ASSETS = 100;
const MAX_FACTORS = 30;
const MAX_OBSERVATIONS = 100_000;
const MAX_OBSERVATION_CELLS = 2_000_000;
const MAX_ROLLING_WINDOWS = 10_000;
const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 5_000;
const NUMERICAL_EPSILON = 1e-12;

export interface ConstructionSolverOptions {
  /** Numerical stopping tolerance, not a financial confidence level. */
  readonly tolerance?: number;
  readonly maxIterations?: number;
}

export interface SolverDiagnostics {
  readonly converged: boolean;
  readonly iterations: number;
  readonly maximumError: number;
  readonly covarianceRidge: number;
}

/** A fully inspectable decomposition of portfolio volatility. */
export interface PortfolioAllocation {
  readonly assetIds: readonly string[];
  readonly weights: readonly number[];
  readonly expectedReturnPerPeriod: number;
  readonly variancePerPeriod: number;
  readonly volatilityPerPeriod: number;
  /** Null means volatility is zero, so a finite Sharpe ratio is undefined. */
  readonly sharpeRatio: number | null;
  readonly marginalVolatilityContributions: readonly number[];
  readonly volatilityContributions: readonly number[];
  readonly normalizedRiskContributions: readonly number[];
}

export interface MeanVarianceRequest {
  readonly contract: typeof MEAN_VARIANCE_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  /** Arithmetic expected simple returns, all measured over one common period. */
  readonly expectedReturnsPerPeriod: readonly number[];
  /** Return covariance over the same period as expectedReturnsPerPeriod. */
  readonly covariancePerPeriod: NumericMatrix;
  readonly riskFreeRatePerPeriod?: number;
  readonly frontierPointCount?: number;
  readonly solver?: ConstructionSolverOptions;
}

export interface EfficientFrontierPoint {
  readonly targetReturnPerPeriod: number;
  readonly allocation: PortfolioAllocation;
  readonly diagnostics: SolverDiagnostics;
}

export interface MeanVarianceResult {
  readonly contract: typeof MEAN_VARIANCE_RESULT_CONTRACT;
  readonly constraints: {
    readonly longOnly: true;
    readonly fullyInvested: true;
  };
  readonly minimumVariance: PortfolioAllocation;
  readonly maximumSharpe: PortfolioAllocation;
  readonly efficientFrontier: readonly EfficientFrontierPoint[];
  readonly capitalMarketLine: {
    readonly interceptPerPeriod: number;
    readonly slope: number;
  } | null;
  readonly diagnostics: {
    readonly minimumVariance: SolverDiagnostics;
    readonly maximumSharpe: SolverDiagnostics;
  };
}

export interface CapmRequest {
  readonly contract: typeof CAPM_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  /** Rows are observations and columns follow assetIds. */
  readonly assetReturnsPerPeriod: NumericMatrix;
  readonly marketReturnsPerPeriod: readonly number[];
  readonly riskFreeRatePerPeriod: number;
  readonly portfolioWeights?: readonly number[];
}

export interface CapmAssetEstimate {
  readonly assetId: string;
  readonly beta: number;
  readonly alphaPerPeriod: number;
  readonly expectedReturnFromSecurityMarketLinePerPeriod: number;
  readonly realizedMeanReturnPerPeriod: number;
  readonly residualVolatilityPerPeriod: number;
  readonly rSquared: number;
}

export interface CapmResult {
  readonly contract: typeof CAPM_RESULT_CONTRACT;
  readonly observationCount: number;
  readonly returnConvention: "arithmetic-simple-per-period";
  readonly securityMarketLine: {
    readonly interceptPerPeriod: number;
    readonly slopePerPeriod: number;
  };
  readonly market: {
    readonly meanReturnPerPeriod: number;
    readonly variancePerPeriod: number;
    readonly riskPremiumPerPeriod: number;
  };
  readonly assets: readonly CapmAssetEstimate[];
  readonly portfolio: {
    readonly weights: readonly number[];
    readonly beta: number;
    readonly alphaPerPeriod: number;
    readonly expectedReturnFromSecurityMarketLinePerPeriod: number;
    readonly realizedMeanReturnPerPeriod: number;
  } | null;
}

export interface FactorScenario {
  readonly label: string;
  /** Unexpected factor moves, in simple-return decimal units for one period. */
  readonly factorShocksPerPeriod: readonly number[];
}

export interface FactorModelRequest {
  readonly contract: typeof FACTOR_MODEL_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  readonly factorIds: readonly string[];
  /** Both matrices use aligned observation rows. */
  readonly assetReturnsPerPeriod: NumericMatrix;
  readonly factorReturnsPerPeriod: NumericMatrix;
  readonly portfolioWeights?: readonly number[];
  readonly scenario?: FactorScenario;
}

/** Factor and residual components add to modeled variance and volatility. */
export interface FactorRiskAttribution {
  readonly factorVarianceContributionsPerPeriod: readonly number[];
  readonly factorVolatilityContributionsPerPeriod: readonly number[];
  readonly residualVariancePerPeriod: number;
  readonly residualVolatilityContributionPerPeriod: number;
  readonly totalVariancePerPeriod: number;
  readonly totalVolatilityPerPeriod: number;
}

export interface FactorAssetEstimate {
  readonly assetId: string;
  readonly interceptPerPeriod: number;
  readonly exposures: readonly number[];
  readonly realizedMeanReturnPerPeriod: number;
  readonly modeledMeanReturnPerPeriod: number;
  readonly meanReturnContributionsPerPeriod: readonly number[];
  readonly residualVolatilityPerPeriod: number;
  readonly riskAttribution: FactorRiskAttribution;
  readonly rSquared: number;
  readonly scenarioReturnChangePerPeriod: number | null;
  readonly scenarioContributionsPerPeriod: readonly number[] | null;
}

export interface FactorPortfolioEstimate {
  readonly allocation: PortfolioAllocation;
  readonly factorExposures: readonly number[];
  readonly meanReturnContributionsPerPeriod: readonly number[];
  readonly factorVarianceContributionsPerPeriod: readonly number[];
  readonly factorVolatilityContributionsPerPeriod: readonly number[];
  readonly idiosyncraticVariancePerPeriod: number;
  readonly idiosyncraticVolatilityContributionPerPeriod: number;
  readonly scenarioReturnChangePerPeriod: number | null;
}

export interface FactorModelResult {
  readonly contract: typeof FACTOR_MODEL_RESULT_CONTRACT;
  readonly observationCount: number;
  readonly returnConvention: "arithmetic-simple-per-period";
  readonly factorIds: readonly string[];
  readonly factorMeansPerPeriod: readonly number[];
  readonly factorCovariancePerPeriod: NumericMatrix;
  readonly assets: readonly FactorAssetEstimate[];
  readonly modeledAssetCovariancePerPeriod: NumericMatrix;
  readonly portfolio: FactorPortfolioEstimate | null;
  readonly scenarioLabel: string | null;
}

/**
 * Aligns two independently validated datasets at equal timestamp instants.
 * `factorReturns.assetIds` are interpreted as data-defined factor identifiers.
 */
export interface FactorDatasetAlignmentRequest {
  readonly contract: typeof FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT;
  readonly assetReturns: ReturnDataset;
  readonly factorReturns: ReturnDataset;
  /** Defaults to every asset, preserving the source dataset's column order. */
  readonly assetIds?: readonly string[];
  /** Defaults to every factor, preserving the source dataset's column order. */
  readonly factorIds?: readonly string[];
}

export interface AlignedFactorDataset {
  readonly contract: typeof ALIGNED_FACTOR_DATASET_CONTRACT;
  readonly assetIds: readonly string[];
  readonly factorIds: readonly string[];
  readonly timestamps: readonly string[];
  readonly frequency: ObservationFrequency;
  readonly returnConvention: "simple";
  readonly assetReturnsPerPeriod: NumericMatrix;
  readonly factorReturnsPerPeriod: NumericMatrix;
  readonly alignment: {
    readonly policy: "timestamp-intersection";
    readonly assetSourceRowIndexes: readonly number[];
    readonly factorSourceRowIndexes: readonly number[];
    readonly droppedAssetObservationCount: number;
    readonly droppedFactorObservationCount: number;
  };
  readonly provenance: {
    readonly assetSource: ReturnDataset["provenance"];
    readonly factorSource: ReturnDataset["provenance"];
  };
}

export interface RollingFactorAnalysisRequest {
  readonly contract: typeof ROLLING_FACTOR_REQUEST_CONTRACT;
  readonly dataset: AlignedFactorDataset;
  /** Number of observations fitted strictly before each test window. */
  readonly estimationWindowObservations: number;
  /** Number of subsequent observations attributed out of sample. Defaults to one. */
  readonly testWindowObservations?: number;
  /** Distance between consecutive test-window starts. Defaults to testWindowObservations. */
  readonly stepObservations?: number;
  readonly portfolioWeights?: readonly number[];
  readonly scenario?: FactorScenario;
}

export interface RollingObservationRange {
  /** Zero-based indexes into the aligned dataset; both endpoints are inclusive. */
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string;
  readonly observationCount: number;
}

export interface RollingReturnAttribution {
  readonly realizedMeanReturnPerPeriod: number;
  readonly interceptContributionPerPeriod: number;
  readonly factorContributionsPerPeriod: readonly number[];
  readonly modeledMeanReturnPerPeriod: number;
  /** Additive unexplained test return: realized minus intercept and factor terms. */
  readonly residualContributionPerPeriod: number;
}

export interface RollingFactorAssetEstimate {
  readonly assetId: string;
  readonly interceptPerPeriod: number;
  readonly exposures: readonly number[];
  readonly estimationRSquared: number;
  readonly returnAttribution: RollingReturnAttribution;
  /** Risk attribution is estimated only from the preceding estimation window. */
  readonly riskAttribution: FactorRiskAttribution;
  readonly scenarioReturnChangePerPeriod: number | null;
  readonly scenarioContributionsPerPeriod: readonly number[] | null;
}

export interface RollingFactorPortfolioEstimate {
  readonly weights: readonly number[];
  readonly interceptPerPeriod: number;
  readonly exposures: readonly number[];
  readonly returnAttribution: RollingReturnAttribution;
  readonly riskAttribution: FactorRiskAttribution;
  readonly scenarioReturnChangePerPeriod: number | null;
  readonly scenarioContributionsPerPeriod: readonly number[] | null;
}

export interface RollingFactorWindow {
  readonly windowIndex: number;
  readonly estimation: RollingObservationRange;
  readonly test: RollingObservationRange;
  readonly estimationFactorMeansPerPeriod: readonly number[];
  readonly testFactorMeansPerPeriod: readonly number[];
  readonly estimationFactorCovariancePerPeriod: NumericMatrix;
  readonly assets: readonly RollingFactorAssetEstimate[];
  readonly portfolio: RollingFactorPortfolioEstimate | null;
}

export interface RollingFactorAnalysisResult {
  readonly contract: typeof ROLLING_FACTOR_RESULT_CONTRACT;
  readonly assetIds: readonly string[];
  readonly factorIds: readonly string[];
  readonly alignedObservationCount: number;
  readonly frequency: ObservationFrequency;
  readonly returnConvention: "arithmetic-simple-per-period";
  readonly scenarioLabel: string | null;
  readonly lookAheadGuard: "estimation-end-strictly-before-test-start";
  readonly windows: readonly RollingFactorWindow[];
  readonly dataProvenance: AlignedFactorDataset["provenance"];
}

export interface RiskParityRequest {
  readonly contract: typeof RISK_PARITY_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  readonly expectedReturnsPerPeriod: readonly number[];
  readonly covariancePerPeriod: NumericMatrix;
  /** Positive relative budgets; they are normalized to sum to one. */
  readonly riskBudgets?: readonly number[];
  readonly riskFreeRatePerPeriod?: number;
  readonly solver?: ConstructionSolverOptions;
}

export interface RiskParityResult {
  readonly contract: typeof RISK_PARITY_RESULT_CONTRACT;
  readonly method: "equal-risk-contribution-coordinate-descent";
  readonly requestedRiskBudgets: readonly number[];
  readonly achievedRiskBudgets: readonly number[];
  readonly allocation: PortfolioAllocation;
  readonly diagnostics: SolverDiagnostics;
}

export interface KellyRequest {
  readonly contract: typeof KELLY_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  /** Arithmetic expected returns above cash for one period. */
  readonly expectedExcessReturnsPerPeriod: readonly number[];
  readonly covariancePerPeriod: NumericMatrix;
  /** 1 is full Kelly, 0.5 is half Kelly, and 0.25 is quarter Kelly. */
  readonly kellyFraction: number;
  /** Required gross allocation/leverage ceiling. May exceed one. */
  readonly maxTotalAllocation: number;
  /** Required per-asset allocation ceilings. */
  readonly maxAssetAllocations: readonly number[];
  /** Wealth level used by the illustrative infinite-horizon ruin approximation. */
  readonly ruinFloorWealthFraction?: number;
  /** Fraction below initial capital used for the finite-horizon drawdown lesson. */
  readonly drawdownThresholdFraction?: number;
  readonly drawdownHorizonPeriods?: number;
  readonly solver?: ConstructionSolverOptions;
}

export interface KellyAllocation {
  readonly kellyFraction: number;
  readonly assetIds: readonly string[];
  readonly allocations: readonly number[];
  readonly totalAllocation: number;
  readonly cashWeight: number;
  readonly expectedExcessReturnPerPeriod: number;
  readonly variancePerPeriod: number;
  readonly volatilityPerPeriod: number;
  readonly approximateLogGrowthPerPeriod: number;
  readonly normalLossProbabilityPerPeriod: number;
  /** Probability wealth crosses the threshold below initial capital, not peak drawdown. */
  readonly approximateInitialCapitalDrawdownProbability: number;
  readonly approximateInfiniteHorizonRuinProbability: number;
  readonly volatilityContributions: readonly number[];
  readonly normalizedRiskContributions: readonly number[];
  readonly diagnostics: SolverDiagnostics;
}

export interface KellyResult {
  readonly contract: typeof KELLY_RESULT_CONTRACT;
  readonly approximation: "continuous-return-second-order-log-growth";
  readonly ruinFloorWealthFraction: number;
  readonly drawdownThresholdFraction: number;
  readonly drawdownHorizonPeriods: number;
  readonly requested: KellyAllocation;
  readonly fullHalfQuarter: readonly KellyAllocation[];
}

export interface BinaryKellyBet {
  readonly winProbability: number;
  /** Net profit per unit staked after the original stake is returned. */
  readonly netProfitOnWin: number;
  /** Capital lost per unit staked. One means the whole stake is lost. */
  readonly lossOnLoss?: number;
  readonly kellyFraction?: number;
  readonly maxStakeFraction?: number;
}

export interface BinaryKellySolution {
  readonly unconstrainedFullKellyFraction: number;
  readonly fullKellyStakeFraction: number;
  readonly requestedStakeFraction: number;
  readonly expectedLogGrowthPerBet: number;
}

export type BlackLittermanView =
  | {
      readonly id: string;
      readonly kind: "absolute";
      readonly assetId: string;
      readonly expectedReturnPerPeriod: number;
      readonly confidence: number;
    }
  | {
      readonly id: string;
      readonly kind: "relative";
      readonly outperformingAssetId: string;
      readonly underperformingAssetId: string;
      readonly expectedOutperformancePerPeriod: number;
      readonly confidence: number;
    };

export interface BlackLittermanRequest {
  readonly contract: typeof BLACK_LITTERMAN_REQUEST_CONTRACT;
  readonly assetIds: readonly string[];
  readonly covariancePerPeriod: NumericMatrix;
  readonly marketWeights: readonly number[];
  readonly riskAversion: number;
  readonly tau: number;
  readonly views: readonly BlackLittermanView[];
  readonly riskFreeRatePerPeriod?: number;
  readonly solver?: ConstructionSolverOptions;
}

export interface BlackLittermanViewResult {
  readonly id: string;
  readonly kind: "absolute" | "relative";
  readonly confidence: number;
  readonly requestedValuePerPeriod: number;
  readonly priorValuePerPeriod: number;
  readonly posteriorValuePerPeriod: number;
  readonly innovationPerPeriod: number;
  /** This view's additive contribution to every posterior asset return. */
  readonly assetReturnContributionsPerPeriod: readonly number[];
}

export interface BlackLittermanResult {
  readonly contract: typeof BLACK_LITTERMAN_RESULT_CONTRACT;
  readonly marketWeights: readonly number[];
  readonly equilibriumReturnsPerPeriod: readonly number[];
  readonly posteriorReturnsPerPeriod: readonly number[];
  readonly posteriorMeanCovariancePerPeriod: NumericMatrix;
  readonly posteriorPredictiveCovariancePerPeriod: NumericMatrix;
  readonly views: readonly BlackLittermanViewResult[];
  readonly marketAllocation: PortfolioAllocation;
  readonly priorOptimalAllocation: PortfolioAllocation;
  readonly posteriorOptimalAllocation: PortfolioAllocation;
}

export type PortfolioConstructionRequest =
  | MeanVarianceRequest
  | CapmRequest
  | FactorModelRequest
  | RollingFactorAnalysisRequest
  | RiskParityRequest
  | KellyRequest
  | BlackLittermanRequest;

export type PortfolioConstructionEnvelope =
  | ModelEnvelope<MeanVarianceResult>
  | ModelEnvelope<CapmResult>
  | ModelEnvelope<FactorModelResult>
  | ModelEnvelope<RollingFactorAnalysisResult>
  | ModelEnvelope<RiskParityResult>
  | ModelEnvelope<KellyResult>
  | ModelEnvelope<BlackLittermanResult>;

export function runPortfolioConstruction(
  request: PortfolioConstructionRequest,
): PortfolioConstructionEnvelope {
  switch (request.contract) {
    case MEAN_VARIANCE_REQUEST_CONTRACT:
      return runMeanVariance(request);
    case CAPM_REQUEST_CONTRACT:
      return runCapm(request);
    case FACTOR_MODEL_REQUEST_CONTRACT:
      return runFactorModel(request);
    case ROLLING_FACTOR_REQUEST_CONTRACT:
      return runRollingFactorAnalysis(request);
    case RISK_PARITY_REQUEST_CONTRACT:
      return runRiskParity(request);
    case KELLY_REQUEST_CONTRACT:
      return runKelly(request);
    case BLACK_LITTERMAN_REQUEST_CONTRACT:
      return runBlackLitterman(request);
    default:
      throw new QuantError(
        "INVALID_INPUT",
        "Unsupported portfolio-construction request contract.",
        "contract",
      );
  }
}

export function runMeanVariance(
  request: MeanVarianceRequest,
): ModelEnvelope<MeanVarianceResult> {
  assertContract(request.contract, MEAN_VARIANCE_REQUEST_CONTRACT);
  validateAssetInputs(
    request.assetIds,
    request.expectedReturnsPerPeriod,
    request.covariancePerPeriod,
    "expectedReturnsPerPeriod",
  );
  const warnings = validateCovariance(request.covariancePerPeriod);
  const riskFreeRate = request.riskFreeRatePerPeriod ?? 0;
  assertFinite(riskFreeRate, "riskFreeRatePerPeriod");
  const frontierPointCount = request.frontierPointCount ?? 21;
  assertIntegerInRange(frontierPointCount, 2, 101, "frontierPointCount");
  const options = validateSolverOptions(request.solver);
  const solverMatrix = prepareSolverCovariance(
    request.covariancePerPeriod,
    warnings,
  );

  const minimum = solveLongOnlyMinimumVariance(
    solverMatrix.matrix,
    options,
  );
  const minimumAllocation = summarizeAllocation(
    request.assetIds,
    minimum.weights,
    request.expectedReturnsPerPeriod,
    request.covariancePerPeriod,
    riskFreeRate,
  );
  const frontier = buildEfficientFrontier(
    request,
    solverMatrix.matrix,
    minimumAllocation,
    frontierPointCount,
    options,
    solverMatrix.ridge,
    warnings,
  );
  const maximum = solveMaximumSharpe(
    request,
    solverMatrix.matrix,
    frontier,
    options,
  );
  const maximumAllocation = summarizeAllocation(
    request.assetIds,
    maximum.weights,
    request.expectedReturnsPerPeriod,
    request.covariancePerPeriod,
    riskFreeRate,
  );

  if (
    hasBoundaryWeight(minimum.weights, options.tolerance) ||
    hasBoundaryWeight(maximum.weights, options.tolerance)
  ) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "At least one optimum lies on the long-only boundary; a zero weight is an active constraint, not a missing calculation.",
    });
  }
  if (!request.expectedReturnsPerPeriod.some((value) => value > riskFreeRate)) {
    warnings.push({
      code: "ASSUMPTION",
      message:
        "No asset has a positive expected excess return. Maximum Sharpe is selected from frontier and single-asset candidates and should be interpreted cautiously.",
    });
  }
  if (maximumAllocation.sharpeRatio === null) {
    warnings.push(zeroVolatilityWarning());
  }
  if (
    !minimum.converged ||
    !maximum.converged ||
    frontier.some((point) => !point.diagnostics.converged)
  ) {
    warnings.push({
      code: "PRECISION",
      message:
        "At least one mean-variance optimization reached its iteration limit before satisfying the requested tolerance.",
    });
  }

  return envelope(request.contract, MEAN_VARIANCE_RESULT_CONTRACT, {
    contract: MEAN_VARIANCE_RESULT_CONTRACT,
    constraints: { longOnly: true, fullyInvested: true },
    minimumVariance: minimumAllocation,
    maximumSharpe: maximumAllocation,
    efficientFrontier: frontier,
    capitalMarketLine:
      request.riskFreeRatePerPeriod === undefined ||
      maximumAllocation.sharpeRatio === null
        ? null
        : {
            interceptPerPeriod: riskFreeRate,
            slope: maximumAllocation.sharpeRatio,
          },
    diagnostics: {
      minimumVariance: solverDiagnostics(
        minimum,
        solverMatrix.ridge,
      ),
      maximumSharpe: solverDiagnostics(maximum, solverMatrix.ridge),
    },
  }, warnings);
}

export function runCapm(request: CapmRequest): ModelEnvelope<CapmResult> {
  assertContract(request.contract, CAPM_REQUEST_CONTRACT);
  validateIdentifiers(request.assetIds, "assetIds", MAX_ASSETS);
  const columnCount = validateObservationMatrix(
    request.assetReturnsPerPeriod,
    "assetReturnsPerPeriod",
  );
  if (columnCount !== request.assetIds.length) {
    throw dimensionError(
      "assetReturnsPerPeriod columns must match assetIds.",
      "assetReturnsPerPeriod",
    );
  }
  validateVector(
    request.marketReturnsPerPeriod,
    "marketReturnsPerPeriod",
  );
  if (request.marketReturnsPerPeriod.length !== request.assetReturnsPerPeriod.length) {
    throw dimensionError(
      "Market and asset return series must have the same observation count.",
      "marketReturnsPerPeriod",
    );
  }
  if (request.marketReturnsPerPeriod.length < 3) {
    throw new QuantError(
      "INVALID_INPUT",
      "CAPM regression needs at least three aligned observations.",
      "marketReturnsPerPeriod",
    );
  }
  assertFinite(request.riskFreeRatePerPeriod, "riskFreeRatePerPeriod");
  const weights = request.portfolioWeights
    ? validateFullyInvestedWeights(
        request.portfolioWeights,
        request.assetIds.length,
        "portfolioWeights",
      )
    : null;

  const marketMean = mean(request.marketReturnsPerPeriod);
  const marketExcess = request.marketReturnsPerPeriod.map(
    (value) => value - request.riskFreeRatePerPeriod,
  );
  const marketVariance = sampleVarianceFromMean(
    marketExcess,
    mean(marketExcess),
  );
  if (marketVariance <= NUMERICAL_EPSILON) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "CAPM beta is undefined because the market return variance is zero.",
      "marketReturnsPerPeriod",
    );
  }
  const assetColumns = transpose(request.assetReturnsPerPeriod);
  const estimates = assetColumns.map((returns, assetIndex) =>
    estimateCapmAsset(
      request.assetIds[assetIndex],
      returns,
      marketExcess,
      marketMean,
      marketVariance,
      request.riskFreeRatePerPeriod,
    ),
  );
  const marketRiskPremium = marketMean - request.riskFreeRatePerPeriod;
  const portfolio = weights
    ? {
        weights,
        beta: dot(weights, estimates.map((item) => item.beta)),
        alphaPerPeriod: dot(
          weights,
          estimates.map((item) => item.alphaPerPeriod),
        ),
        expectedReturnFromSecurityMarketLinePerPeriod: dot(
          weights,
          estimates.map(
            (item) => item.expectedReturnFromSecurityMarketLinePerPeriod,
          ),
        ),
        realizedMeanReturnPerPeriod: dot(
          weights,
          estimates.map((item) => item.realizedMeanReturnPerPeriod),
        ),
      }
    : null;

  return envelope(request.contract, CAPM_RESULT_CONTRACT, {
    contract: CAPM_RESULT_CONTRACT,
    observationCount: request.marketReturnsPerPeriod.length,
    returnConvention: "arithmetic-simple-per-period",
    securityMarketLine: {
      interceptPerPeriod: request.riskFreeRatePerPeriod,
      slopePerPeriod: marketRiskPremium,
    },
    market: {
      meanReturnPerPeriod: marketMean,
      variancePerPeriod: marketVariance,
      riskPremiumPerPeriod: marketRiskPremium,
    },
    assets: estimates,
    portfolio,
  }, [{
    code: "ASSUMPTION",
    message:
      "CAPM is a single-factor linear estimate from the supplied sample; beta and alpha are descriptive, not forecasts.",
  }]);
}

export function runFactorModel(
  request: FactorModelRequest,
): ModelEnvelope<FactorModelResult> {
  assertContract(request.contract, FACTOR_MODEL_REQUEST_CONTRACT);
  validateIdentifiers(request.assetIds, "assetIds", MAX_ASSETS);
  validateIdentifiers(request.factorIds, "factorIds", MAX_FACTORS);
  const assetColumns = validateObservationMatrix(
    request.assetReturnsPerPeriod,
    "assetReturnsPerPeriod",
  );
  const factorColumns = validateObservationMatrix(
    request.factorReturnsPerPeriod,
    "factorReturnsPerPeriod",
  );
  if (assetColumns !== request.assetIds.length) {
    throw dimensionError(
      "assetReturnsPerPeriod columns must match assetIds.",
      "assetReturnsPerPeriod",
    );
  }
  if (factorColumns !== request.factorIds.length) {
    throw dimensionError(
      "factorReturnsPerPeriod columns must match factorIds.",
      "factorReturnsPerPeriod",
    );
  }
  const observationCount = request.assetReturnsPerPeriod.length;
  if (observationCount !== request.factorReturnsPerPeriod.length) {
    throw dimensionError(
      "Asset and factor matrices must have aligned observation rows.",
      "factorReturnsPerPeriod",
    );
  }
  if (observationCount < request.factorIds.length + 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor regression needs at least factorCount + 2 observations.",
      "factorReturnsPerPeriod",
    );
  }
  const weights = request.portfolioWeights
    ? validateFullyInvestedWeights(
        request.portfolioWeights,
        request.assetIds.length,
        "portfolioWeights",
      )
    : null;
  const scenarioShocks = request.scenario
    ? validateScenario(request.scenario, request.factorIds.length)
    : null;

  const factorMeans = transpose(request.factorReturnsPerPeriod).map(mean);
  const factorCovariance = covarianceMatrix(request.factorReturnsPerPeriod);
  const design = request.factorReturnsPerPeriod.map((row) => [1, ...row]);
  const assetSeries = transpose(request.assetReturnsPerPeriod);
  const regressions = assetSeries.map((returns) =>
    fitLinearRegression(design, returns),
  );
  const assets = regressions.map((regression, assetIndex) => {
    const exposures = regression.coefficients.slice(1);
    const meanContributions = exposures.map(
      (exposure, factorIndex) => exposure * factorMeans[factorIndex],
    );
    const scenarioContributions = scenarioShocks
      ? exposures.map(
          (exposure, factorIndex) => exposure * scenarioShocks[factorIndex],
        )
      : null;
    return {
      assetId: request.assetIds[assetIndex],
      interceptPerPeriod: regression.coefficients[0],
      exposures,
      realizedMeanReturnPerPeriod: mean(assetSeries[assetIndex]),
      modeledMeanReturnPerPeriod:
        regression.coefficients[0] + sum(meanContributions),
      meanReturnContributionsPerPeriod: meanContributions,
      residualVolatilityPerPeriod: Math.sqrt(regression.residualVariance),
      riskAttribution: buildFactorRiskAttribution(
        exposures,
        factorCovariance,
        regression.residualVariance,
      ),
      rSquared: regression.rSquared,
      scenarioReturnChangePerPeriod: scenarioContributions
        ? sum(scenarioContributions)
        : null,
      scenarioContributionsPerPeriod: scenarioContributions,
    } satisfies FactorAssetEstimate;
  });
  const modeledCovariance = buildFactorAssetCovariance(
    regressions.map((regression) => regression.coefficients.slice(1)),
    factorCovariance,
    regressions.map((regression) => regression.residualVariance),
  );
  const portfolio = weights
    ? buildFactorPortfolio(
        request,
        weights,
        factorMeans,
        factorCovariance,
        regressions,
        modeledCovariance,
        scenarioShocks,
      )
    : null;
  const warnings: ModelWarning[] = [{
    code: "CALIBRATION",
    message:
      "Factor exposures are in-sample ordinary least-squares estimates. A forecasting workflow must fit only on information available at that time.",
  }];
  warnings.push({
    code: "ASSUMPTION",
    message:
      "Modeled asset covariance assumes residual returns are uncorrelated across assets; common covariance is carried by the supplied factors.",
  });
  if (observationCount < 5 * (request.factorIds.length + 1)) {
    warnings.push({
      code: "PRECISION",
      message:
        "The sample is small relative to the number of fitted coefficients; exposures may be unstable.",
    });
  }

  return envelope(request.contract, FACTOR_MODEL_RESULT_CONTRACT, {
    contract: FACTOR_MODEL_RESULT_CONTRACT,
    observationCount,
    returnConvention: "arithmetic-simple-per-period",
    factorIds: [...request.factorIds],
    factorMeansPerPeriod: factorMeans,
    factorCovariancePerPeriod: factorCovariance,
    assets,
    modeledAssetCovariancePerPeriod: modeledCovariance,
    portfolio,
    scenarioLabel: request.scenario?.label ?? null,
  }, warnings);
}

export function alignFactorDatasets(
  request: FactorDatasetAlignmentRequest,
): AlignedFactorDataset {
  assertContract(
    request.contract,
    FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
  );
  validateReturnDataset(request.assetReturns);
  validateReturnDataset(request.factorReturns);
  validateObservationMatrix(request.assetReturns.rows, "assetReturns.rows");
  validateObservationMatrix(request.factorReturns.rows, "factorReturns.rows");
  validateDatasetPolicies(request.assetReturns, "assetReturns");
  validateDatasetPolicies(request.factorReturns, "factorReturns");
  if (request.assetReturns.frequency !== request.factorReturns.frequency) {
    throw new QuantError(
      "INVALID_INPUT",
      "Asset and factor datasets must use the same observation frequency.",
      "factorReturns.frequency",
    );
  }
  if (
    request.assetReturns.returnConvention !== "simple" ||
    request.factorReturns.returnConvention !== "simple"
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor analysis requires arithmetic simple returns in both datasets.",
      "factorReturns.returnConvention",
    );
  }

  const assetSelection = selectDatasetColumns(
    request.assetReturns.assetIds,
    request.assetIds,
    "assetIds",
    MAX_ASSETS,
  );
  const factorSelection = selectDatasetColumns(
    request.factorReturns.assetIds,
    request.factorIds,
    "factorIds",
    MAX_FACTORS,
  );
  const factorRowByTimestamp = new Map(
    request.factorReturns.timestamps.map((timestamp, index) => [timestamp, index]),
  );
  const assetSourceRowIndexes: number[] = [];
  const factorSourceRowIndexes: number[] = [];
  const timestamps: string[] = [];
  request.assetReturns.timestamps.forEach((timestamp, assetRowIndex) => {
    const factorRowIndex = factorRowByTimestamp.get(timestamp);
    if (factorRowIndex === undefined) return;
    timestamps.push(timestamp);
    assetSourceRowIndexes.push(assetRowIndex);
    factorSourceRowIndexes.push(factorRowIndex);
  });
  if (timestamps.length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "Asset and factor datasets need at least two exactly matching timestamps.",
      "factorReturns.timestamps",
    );
  }

  return {
    contract: ALIGNED_FACTOR_DATASET_CONTRACT,
    assetIds: assetSelection.ids,
    factorIds: factorSelection.ids,
    timestamps,
    frequency: request.assetReturns.frequency,
    returnConvention: "simple",
    assetReturnsPerPeriod: assetSourceRowIndexes.map((rowIndex) =>
      assetSelection.indexes.map(
        (columnIndex) => request.assetReturns.rows[rowIndex][columnIndex],
      ),
    ),
    factorReturnsPerPeriod: factorSourceRowIndexes.map((rowIndex) =>
      factorSelection.indexes.map(
        (columnIndex) => request.factorReturns.rows[rowIndex][columnIndex],
      ),
    ),
    alignment: {
      policy: "timestamp-intersection",
      assetSourceRowIndexes,
      factorSourceRowIndexes,
      droppedAssetObservationCount:
        request.assetReturns.rows.length - timestamps.length,
      droppedFactorObservationCount:
        request.factorReturns.rows.length - timestamps.length,
    },
    provenance: {
      assetSource: { ...request.assetReturns.provenance },
      factorSource: { ...request.factorReturns.provenance },
    },
  };
}

export function runRollingFactorAnalysis(
  request: RollingFactorAnalysisRequest,
): ModelEnvelope<RollingFactorAnalysisResult> {
  assertContract(request.contract, ROLLING_FACTOR_REQUEST_CONTRACT);
  validateAlignedFactorDataset(request.dataset);
  const observationCount = request.dataset.timestamps.length;
  const minimumEstimationCount = request.dataset.factorIds.length + 2;
  assertIntegerInRange(
    request.estimationWindowObservations,
    minimumEstimationCount,
    observationCount - 1,
    "estimationWindowObservations",
  );
  const testWindowObservations = request.testWindowObservations ?? 1;
  assertIntegerInRange(
    testWindowObservations,
    1,
    observationCount - request.estimationWindowObservations,
    "testWindowObservations",
  );
  const stepObservations = request.stepObservations ?? testWindowObservations;
  assertIntegerInRange(
    stepObservations,
    1,
    observationCount,
    "stepObservations",
  );
  const weights = request.portfolioWeights
    ? validateFullyInvestedWeights(
        request.portfolioWeights,
        request.dataset.assetIds.length,
        "portfolioWeights",
      )
    : null;
  const scenarioShocks = request.scenario
    ? validateScenario(request.scenario, request.dataset.factorIds.length)
    : null;
  const availableTestStarts =
    observationCount -
    request.estimationWindowObservations -
    testWindowObservations;
  const windowCount = Math.floor(availableTestStarts / stepObservations) + 1;
  if (windowCount > MAX_ROLLING_WINDOWS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `Rolling analysis cannot exceed ${MAX_ROLLING_WINDOWS} windows; increase stepObservations or shorten the dataset.`,
      "stepObservations",
    );
  }

  const windows: RollingFactorWindow[] = [];
  for (
    let testStartIndex = request.estimationWindowObservations;
    testStartIndex + testWindowObservations <= observationCount;
    testStartIndex += stepObservations
  ) {
    const estimationStartIndex =
      testStartIndex - request.estimationWindowObservations;
    const estimationEndIndex = testStartIndex - 1;
    const testEndIndex = testStartIndex + testWindowObservations - 1;
    const estimationAssets = request.dataset.assetReturnsPerPeriod.slice(
      estimationStartIndex,
      testStartIndex,
    );
    const estimationFactors = request.dataset.factorReturnsPerPeriod.slice(
      estimationStartIndex,
      testStartIndex,
    );
    const testAssets = request.dataset.assetReturnsPerPeriod.slice(
      testStartIndex,
      testEndIndex + 1,
    );
    const testFactors = request.dataset.factorReturnsPerPeriod.slice(
      testStartIndex,
      testEndIndex + 1,
    );
    const fit = runFactorModel({
      contract: FACTOR_MODEL_REQUEST_CONTRACT,
      assetIds: request.dataset.assetIds,
      factorIds: request.dataset.factorIds,
      assetReturnsPerPeriod: estimationAssets,
      factorReturnsPerPeriod: estimationFactors,
      portfolioWeights: weights ?? undefined,
      scenario: request.scenario,
    }).result;
    const testFactorMeans = transpose(testFactors).map(mean);
    const testAssetMeans = transpose(testAssets).map(mean);
    const assets = fit.assets.map((asset, assetIndex) => {
      const returnAttribution = buildRollingReturnAttribution(
        testAssetMeans[assetIndex],
        asset.interceptPerPeriod,
        asset.exposures,
        testFactorMeans,
      );
      return {
        assetId: asset.assetId,
        interceptPerPeriod: asset.interceptPerPeriod,
        exposures: [...asset.exposures],
        estimationRSquared: asset.rSquared,
        returnAttribution,
        riskAttribution: buildFactorRiskAttribution(
          asset.exposures,
          fit.factorCovariancePerPeriod,
          asset.residualVolatilityPerPeriod ** 2,
        ),
        scenarioReturnChangePerPeriod: asset.scenarioReturnChangePerPeriod,
        scenarioContributionsPerPeriod:
          asset.scenarioContributionsPerPeriod === null
            ? null
            : [...asset.scenarioContributionsPerPeriod],
      } satisfies RollingFactorAssetEstimate;
    });
    const portfolio = weights && fit.portfolio
      ? buildRollingFactorPortfolio(
          weights,
          assets,
          testAssetMeans,
          fit.portfolio,
          fit.factorCovariancePerPeriod,
          testFactorMeans,
          scenarioShocks,
        )
      : null;
    windows.push({
      windowIndex: windows.length,
      estimation: observationRange(
        request.dataset.timestamps,
        estimationStartIndex,
        estimationEndIndex,
      ),
      test: observationRange(
        request.dataset.timestamps,
        testStartIndex,
        testEndIndex,
      ),
      estimationFactorMeansPerPeriod: [...fit.factorMeansPerPeriod],
      testFactorMeansPerPeriod: testFactorMeans,
      estimationFactorCovariancePerPeriod: fit.factorCovariancePerPeriod.map(
        (row) => [...row],
      ),
      assets,
      portfolio,
    });
  }

  const warnings: ModelWarning[] = [{
    code: "CALIBRATION",
    message:
      "Every rolling exposure is fitted only through estimation.endIndex; test.startIndex is strictly later, preventing look-ahead by construction.",
  }, {
    code: "ASSUMPTION",
    message:
      "Factor risk attribution uses estimation-window covariance and assumes asset residuals are mutually uncorrelated.",
  }];
  if (request.estimationWindowObservations < 5 * (request.dataset.factorIds.length + 1)) {
    warnings.push({
      code: "PRECISION",
      message:
        "The rolling estimation window is small relative to the number of coefficients, so exposure and risk estimates may be unstable.",
    });
  }
  if (testWindowObservations === 1) {
    warnings.push({
      code: "PRECISION",
      message:
        "Each out-of-sample return attribution uses one test observation; treat residual contribution as an observation, not a stable average.",
    });
  }

  return envelope(request.contract, ROLLING_FACTOR_RESULT_CONTRACT, {
    contract: ROLLING_FACTOR_RESULT_CONTRACT,
    assetIds: [...request.dataset.assetIds],
    factorIds: [...request.dataset.factorIds],
    alignedObservationCount: observationCount,
    frequency: request.dataset.frequency,
    returnConvention: "arithmetic-simple-per-period",
    scenarioLabel: request.scenario?.label ?? null,
    lookAheadGuard: "estimation-end-strictly-before-test-start",
    windows,
    dataProvenance: {
      assetSource: { ...request.dataset.provenance.assetSource },
      factorSource: { ...request.dataset.provenance.factorSource },
    },
  }, warnings);
}

export function runRiskParity(
  request: RiskParityRequest,
): ModelEnvelope<RiskParityResult> {
  assertContract(request.contract, RISK_PARITY_REQUEST_CONTRACT);
  validateAssetInputs(
    request.assetIds,
    request.expectedReturnsPerPeriod,
    request.covariancePerPeriod,
    "expectedReturnsPerPeriod",
  );
  const warnings = validateCovariance(request.covariancePerPeriod);
  const riskFreeRate = request.riskFreeRatePerPeriod ?? 0;
  assertFinite(riskFreeRate, "riskFreeRatePerPeriod");
  const options = validateSolverOptions(request.solver);
  const budgets = normalizePositiveBudgets(
    request.riskBudgets ?? request.assetIds.map(() => 1),
    request.assetIds.length,
  );
  request.covariancePerPeriod.forEach((row, index) => {
    if (row[index] <= NUMERICAL_EPSILON) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "Every positive risk budget needs an asset with positive variance.",
        `covariancePerPeriod.${index}.${index}`,
      );
    }
  });
  const solverMatrix = prepareSolverCovariance(
    request.covariancePerPeriod,
    warnings,
  );
  const solved = solveRiskBudgeting(
    solverMatrix.matrix,
    budgets,
    options,
  );
  const allocation = summarizeAllocation(
    request.assetIds,
    solved.weights,
    request.expectedReturnsPerPeriod,
    request.covariancePerPeriod,
    riskFreeRate,
  );
  const maximumBudgetError = maxAbsoluteDifference(
    allocation.normalizedRiskContributions,
    budgets,
  );
  if (!solved.converged) {
    warnings.push({
      code: "PRECISION",
      message:
        "Risk-parity iteration reached its limit before the requested risk-budget tolerance.",
    });
  }

  return envelope(request.contract, RISK_PARITY_RESULT_CONTRACT, {
    contract: RISK_PARITY_RESULT_CONTRACT,
    method: "equal-risk-contribution-coordinate-descent",
    requestedRiskBudgets: budgets,
    achievedRiskBudgets: allocation.normalizedRiskContributions,
    allocation,
    diagnostics: {
      converged: solved.converged,
      iterations: solved.iterations,
      maximumError: maximumBudgetError,
      covarianceRidge: solverMatrix.ridge,
    },
  }, warnings);
}

export function runKelly(request: KellyRequest): ModelEnvelope<KellyResult> {
  assertContract(request.contract, KELLY_REQUEST_CONTRACT);
  validateAssetInputs(
    request.assetIds,
    request.expectedExcessReturnsPerPeriod,
    request.covariancePerPeriod,
    "expectedExcessReturnsPerPeriod",
  );
  const warnings = validateCovariance(request.covariancePerPeriod);
  assertProbability(request.kellyFraction, "kellyFraction");
  assertPositive(request.maxTotalAllocation, "maxTotalAllocation");
  if (request.maxTotalAllocation > 10) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "maxTotalAllocation cannot exceed 10 in the educational solver.",
      "maxTotalAllocation",
    );
  }
  const caps = validateAllocationCaps(
    request.maxAssetAllocations,
    request.assetIds.length,
  );
  const ruinFloor = request.ruinFloorWealthFraction ?? 0.5;
  if (!Number.isFinite(ruinFloor) || ruinFloor <= 0 || ruinFloor >= 1) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "ruinFloorWealthFraction must be strictly between zero and one.",
      "ruinFloorWealthFraction",
    );
  }
  const drawdownThreshold = request.drawdownThresholdFraction ?? 0.2;
  if (
    !Number.isFinite(drawdownThreshold) ||
    drawdownThreshold <= 0 ||
    drawdownThreshold >= 1
  ) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "drawdownThresholdFraction must be strictly between zero and one.",
      "drawdownThresholdFraction",
    );
  }
  const drawdownHorizon = request.drawdownHorizonPeriods ?? 12;
  assertIntegerInRange(
    drawdownHorizon,
    1,
    1_000_000,
    "drawdownHorizonPeriods",
  );
  const options = validateSolverOptions(request.solver);
  const solverMatrix = prepareSolverCovariance(
    request.covariancePerPeriod,
    warnings,
  );
  const requested = solveKellyAllocation(
    request,
    request.kellyFraction,
    caps,
    ruinFloor,
    drawdownThreshold,
    drawdownHorizon,
    solverMatrix,
    options,
  );
  const fullHalfQuarter = [1, 0.5, 0.25].map((fraction) =>
    solveKellyAllocation(
      request,
      fraction,
      caps,
      ruinFloor,
      drawdownThreshold,
      drawdownHorizon,
      solverMatrix,
      options,
    ),
  );
  if (request.maxTotalAllocation > 1) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "The leverage cap permits borrowing. Negative cash weight represents leverage and can magnify losses.",
    });
  }
  if (
    requested.totalAllocation >= request.maxTotalAllocation - options.tolerance ||
    requested.allocations.some(
      (allocation, index) => allocation >= caps[index] - options.tolerance,
    )
  ) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "The requested Kelly allocation reaches at least one allocation cap; the capped answer differs from the unconstrained Kelly formula.",
    });
  }
  if (!requested.diagnostics.converged) {
    warnings.push({
      code: "PRECISION",
      message:
        "The requested Kelly optimization reached its iteration limit before satisfying the requested tolerance.",
    });
  }
  warnings.push({
    code: "ASSUMPTION",
    message:
      "Continuous Kelly uses a second-order log-growth approximation with stable expected returns and covariance. Loss, initial-capital drawdown, and ruin figures assume normal returns and continuous Brownian wealth; the drawdown barrier is measured from initial capital, not a later running peak.",
  });

  return envelope(request.contract, KELLY_RESULT_CONTRACT, {
    contract: KELLY_RESULT_CONTRACT,
    approximation: "continuous-return-second-order-log-growth",
    ruinFloorWealthFraction: ruinFloor,
    drawdownThresholdFraction: drawdownThreshold,
    drawdownHorizonPeriods: drawdownHorizon,
    requested,
    fullHalfQuarter,
  }, warnings);
}

/** Exact one-bet benchmark for learning and testing the Kelly formula. */
export function solveBinaryKellyBet(
  bet: BinaryKellyBet,
): BinaryKellySolution {
  assertProbability(bet.winProbability, "winProbability");
  assertPositive(bet.netProfitOnWin, "netProfitOnWin");
  const loss = bet.lossOnLoss ?? 1;
  assertPositive(loss, "lossOnLoss");
  const fraction = bet.kellyFraction ?? 1;
  assertProbability(fraction, "kellyFraction");
  const maximum = bet.maxStakeFraction ?? 1;
  assertNonNegative(maximum, "maxStakeFraction");
  const lossProbability = 1 - bet.winProbability;
  const unconstrained =
    (bet.winProbability * bet.netProfitOnWin - lossProbability * loss) /
    (loss * bet.netProfitOnWin);
  const solvencyCap = (1 - Number.EPSILON) / loss;
  const fullKelly = clamp(unconstrained, 0, Math.min(maximum, solvencyCap));
  const requested = clamp(
    unconstrained * fraction,
    0,
    Math.min(maximum, solvencyCap),
  );
  const expectedLogGrowth =
    bet.winProbability * Math.log1p(requested * bet.netProfitOnWin) +
    lossProbability * Math.log1p(-requested * loss);
  return {
    unconstrainedFullKellyFraction: unconstrained,
    fullKellyStakeFraction: fullKelly,
    requestedStakeFraction: requested,
    expectedLogGrowthPerBet: expectedLogGrowth,
  };
}

export function runBlackLitterman(
  request: BlackLittermanRequest,
): ModelEnvelope<BlackLittermanResult> {
  assertContract(request.contract, BLACK_LITTERMAN_REQUEST_CONTRACT);
  validateIdentifiers(request.assetIds, "assetIds", MAX_ASSETS);
  validateSquareCovariance(
    request.covariancePerPeriod,
    request.assetIds.length,
  );
  const warnings = validateCovariance(request.covariancePerPeriod);
  const marketWeights = validateFullyInvestedWeights(
    request.marketWeights,
    request.assetIds.length,
    "marketWeights",
  );
  assertPositive(request.riskAversion, "riskAversion");
  assertPositive(request.tau, "tau");
  if (request.views.length === 0 || request.views.length > 50) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Black-Litterman needs between one and 50 views.",
      "views",
    );
  }
  const riskFreeRate = request.riskFreeRatePerPeriod ?? 0;
  assertFinite(riskFreeRate, "riskFreeRatePerPeriod");
  const views = buildBlackLittermanViews(request, riskFreeRate);
  const priorExcess = matrixVectorMultiply(
    request.covariancePerPeriod,
    marketWeights,
  ).map((value) => request.riskAversion * value);
  const tauCovariance = scaleMatrix(request.covariancePerPeriod, request.tau);
  const viewPrior = matrixVectorMultiply(views.pickMatrix, priorExcess);
  const innovations = views.values.map(
    (value, index) => value - viewPrior[index],
  );
  const pickTranspose = transpose(views.pickMatrix);
  const priorTimesPick = matrixMultiply(tauCovariance, pickTranspose);
  const viewPriorCovariance = matrixMultiply(
    views.pickMatrix,
    priorTimesPick,
  );
  const omega = views.confidences.map((confidence, index) => {
    const baseVariance = Math.max(
      viewPriorCovariance[index][index],
      NUMERICAL_EPSILON,
    );
    return baseVariance * (1 - confidence) / confidence;
  });
  const viewSystem = viewPriorCovariance.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value + (rowIndex === columnIndex ? omega[rowIndex] : 0),
    ),
  );
  const inverseViewSystem = stableInverse(viewSystem, warnings);
  const gain = matrixMultiply(priorTimesPick, inverseViewSystem);
  const posteriorAdjustment = matrixVectorMultiply(gain, innovations);
  const posteriorExcess = priorExcess.map(
    (value, index) => value + posteriorAdjustment[index],
  );
  const meanUncertaintyReduction = matrixMultiply(
    gain,
    matrixMultiply(views.pickMatrix, tauCovariance),
  );
  const posteriorMeanCovariance = symmetrize(
    tauCovariance.map((row, rowIndex) =>
      row.map(
        (value, columnIndex) =>
          value - meanUncertaintyReduction[rowIndex][columnIndex],
      ),
    ),
  );
  const predictiveCovariance = addMatrices(
    request.covariancePerPeriod,
    posteriorMeanCovariance,
  );
  const equilibriumReturns = priorExcess.map((value) => value + riskFreeRate);
  const posteriorReturns = posteriorExcess.map((value) => value + riskFreeRate);
  const priorOptimization = runMeanVariance({
    contract: MEAN_VARIANCE_REQUEST_CONTRACT,
    assetIds: request.assetIds,
    expectedReturnsPerPeriod: equilibriumReturns,
    covariancePerPeriod: request.covariancePerPeriod,
    riskFreeRatePerPeriod: riskFreeRate,
    frontierPointCount: 2,
    solver: request.solver,
  });
  const posteriorOptimization = runMeanVariance({
    contract: MEAN_VARIANCE_REQUEST_CONTRACT,
    assetIds: request.assetIds,
    expectedReturnsPerPeriod: posteriorReturns,
    covariancePerPeriod: predictiveCovariance,
    riskFreeRatePerPeriod: riskFreeRate,
    frontierPointCount: 2,
    solver: request.solver,
  });
  mergeWarnings(warnings, priorOptimization.warnings, "Prior allocator: ");
  mergeWarnings(warnings, posteriorOptimization.warnings, "Posterior allocator: ");
  if (request.tau > 1) {
    warnings.push({
      code: "ASSUMPTION",
      message:
        "tau is above one, so uncertainty in the estimated equilibrium mean exceeds one period of return covariance.",
    });
  }
  if (views.confidences.some((confidence) => confidence === 1)) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "A confidence of one treats that view as exact; inconsistent exact views may require numerical regularization.",
    });
  }
  warnings.push({
    code: "ASSUMPTION",
    message:
      "View confidence is translated to diagonal view-error variance using the Idzorek-style ratio (1-confidence)/confidence.",
  });

  const viewResults = request.views.map((view, viewIndex) => {
    const absoluteOffset = view.kind === "absolute" ? riskFreeRate : 0;
    const contribution = gain.map(
      (row) => row[viewIndex] * innovations[viewIndex],
    );
    return {
      id: view.id,
      kind: view.kind,
      confidence: view.confidence,
      requestedValuePerPeriod: views.values[viewIndex] + absoluteOffset,
      priorValuePerPeriod: viewPrior[viewIndex] + absoluteOffset,
      posteriorValuePerPeriod:
        dot(views.pickMatrix[viewIndex], posteriorExcess) + absoluteOffset,
      innovationPerPeriod: innovations[viewIndex],
      assetReturnContributionsPerPeriod: contribution,
    } satisfies BlackLittermanViewResult;
  });

  return envelope(request.contract, BLACK_LITTERMAN_RESULT_CONTRACT, {
    contract: BLACK_LITTERMAN_RESULT_CONTRACT,
    marketWeights,
    equilibriumReturnsPerPeriod: equilibriumReturns,
    posteriorReturnsPerPeriod: posteriorReturns,
    posteriorMeanCovariancePerPeriod: posteriorMeanCovariance,
    posteriorPredictiveCovariancePerPeriod: predictiveCovariance,
    views: viewResults,
    marketAllocation: summarizeAllocation(
      request.assetIds,
      marketWeights,
      equilibriumReturns,
      request.covariancePerPeriod,
      riskFreeRate,
    ),
    priorOptimalAllocation: priorOptimization.result.maximumSharpe,
    posteriorOptimalAllocation: posteriorOptimization.result.maximumSharpe,
  }, warnings);
}

interface ValidatedSolverOptions {
  readonly tolerance: number;
  readonly maxIterations: number;
}

interface SolverOutcome {
  readonly weights: number[];
  readonly converged: boolean;
  readonly iterations: number;
  readonly maximumError: number;
}

interface PreparedCovariance {
  readonly matrix: number[][];
  readonly ridge: number;
}

function buildEfficientFrontier(
  request: MeanVarianceRequest,
  solverCovariance: NumericMatrix,
  minimumAllocation: PortfolioAllocation,
  pointCount: number,
  options: ValidatedSolverOptions,
  ridge: number,
  warnings: ModelWarning[],
): EfficientFrontierPoint[] {
  const maximumReturn = Math.max(...request.expectedReturnsPerPeriod);
  const minimumReturn = minimumAllocation.expectedReturnPerPeriod;
  if (maximumReturn - minimumReturn <= options.tolerance) {
    warnings.push({
      code: "ASSUMPTION",
      message:
        "All efficient portfolios have effectively the same expected return, so the frontier collapses to the minimum-variance portfolio.",
    });
    return [{
      targetReturnPerPeriod: minimumReturn,
      allocation: minimumAllocation,
      diagnostics: {
        converged: true,
        iterations: 0,
        maximumError: 0,
        covarianceRidge: ridge,
      },
    }];
  }
  return Array.from({ length: pointCount }, (_, index) => {
    if (index === 0) {
      return {
        targetReturnPerPeriod: minimumReturn,
        allocation: minimumAllocation,
        diagnostics: {
          converged: true,
          iterations: 0,
          maximumError: 0,
          covarianceRidge: ridge,
        },
      };
    }
    const target =
      minimumReturn +
      (maximumReturn - minimumReturn) * index / (pointCount - 1);
    const solved = solveLongOnlyTargetVariance(
      solverCovariance,
      request.expectedReturnsPerPeriod,
      target,
      options,
    );
    const allocation = summarizeAllocation(
      request.assetIds,
      solved.weights,
      request.expectedReturnsPerPeriod,
      request.covariancePerPeriod,
      request.riskFreeRatePerPeriod ?? 0,
    );
    return {
      targetReturnPerPeriod: target,
      allocation,
      diagnostics: solverDiagnostics(solved, ridge),
    };
  });
}

function solveLongOnlyMinimumVariance(
  covariance: NumericMatrix,
  options: ValidatedSolverOptions,
): SolverOutcome {
  const count = covariance.length;
  return solveLongOnlyEqualityQp(
    covariance,
    [Array(count).fill(1)],
    [1],
    Array(count).fill(1 / count),
    options,
  );
}

function solveLongOnlyTargetVariance(
  covariance: NumericMatrix,
  expectedReturns: readonly number[],
  target: number,
  options: ValidatedSolverOptions,
): SolverOutcome {
  const minimumReturn = Math.min(...expectedReturns);
  const maximumReturn = Math.max(...expectedReturns);
  if (target < minimumReturn - options.tolerance || target > maximumReturn + options.tolerance) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Frontier target is outside the attainable long-only return range.",
    );
  }
  const extremeIndexes = expectedReturns
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => Math.abs(value - target) <= options.tolerance)
    .map(({ index }) => index);
  const atEndpoint =
    Math.abs(target - minimumReturn) <= options.tolerance ||
    Math.abs(target - maximumReturn) <= options.tolerance;
  if (atEndpoint) {
    const submatrix = extremeIndexes.map((row) =>
      extremeIndexes.map((column) => covariance[row][column]),
    );
    const solved = solveLongOnlyMinimumVariance(submatrix, options);
    const weights = Array(expectedReturns.length).fill(0);
    extremeIndexes.forEach((assetIndex, index) => {
      weights[assetIndex] = solved.weights[index];
    });
    return { ...solved, weights };
  }
  const lower = expectedReturns
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value < target)
    .sort((left, right) => right.value - left.value)[0];
  const upper = expectedReturns
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value > target)
    .sort((left, right) => left.value - right.value)[0];
  if (!lower || !upper) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "Could not construct a feasible target-return portfolio.",
    );
  }
  const upperWeight = (target - lower.value) / (upper.value - lower.value);
  const initial = Array(expectedReturns.length).fill(0);
  initial[lower.index] = 1 - upperWeight;
  initial[upper.index] = upperWeight;
  return solveLongOnlyEqualityQp(
    covariance,
    [Array(expectedReturns.length).fill(1), [...expectedReturns]],
    [1, target],
    initial,
    options,
  );
}

function solveLongOnlyEqualityQp(
  covariance: NumericMatrix,
  constraints: NumericMatrix,
  targets: readonly number[],
  initialWeights: readonly number[],
  options: ValidatedSolverOptions,
): SolverOutcome {
  const weights = [...initialWeights];
  const active = new Set<number>();
  weights.forEach((weight, index) => {
    if (weight <= options.tolerance) active.add(index);
  });
  let maximumError = Number.POSITIVE_INFINITY;

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    const free = weights
      .map((_, index) => index)
      .filter((index) => !active.has(index));
    const gradient = matrixVectorMultiply(covariance, weights);
    const step = solveKktDirection(
      covariance,
      constraints,
      gradient,
      free,
    );
    maximumError = Math.max(...step.direction.map(Math.abs), 0);
    if (maximumError <= options.tolerance) {
      const release = mostViolatedActiveConstraint(
        active,
        gradient,
        constraints,
        step.multipliers,
        options.tolerance,
      );
      if (release === null) {
        return {
          weights: cleanWeights(weights),
          converged: true,
          iterations: iteration,
          maximumError,
        };
      }
      active.delete(release);
      continue;
    }
    let stepLength = 1;
    let blockingIndex: number | null = null;
    free.forEach((assetIndex, localIndex) => {
      const direction = step.direction[localIndex];
      if (direction < -options.tolerance) {
        const candidate = -weights[assetIndex] / direction;
        if (candidate < stepLength) {
          stepLength = candidate;
          blockingIndex = assetIndex;
        }
      }
    });
    free.forEach((assetIndex, localIndex) => {
      weights[assetIndex] += stepLength * step.direction[localIndex];
      if (Math.abs(weights[assetIndex]) <= options.tolerance) {
        weights[assetIndex] = 0;
      }
    });
    if (blockingIndex !== null && stepLength < 1 - options.tolerance) {
      weights[blockingIndex] = 0;
      active.add(blockingIndex);
    }
    const constraintError = maxConstraintError(weights, constraints, targets);
    if (constraintError > Math.sqrt(options.tolerance)) {
      throw new QuantError(
        "NUMERICAL_FAILURE",
        "The long-only optimizer lost feasibility.",
      );
    }
  }
  return {
    weights: cleanWeights(weights),
    converged: false,
    iterations: options.maxIterations,
    maximumError,
  };
}

function solveKktDirection(
  covariance: NumericMatrix,
  constraints: NumericMatrix,
  gradient: readonly number[],
  free: readonly number[],
): { direction: number[]; multipliers: number[] } {
  const constraintCount = constraints.length;
  const size = free.length + constraintCount;
  const kkt = Array.from({ length: size }, () => Array(size).fill(0));
  free.forEach((rowAsset, row) => {
    free.forEach((columnAsset, column) => {
      kkt[row][column] = covariance[rowAsset][columnAsset];
    });
    constraints.forEach((constraint, constraintIndex) => {
      kkt[row][free.length + constraintIndex] = constraint[rowAsset];
      kkt[free.length + constraintIndex][row] = constraint[rowAsset];
    });
  });
  const right = [
    ...free.map((assetIndex) => -gradient[assetIndex]),
    ...Array(constraintCount).fill(0),
  ];
  const solution = solveLinearSystem(kkt, right, 1e-14);
  return {
    direction: solution.slice(0, free.length),
    multipliers: solution.slice(free.length),
  };
}

function mostViolatedActiveConstraint(
  active: ReadonlySet<number>,
  gradient: readonly number[],
  constraints: NumericMatrix,
  multipliers: readonly number[],
  tolerance: number,
): number | null {
  let selected: number | null = null;
  let smallestMultiplier = -tolerance;
  active.forEach((assetIndex) => {
    const reducedGradient =
      gradient[assetIndex] +
      sum(
        constraints.map(
          (constraint, index) => constraint[assetIndex] * multipliers[index],
        ),
      );
    if (reducedGradient < smallestMultiplier) {
      smallestMultiplier = reducedGradient;
      selected = assetIndex;
    }
  });
  return selected;
}

function solveMaximumSharpe(
  request: MeanVarianceRequest,
  covariance: NumericMatrix,
  frontier: readonly EfficientFrontierPoint[],
  options: ValidatedSolverOptions,
): SolverOutcome {
  const riskFreeRate = request.riskFreeRatePerPeriod ?? 0;
  const excessReturns = request.expectedReturnsPerPeriod.map(
    (value) => value - riskFreeRate,
  );
  if (!excessReturns.some((value) => value > 0)) {
    const candidates = [
      ...frontier.map((point) => point.allocation.weights),
      ...request.assetIds.map((_, selected) =>
        request.assetIds.map((__, index) => Number(index === selected)),
      ),
    ];
    const best = candidates.reduce((current, candidate) => {
      const candidateRatio = finiteSharpeScore(
        candidate,
        excessReturns,
        request.covariancePerPeriod,
      );
      const currentRatio = finiteSharpeScore(
        current,
        excessReturns,
        request.covariancePerPeriod,
      );
      return candidateRatio > currentRatio ? candidate : current;
    });
    return { weights: [...best], converged: true, iterations: 0, maximumError: 0 };
  }

  const allocations = Array(excessReturns.length).fill(0);
  let maximumError = Number.POSITIVE_INFINITY;
  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    for (let asset = 0; asset < allocations.length; asset += 1) {
      const gradient =
        dot(covariance[asset], allocations) - excessReturns[asset];
      allocations[asset] = Math.max(
        0,
        allocations[asset] - gradient / covariance[asset][asset],
      );
    }
    const gradient = matrixVectorMultiply(covariance, allocations).map(
      (value, index) => value - excessReturns[index],
    );
    maximumError = Math.max(
      ...gradient.map((value, index) =>
        allocations[index] > options.tolerance
          ? Math.abs(value)
          : Math.max(0, -value),
      ),
    );
    if (maximumError <= options.tolerance) {
      return {
        weights: normalizeWeights(allocations),
        converged: true,
        iterations: iteration,
        maximumError,
      };
    }
  }
  return {
    weights: normalizeWeights(allocations),
    converged: false,
    iterations: options.maxIterations,
    maximumError,
  };
}

function solveRiskBudgeting(
  covariance: NumericMatrix,
  budgets: readonly number[],
  options: ValidatedSolverOptions,
): SolverOutcome {
  const scale = Math.sqrt(sum(budgets));
  const weights = budgets.map(
    (budget, index) => scale * Math.sqrt(budget / covariance[index][index]),
  );
  let maximumError = Number.POSITIVE_INFINITY;
  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    for (let asset = 0; asset < weights.length; asset += 1) {
      let crossTerm = 0;
      for (let other = 0; other < weights.length; other += 1) {
        if (other !== asset) {
          crossTerm += covariance[asset][other] * weights[other];
        }
      }
      const variance = covariance[asset][asset];
      weights[asset] =
        (-crossTerm +
          Math.sqrt(crossTerm * crossTerm + 4 * variance * budgets[asset])) /
        (2 * variance);
    }
    const normalized = normalizeWeights(weights);
    const achieved = normalizedRiskContributions(normalized, covariance);
    maximumError = maxAbsoluteDifference(achieved, budgets);
    if (maximumError <= options.tolerance) {
      return {
        weights: normalized,
        converged: true,
        iterations: iteration,
        maximumError,
      };
    }
  }
  return {
    weights: normalizeWeights(weights),
    converged: false,
    iterations: options.maxIterations,
    maximumError,
  };
}

function solveKellyAllocation(
  request: KellyRequest,
  fraction: number,
  caps: readonly number[],
  ruinFloor: number,
  drawdownThreshold: number,
  drawdownHorizon: number,
  solverMatrix: PreparedCovariance,
  options: ValidatedSolverOptions,
): KellyAllocation {
  const linearReturns = request.expectedExcessReturnsPerPeriod.map(
    (value) => fraction * value,
  );
  const allocations = Array(request.assetIds.length).fill(0);
  const rowNorm = Math.max(
    ...solverMatrix.matrix.map((row) => sum(row.map(Math.abs))),
    NUMERICAL_EPSILON,
  );
  const stepSize = 1 / rowNorm;
  let maximumError = Number.POSITIVE_INFINITY;
  let converged = false;
  let completedIterations = 0;
  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    completedIterations = iteration;
    const gradient = matrixVectorMultiply(
      solverMatrix.matrix,
      allocations,
    ).map((value, index) => value - linearReturns[index]);
    const candidate = projectCappedAllocation(
      allocations.map((value, index) => value - stepSize * gradient[index]),
      caps,
      request.maxTotalAllocation,
    );
    maximumError = maxAbsoluteDifference(candidate, allocations);
    candidate.forEach((value, index) => {
      allocations[index] = value;
    });
    if (maximumError <= options.tolerance) {
      converged = true;
      break;
    }
  }
  const variance = Math.max(
    0,
    dot(
      allocations,
      matrixVectorMultiply(request.covariancePerPeriod, allocations),
    ),
  );
  const volatility = Math.sqrt(variance);
  const expectedReturn = dot(
    allocations,
    request.expectedExcessReturnsPerPeriod,
  );
  const logGrowth = expectedReturn - 0.5 * variance;
  const risk = riskContributionDetails(allocations, request.covariancePerPeriod);
  const lossProbability =
    volatility <= NUMERICAL_EPSILON
      ? Number(expectedReturn < 0)
      : normalCdf(-expectedReturn / volatility);
  const ruinProbability = approximateRuinProbability(
    logGrowth,
    variance,
    ruinFloor,
  );
  const drawdownProbability = approximateInitialCapitalDrawdownProbability(
    logGrowth,
    variance,
    drawdownThreshold,
    drawdownHorizon,
  );
  return {
    kellyFraction: fraction,
    assetIds: [...request.assetIds],
    allocations,
    totalAllocation: sum(allocations),
    cashWeight: 1 - sum(allocations),
    expectedExcessReturnPerPeriod: expectedReturn,
    variancePerPeriod: variance,
    volatilityPerPeriod: volatility,
    approximateLogGrowthPerPeriod: logGrowth,
    normalLossProbabilityPerPeriod: lossProbability,
    approximateInitialCapitalDrawdownProbability: drawdownProbability,
    approximateInfiniteHorizonRuinProbability: ruinProbability,
    volatilityContributions: risk.total,
    normalizedRiskContributions: risk.normalized,
    diagnostics: {
      converged,
      iterations: completedIterations,
      maximumError,
      covarianceRidge: solverMatrix.ridge,
    },
  };
}

function buildRollingReturnAttribution(
  realizedMeanReturn: number,
  intercept: number,
  exposures: readonly number[],
  testFactorMeans: readonly number[],
): RollingReturnAttribution {
  const factorContributions = exposures.map(
    (exposure, factorIndex) => exposure * testFactorMeans[factorIndex],
  );
  const modeledMeanReturn = intercept + sum(factorContributions);
  return {
    realizedMeanReturnPerPeriod: realizedMeanReturn,
    interceptContributionPerPeriod: intercept,
    factorContributionsPerPeriod: factorContributions,
    modeledMeanReturnPerPeriod: modeledMeanReturn,
    residualContributionPerPeriod: realizedMeanReturn - modeledMeanReturn,
  };
}

function buildFactorRiskAttribution(
  exposures: readonly number[],
  factorCovariance: NumericMatrix,
  residualVariance: number,
): FactorRiskAttribution {
  const covarianceTimesExposure = matrixVectorMultiply(
    factorCovariance,
    exposures,
  );
  const factorVarianceContributions = exposures.map(
    (exposure, factorIndex) => exposure * covarianceTimesExposure[factorIndex],
  );
  const totalVariance = Math.max(
    0,
    sum(factorVarianceContributions) + residualVariance,
  );
  const totalVolatility = Math.sqrt(totalVariance);
  return {
    factorVarianceContributionsPerPeriod: factorVarianceContributions,
    factorVolatilityContributionsPerPeriod:
      totalVolatility <= NUMERICAL_EPSILON
        ? factorVarianceContributions.map(() => 0)
        : factorVarianceContributions.map((value) => value / totalVolatility),
    residualVariancePerPeriod: residualVariance,
    residualVolatilityContributionPerPeriod:
      totalVolatility <= NUMERICAL_EPSILON
        ? 0
        : residualVariance / totalVolatility,
    totalVariancePerPeriod: totalVariance,
    totalVolatilityPerPeriod: totalVolatility,
  };
}

function buildRollingFactorPortfolio(
  weights: readonly number[],
  assets: readonly RollingFactorAssetEstimate[],
  testAssetMeans: readonly number[],
  fittedPortfolio: FactorPortfolioEstimate,
  factorCovariance: NumericMatrix,
  testFactorMeans: readonly number[],
  scenarioShocks: readonly number[] | null,
): RollingFactorPortfolioEstimate {
  const intercept = dot(
    weights,
    assets.map((asset) => asset.interceptPerPeriod),
  );
  const exposures = [...fittedPortfolio.factorExposures];
  const scenarioContributions = scenarioShocks
    ? exposures.map(
        (exposure, factorIndex) => exposure * scenarioShocks[factorIndex],
      )
    : null;
  return {
    weights: [...weights],
    interceptPerPeriod: intercept,
    exposures,
    returnAttribution: buildRollingReturnAttribution(
      dot(weights, testAssetMeans),
      intercept,
      exposures,
      testFactorMeans,
    ),
    riskAttribution: buildFactorRiskAttribution(
      exposures,
      factorCovariance,
      fittedPortfolio.idiosyncraticVariancePerPeriod,
    ),
    scenarioReturnChangePerPeriod: scenarioContributions
      ? sum(scenarioContributions)
      : null,
    scenarioContributionsPerPeriod: scenarioContributions,
  };
}

function observationRange(
  timestamps: readonly string[],
  startIndex: number,
  endIndex: number,
): RollingObservationRange {
  return {
    startIndex,
    endIndex,
    startTimestamp: timestamps[startIndex],
    endTimestamp: timestamps[endIndex],
    observationCount: endIndex - startIndex + 1,
  };
}

function buildFactorPortfolio(
  request: FactorModelRequest,
  weights: readonly number[],
  factorMeans: readonly number[],
  factorCovariance: NumericMatrix,
  regressions: readonly LinearRegression[],
  modeledCovariance: NumericMatrix,
  scenarioShocks: readonly number[] | null,
): FactorPortfolioEstimate {
  const exposuresByAsset = regressions.map((regression) =>
    regression.coefficients.slice(1),
  );
  const portfolioExposures = transpose(exposuresByAsset).map((exposures) =>
    dot(weights, exposures),
  );
  const meanContributions = portfolioExposures.map(
    (exposure, index) => exposure * factorMeans[index],
  );
  const covarianceTimesExposure = matrixVectorMultiply(
    factorCovariance,
    portfolioExposures,
  );
  const factorVarianceContributions = portfolioExposures.map(
    (exposure, index) => exposure * covarianceTimesExposure[index],
  );
  const idiosyncraticVariance = sum(
    weights.map(
      (weight, index) => weight * weight * regressions[index].residualVariance,
    ),
  );
  const totalVariance = Math.max(
    0,
    sum(factorVarianceContributions) + idiosyncraticVariance,
  );
  const volatility = Math.sqrt(totalVariance);
  const assetMeans = transpose(request.assetReturnsPerPeriod).map(mean);
  return {
    allocation: summarizeAllocation(
      request.assetIds,
      weights,
      assetMeans,
      modeledCovariance,
      0,
    ),
    factorExposures: portfolioExposures,
    meanReturnContributionsPerPeriod: meanContributions,
    factorVarianceContributionsPerPeriod: factorVarianceContributions,
    factorVolatilityContributionsPerPeriod:
      volatility <= NUMERICAL_EPSILON
        ? factorVarianceContributions.map(() => 0)
        : factorVarianceContributions.map((value) => value / volatility),
    idiosyncraticVariancePerPeriod: idiosyncraticVariance,
    idiosyncraticVolatilityContributionPerPeriod:
      volatility <= NUMERICAL_EPSILON ? 0 : idiosyncraticVariance / volatility,
    scenarioReturnChangePerPeriod: scenarioShocks
      ? dot(portfolioExposures, scenarioShocks)
      : null,
  };
}

function buildFactorAssetCovariance(
  exposures: NumericMatrix,
  factorCovariance: NumericMatrix,
  residualVariances: readonly number[],
): number[][] {
  const common = matrixMultiply(
    matrixMultiply(exposures, factorCovariance),
    transpose(exposures),
  );
  return common.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value +
        (rowIndex === columnIndex ? residualVariances[rowIndex] : 0),
    ),
  );
}

interface LinearRegression {
  readonly coefficients: number[];
  readonly residualVariance: number;
  readonly rSquared: number;
}

function fitLinearRegression(
  design: NumericMatrix,
  response: readonly number[],
): LinearRegression {
  const designTranspose = transpose(design);
  const gram = matrixMultiply(designTranspose, design);
  const crossProducts = designTranspose.map((column) => dot(column, response));
  let coefficients: number[];
  try {
    coefficients = solveLinearSystem(gram, crossProducts, 1e-12);
  } catch (error) {
    if (error instanceof QuantError) {
      throw new QuantError(
        "NUMERICAL_FAILURE",
        "Factor regression failed because factors are collinear or nearly collinear.",
        "factorReturnsPerPeriod",
      );
    }
    throw error;
  }
  const fitted = design.map((row) => dot(row, coefficients));
  const residuals = response.map((value, index) => value - fitted[index]);
  const degreesOfFreedom = response.length - coefficients.length;
  const residualVariance =
    sum(residuals.map((value) => value * value)) / degreesOfFreedom;
  const responseMean = mean(response);
  const totalSquares = sum(
    response.map((value) => (value - responseMean) ** 2),
  );
  const residualSquares = sum(residuals.map((value) => value * value));
  return {
    coefficients,
    residualVariance: Math.max(0, residualVariance),
    rSquared:
      totalSquares <= NUMERICAL_EPSILON
        ? Number(residualSquares <= NUMERICAL_EPSILON)
        : 1 - residualSquares / totalSquares,
  };
}

function estimateCapmAsset(
  assetId: string,
  returns: readonly number[],
  marketExcess: readonly number[],
  marketMean: number,
  marketVariance: number,
  riskFreeRate: number,
): CapmAssetEstimate {
  const assetExcess = returns.map((value) => value - riskFreeRate);
  const assetExcessMean = mean(assetExcess);
  const marketExcessMean = mean(marketExcess);
  const crossProduct = sum(
    assetExcess.map(
      (value, index) =>
        (value - assetExcessMean) *
        (marketExcess[index] - marketExcessMean),
    ),
  ) / (assetExcess.length - 1);
  const beta = crossProduct / marketVariance;
  const alpha = assetExcessMean - beta * marketExcessMean;
  const residuals = assetExcess.map(
    (value, index) => value - alpha - beta * marketExcess[index],
  );
  const residualSquares = sum(residuals.map((value) => value * value));
  const totalSquares = sum(
    assetExcess.map((value) => (value - assetExcessMean) ** 2),
  );
  return {
    assetId,
    beta,
    alphaPerPeriod: alpha,
    expectedReturnFromSecurityMarketLinePerPeriod:
      riskFreeRate + beta * (marketMean - riskFreeRate),
    realizedMeanReturnPerPeriod: mean(returns),
    residualVolatilityPerPeriod: Math.sqrt(
      Math.max(0, residualSquares / (returns.length - 2)),
    ),
    rSquared:
      totalSquares <= NUMERICAL_EPSILON
        ? Number(residualSquares <= NUMERICAL_EPSILON)
        : 1 - residualSquares / totalSquares,
  };
}

interface BuiltViews {
  readonly pickMatrix: number[][];
  readonly values: number[];
  readonly confidences: number[];
}

function buildBlackLittermanViews(
  request: BlackLittermanRequest,
  riskFreeRate: number,
): BuiltViews {
  validateIdentifiers(
    request.views.map((view) => view.id),
    "views.id",
    50,
  );
  const indexById = new Map(
    request.assetIds.map((assetId, index) => [assetId, index]),
  );
  const pickMatrix: number[][] = [];
  const values: number[] = [];
  const confidences: number[] = [];
  request.views.forEach((view, viewIndex) => {
    if (!Number.isFinite(view.confidence) || view.confidence <= 0 || view.confidence > 1) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "View confidence must be strictly above zero and at most one.",
        `views.${viewIndex}.confidence`,
      );
    }
    const row = Array(request.assetIds.length).fill(0);
    if (view.kind === "absolute") {
      const assetIndex = indexById.get(view.assetId);
      if (assetIndex === undefined) {
        throw new QuantError(
          "INVALID_INPUT",
          `Unknown asset id in view: ${view.assetId}.`,
          `views.${viewIndex}.assetId`,
        );
      }
      assertFinite(
        view.expectedReturnPerPeriod,
        `views.${viewIndex}.expectedReturnPerPeriod`,
      );
      row[assetIndex] = 1;
      values.push(view.expectedReturnPerPeriod - riskFreeRate);
    } else {
      const outperforming = indexById.get(view.outperformingAssetId);
      const underperforming = indexById.get(view.underperformingAssetId);
      if (outperforming === undefined || underperforming === undefined) {
        throw new QuantError(
          "INVALID_INPUT",
          "Relative views must reference known asset ids.",
          `views.${viewIndex}`,
        );
      }
      if (outperforming === underperforming) {
        throw new QuantError(
          "INVALID_INPUT",
          "A relative view needs two different assets.",
          `views.${viewIndex}`,
        );
      }
      assertFinite(
        view.expectedOutperformancePerPeriod,
        `views.${viewIndex}.expectedOutperformancePerPeriod`,
      );
      row[outperforming] = 1;
      row[underperforming] = -1;
      values.push(view.expectedOutperformancePerPeriod);
    }
    pickMatrix.push(row);
    confidences.push(view.confidence);
  });
  return { pickMatrix, values, confidences };
}

function summarizeAllocation(
  assetIds: readonly string[],
  weights: readonly number[],
  expectedReturns: readonly number[],
  covariance: NumericMatrix,
  riskFreeRate: number,
): PortfolioAllocation {
  const expectedReturn = dot(weights, expectedReturns);
  const risk = riskContributionDetails(weights, covariance);
  return {
    assetIds: [...assetIds],
    weights: [...weights],
    expectedReturnPerPeriod: expectedReturn,
    variancePerPeriod: risk.variance,
    volatilityPerPeriod: risk.volatility,
    sharpeRatio:
      risk.volatility <= NUMERICAL_EPSILON
        ? null
        : (expectedReturn - riskFreeRate) / risk.volatility,
    marginalVolatilityContributions: risk.marginal,
    volatilityContributions: risk.total,
    normalizedRiskContributions: risk.normalized,
  };
}

interface RiskContributionDetails {
  readonly variance: number;
  readonly volatility: number;
  readonly marginal: number[];
  readonly total: number[];
  readonly normalized: number[];
}

function riskContributionDetails(
  weights: readonly number[],
  covariance: NumericMatrix,
): RiskContributionDetails {
  const covarianceTimesWeights = matrixVectorMultiply(covariance, weights);
  const variance = Math.max(0, dot(weights, covarianceTimesWeights));
  const volatility = Math.sqrt(variance);
  if (volatility <= NUMERICAL_EPSILON) {
    const zeros = weights.map(() => 0);
    return {
      variance,
      volatility,
      marginal: [...zeros],
      total: [...zeros],
      normalized: [...zeros],
    };
  }
  const marginal = covarianceTimesWeights.map((value) => value / volatility);
  const total = weights.map((weight, index) => weight * marginal[index]);
  return {
    variance,
    volatility,
    marginal,
    total,
    normalized: total.map((value) => value / volatility),
  };
}

function normalizedRiskContributions(
  weights: readonly number[],
  covariance: NumericMatrix,
): number[] {
  return riskContributionDetails(weights, covariance).normalized;
}

function validateDatasetPolicies(dataset: ReturnDataset, path: string): void {
  if (dataset.missingValuePolicy !== "reject") {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor datasets must reject missing values before alignment.",
      `${path}.missingValuePolicy`,
    );
  }
  if (dataset.alignmentPolicy !== "intersection") {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor datasets must declare timestamp-intersection alignment.",
      `${path}.alignmentPolicy`,
    );
  }
}

interface DatasetColumnSelection {
  readonly ids: string[];
  readonly indexes: number[];
}

function selectDatasetColumns(
  sourceIds: readonly string[],
  requestedIds: readonly string[] | undefined,
  path: string,
  maximum: number,
): DatasetColumnSelection {
  const ids = requestedIds ? [...requestedIds] : [...sourceIds];
  validateIdentifiers(ids, path, maximum);
  const indexById = new Map(sourceIds.map((id, index) => [id, index]));
  const indexes = ids.map((id, index) => {
    const sourceIndex = indexById.get(id);
    if (sourceIndex === undefined) {
      throw new QuantError(
        "INVALID_INPUT",
        `${path}.${index} does not exist in its source dataset.`,
        `${path}.${index}`,
      );
    }
    return sourceIndex;
  });
  return { ids, indexes };
}

function validateAlignedFactorDataset(dataset: AlignedFactorDataset): void {
  if (dataset.contract !== ALIGNED_FACTOR_DATASET_CONTRACT) {
    throw new QuantError(
      "INVALID_INPUT",
      `Unsupported aligned dataset contract. Expected ${ALIGNED_FACTOR_DATASET_CONTRACT}.`,
      "dataset.contract",
    );
  }
  validateIdentifiers(dataset.assetIds, "dataset.assetIds", MAX_ASSETS);
  validateIdentifiers(dataset.factorIds, "dataset.factorIds", MAX_FACTORS);
  if (dataset.returnConvention !== "simple") {
    throw new QuantError(
      "INVALID_INPUT",
      "Rolling factor analysis requires arithmetic simple returns.",
      "dataset.returnConvention",
    );
  }
  if (!(["daily", "weekly", "monthly", "annual"] as const).includes(dataset.frequency)) {
    throw new QuantError(
      "INVALID_INPUT",
      "dataset.frequency is unsupported.",
      "dataset.frequency",
    );
  }
  if (
    dataset.timestamps.length < 2 ||
    dataset.timestamps.length > MAX_OBSERVATIONS
  ) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `dataset.timestamps must contain between two and ${MAX_OBSERVATIONS} observations.`,
      "dataset.timestamps",
    );
  }
  let previousTimestamp = "";
  dataset.timestamps.forEach((timestamp, index) => {
    if (!Number.isFinite(Date.parse(timestamp)) || timestamp <= previousTimestamp) {
      throw new QuantError(
        "INVALID_INPUT",
        "Aligned timestamps must be valid, unique, and increasing.",
        `dataset.timestamps.${index}`,
      );
    }
    previousTimestamp = timestamp;
  });
  const assetColumns = validateObservationMatrix(
    dataset.assetReturnsPerPeriod,
    "dataset.assetReturnsPerPeriod",
  );
  const factorColumns = validateObservationMatrix(
    dataset.factorReturnsPerPeriod,
    "dataset.factorReturnsPerPeriod",
  );
  if (
    dataset.assetReturnsPerPeriod.length !== dataset.timestamps.length ||
    dataset.factorReturnsPerPeriod.length !== dataset.timestamps.length
  ) {
    throw dimensionError(
      "Aligned return matrices and timestamps must have equal row counts.",
      "dataset.timestamps",
    );
  }
  if (assetColumns !== dataset.assetIds.length) {
    throw dimensionError(
      "Aligned asset-return columns must match dataset.assetIds.",
      "dataset.assetReturnsPerPeriod",
    );
  }
  if (factorColumns !== dataset.factorIds.length) {
    throw dimensionError(
      "Aligned factor-return columns must match dataset.factorIds.",
      "dataset.factorReturnsPerPeriod",
    );
  }
  if (dataset.alignment.policy !== "timestamp-intersection") {
    throw new QuantError(
      "INVALID_INPUT",
      "Aligned factor datasets must use timestamp-intersection policy.",
      "dataset.alignment.policy",
    );
  }
  validateSourceRowIndexes(
    dataset.alignment.assetSourceRowIndexes,
    dataset.timestamps.length,
    dataset.alignment.droppedAssetObservationCount,
    "dataset.alignment.assetSourceRowIndexes",
  );
  validateSourceRowIndexes(
    dataset.alignment.factorSourceRowIndexes,
    dataset.timestamps.length,
    dataset.alignment.droppedFactorObservationCount,
    "dataset.alignment.factorSourceRowIndexes",
  );
  for (const [path, source] of [
    ["dataset.provenance.assetSource", dataset.provenance.assetSource],
    ["dataset.provenance.factorSource", dataset.provenance.factorSource],
  ] as const) {
    if (!source.label.trim()) {
      throw new QuantError(
        "INVALID_INPUT",
        "Aligned dataset provenance labels cannot be empty.",
        `${path}.label`,
      );
    }
    if (!(["illustrative", "user-imported", "historical"] as const).includes(source.kind)) {
      throw new QuantError(
        "INVALID_INPUT",
        "Aligned dataset provenance kind is unsupported.",
        `${path}.kind`,
      );
    }
  }
}

function validateSourceRowIndexes(
  indexes: readonly number[],
  alignedObservationCount: number,
  droppedObservationCount: number,
  path: string,
): void {
  if (indexes.length !== alignedObservationCount) {
    throw dimensionError(
      "Source row indexes must match the aligned observation count.",
      path,
    );
  }
  assertIntegerInRange(
    droppedObservationCount,
    0,
    MAX_OBSERVATIONS,
    path.replace("SourceRowIndexes", "DroppedObservationCount"),
  );
  const sourceObservationCount =
    alignedObservationCount + droppedObservationCount;
  if (sourceObservationCount > MAX_OBSERVATIONS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `A source dataset cannot exceed ${MAX_OBSERVATIONS} observations.`,
      path,
    );
  }
  indexes.forEach((index, position) => {
    assertIntegerInRange(index, 0, sourceObservationCount - 1, `${path}.${position}`);
    if (position > 0 && index <= indexes[position - 1]) {
      throw new QuantError(
        "INVALID_INPUT",
        "Source row indexes must be strictly increasing.",
        `${path}.${position}`,
      );
    }
  });
}

function validateAssetInputs(
  assetIds: readonly string[],
  expectedReturns: readonly number[],
  covariance: NumericMatrix,
  expectedReturnsPath: string,
): void {
  validateIdentifiers(assetIds, "assetIds", MAX_ASSETS);
  validateVector(expectedReturns, expectedReturnsPath);
  if (expectedReturns.length !== assetIds.length) {
    throw dimensionError(
      "Expected-return count must match assetIds.",
      expectedReturnsPath,
    );
  }
  validateSquareCovariance(covariance, assetIds.length);
}

function validateSquareCovariance(
  covariance: NumericMatrix,
  assetCount: number,
): void {
  if (covariance.length !== assetCount) {
    throw dimensionError(
      "Covariance rows must match assetIds.",
      "covariancePerPeriod",
    );
  }
  covariance.forEach((row, rowIndex) => {
    if (row.length !== assetCount) {
      throw dimensionError(
        "Covariance must be a square asset-by-asset matrix.",
        `covariancePerPeriod.${rowIndex}`,
      );
    }
    row.forEach((value, columnIndex) =>
      assertFinite(value, `covariancePerPeriod.${rowIndex}.${columnIndex}`),
    );
  });
}

function validateCovariance(covariance: NumericMatrix): ModelWarning[] {
  cholesky(covariance);
  covariance.forEach((row, index) => {
    if (row[index] < 0) {
      throw new QuantError(
        "NOT_POSITIVE_SEMIDEFINITE",
        "Covariance diagonal entries cannot be negative.",
        `covariancePerPeriod.${index}.${index}`,
      );
    }
  });
  return [];
}

function prepareSolverCovariance(
  covariance: NumericMatrix,
  warnings: ModelWarning[],
): PreparedCovariance {
  const factor = cholesky(covariance);
  const largestVariance = Math.max(
    ...covariance.map((row, index) => row[index]),
    NUMERICAL_EPSILON,
  );
  const largestPivot = Math.max(
    ...factor.map((row, index) => row[index]),
    NUMERICAL_EPSILON,
  );
  const smallestPivot = Math.min(...factor.map((row, index) => row[index]));
  const needsRidge = smallestPivot / largestPivot < 1e-7;
  const ridge = needsRidge
    ? Math.max(NUMERICAL_EPSILON, largestVariance * 1e-10)
    : 0;
  if (needsRidge) {
    warnings.push({
      code: "PRECISION",
      message:
        "The covariance matrix is singular or nearly singular. A tiny diagonal ridge stabilizes optimization; reported risk still uses the original covariance.",
    });
  }
  const matrix = covariance.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value + (rowIndex === columnIndex ? ridge : 0),
    ),
  );
  return { matrix, ridge };
}

function validateObservationMatrix(
  matrix: NumericMatrix,
  path: string,
): number {
  if (matrix.length === 0 || matrix.length > MAX_OBSERVATIONS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must contain between one and ${MAX_OBSERVATIONS} rows.`,
      path,
    );
  }
  if (matrix[0].length === 0) {
    throw new QuantError("INVALID_INPUT", `${path} cannot have empty rows.`, path);
  }
  const columns = matrix[0].length;
  if (matrix.length * columns > MAX_OBSERVATION_CELLS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} cannot exceed ${MAX_OBSERVATION_CELLS} numeric cells.`,
      path,
    );
  }
  matrix.forEach((row, rowIndex) => {
    if (row.length !== columns) {
      throw dimensionError(`${path} must be rectangular.`, `${path}.${rowIndex}`);
    }
    row.forEach((value, columnIndex) =>
      assertFinite(value, `${path}.${rowIndex}.${columnIndex}`),
    );
  });
  return columns;
}

function validateVector(values: readonly number[], path: string): void {
  if (values.length === 0) {
    throw new QuantError("INVALID_INPUT", `${path} cannot be empty.`, path);
  }
  values.forEach((value, index) => assertFinite(value, `${path}.${index}`));
}

function validateIdentifiers(
  ids: readonly string[],
  path: string,
  maximum: number,
): void {
  if (ids.length === 0 || ids.length > maximum) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must contain between one and ${maximum} identifiers.`,
      path,
    );
  }
  const normalized = ids.map((id, index) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new QuantError(
        "INVALID_INPUT",
        `${path}.${index} must be a non-empty string.`,
        `${path}.${index}`,
      );
    }
    return id.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new QuantError(
      "INVALID_INPUT",
      `${path} identifiers must be unique.`,
      path,
    );
  }
}

function validateFullyInvestedWeights(
  values: readonly number[],
  expectedLength: number,
  path: string,
): number[] {
  if (values.length !== expectedLength) {
    throw dimensionError(`${path} must match assetIds.`, path);
  }
  values.forEach((value, index) => {
    assertNonNegative(value, `${path}.${index}`);
  });
  if (Math.abs(sum(values) - 1) > 1e-8) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must sum to one.`,
      path,
    );
  }
  return [...values];
}

function validateSolverOptions(
  options: ConstructionSolverOptions | undefined,
): ValidatedSolverOptions {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 1e-12 || tolerance > 1e-4) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "solver.tolerance must be between 1e-12 and 1e-4.",
      "solver.tolerance",
    );
  }
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  assertIntegerInRange(
    maxIterations,
    10,
    100_000,
    "solver.maxIterations",
  );
  return { tolerance, maxIterations };
}

function validateScenario(
  scenario: FactorScenario,
  factorCount: number,
): number[] {
  if (typeof scenario.label !== "string" || scenario.label.trim().length === 0) {
    throw new QuantError(
      "INVALID_INPUT",
      "scenario.label must be a non-empty string.",
      "scenario.label",
    );
  }
  if (scenario.factorShocksPerPeriod.length !== factorCount) {
    throw dimensionError(
      "Scenario shocks must match factorIds.",
      "scenario.factorShocksPerPeriod",
    );
  }
  scenario.factorShocksPerPeriod.forEach((value, index) =>
    assertFinite(value, `scenario.factorShocksPerPeriod.${index}`),
  );
  return [...scenario.factorShocksPerPeriod];
}

function validateAllocationCaps(
  caps: readonly number[],
  assetCount: number,
): number[] {
  if (caps.length !== assetCount) {
    throw dimensionError(
      "maxAssetAllocations must match assetIds.",
      "maxAssetAllocations",
    );
  }
  caps.forEach((cap, index) => {
    assertNonNegative(cap, `maxAssetAllocations.${index}`);
    if (cap > 10) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "Individual allocation caps cannot exceed 10.",
        `maxAssetAllocations.${index}`,
      );
    }
  });
  return [...caps];
}

function normalizePositiveBudgets(
  budgets: readonly number[],
  assetCount: number,
): number[] {
  if (budgets.length !== assetCount) {
    throw dimensionError("riskBudgets must match assetIds.", "riskBudgets");
  }
  budgets.forEach((budget, index) =>
    assertPositive(budget, `riskBudgets.${index}`),
  );
  const total = sum(budgets);
  return budgets.map((budget) => budget / total);
}

function projectCappedAllocation(
  values: readonly number[],
  caps: readonly number[],
  maximumTotal: number,
): number[] {
  const clipped = values.map((value, index) => clamp(value, 0, caps[index]));
  if (sum(clipped) <= maximumTotal) return clipped;
  let lower = Math.min(...values.map((value, index) => value - caps[index]));
  let upper = Math.max(...values);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const threshold = (lower + upper) / 2;
    const total = sum(
      values.map((value, index) => clamp(value - threshold, 0, caps[index])),
    );
    if (total > maximumTotal) lower = threshold;
    else upper = threshold;
  }
  return values.map((value, index) =>
    clamp(value - upper, 0, caps[index]),
  );
}

function stableInverse(
  matrix: NumericMatrix,
  warnings: ModelWarning[],
): number[][] {
  const identity = identityMatrix(matrix.length);
  for (const ridge of [0, 1e-14, 1e-12, 1e-10, 1e-8]) {
    const regularized = matrix.map((row, rowIndex) =>
      row.map(
        (value, columnIndex) =>
          value + (rowIndex === columnIndex ? ridge : 0),
      ),
    );
    try {
      const columns = identity.map((column) =>
        solveLinearSystem(regularized, column, 1e-15),
      );
      if (ridge > 0) {
        warnings.push({
          code: "PRECISION",
          message:
            "The view system was singular or nearly singular, so a tiny diagonal ridge was used.",
        });
      }
      return transpose(columns);
    } catch (error) {
      if (!(error instanceof QuantError)) throw error;
    }
  }
  throw new QuantError(
    "NUMERICAL_FAILURE",
    "Black-Litterman view system could not be solved.",
    "views",
  );
}

function symmetrize(matrix: NumericMatrix): number[][] {
  return matrix.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        (value + matrix[columnIndex][rowIndex]) / 2,
    ),
  );
}

function maxConstraintError(
  weights: readonly number[],
  constraints: NumericMatrix,
  targets: readonly number[],
): number {
  return Math.max(
    ...constraints.map(
      (constraint, index) => Math.abs(dot(constraint, weights) - targets[index]),
    ),
  );
}

function cleanWeights(weights: readonly number[]): number[] {
  return normalizeWeights(weights.map((value) => Math.max(0, value)));
}

function normalizeWeights(weights: readonly number[]): number[] {
  const total = sum(weights);
  if (total <= NUMERICAL_EPSILON) {
    throw new QuantError(
      "NUMERICAL_FAILURE",
      "Optimizer produced no positive allocation.",
    );
  }
  return weights.map((value) => value / total);
}

function finiteSharpeScore(
  weights: readonly number[],
  excessReturns: readonly number[],
  covariance: NumericMatrix,
): number {
  const variance = Math.max(
    0,
    dot(weights, matrixVectorMultiply(covariance, weights)),
  );
  if (variance <= NUMERICAL_EPSILON) {
    return dot(weights, excessReturns) > 0
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;
  }
  return dot(weights, excessReturns) / Math.sqrt(variance);
}

function approximateRuinProbability(
  logGrowth: number,
  variance: number,
  floor: number,
): number {
  if (variance <= NUMERICAL_EPSILON) return Number(logGrowth < 0);
  if (logGrowth <= 0) return 1;
  return clamp(Math.exp(2 * logGrowth * Math.log(floor) / variance), 0, 1);
}

function approximateInitialCapitalDrawdownProbability(
  logGrowth: number,
  variance: number,
  drawdownThreshold: number,
  horizonPeriods: number,
): number {
  const lowerLogBarrier = Math.log1p(-drawdownThreshold);
  if (variance <= NUMERICAL_EPSILON) {
    return Number(logGrowth < 0 && logGrowth * horizonPeriods <= lowerLogBarrier);
  }
  const barrierDistance = -lowerLogBarrier;
  const scale = Math.sqrt(variance * horizonPeriods);
  const firstTerm = normalCdf(
    (-logGrowth * horizonPeriods - barrierDistance) / scale,
  );
  const exponent = -2 * logGrowth * barrierDistance / variance;
  const secondCdf = normalCdf(
    (logGrowth * horizonPeriods - barrierDistance) / scale,
  );
  const secondTerm = Math.exp(Math.min(700, exponent)) * secondCdf;
  return clamp(firstTerm + secondTerm, 0, 1);
}

function sampleVarianceFromMean(
  values: readonly number[],
  average: number,
): number {
  return (
    sum(values.map((value) => (value - average) ** 2)) /
    (values.length - 1)
  );
}

function solverDiagnostics(
  outcome: SolverOutcome,
  covarianceRidge: number,
): SolverDiagnostics {
  return {
    converged: outcome.converged,
    iterations: outcome.iterations,
    maximumError: outcome.maximumError,
    covarianceRidge,
  };
}

function maxAbsoluteDifference(
  left: readonly number[],
  right: readonly number[],
): number {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function hasBoundaryWeight(
  weights: readonly number[],
  tolerance: number,
): boolean {
  return weights.some((weight) => weight <= tolerance);
}

function zeroVolatilityWarning(): ModelWarning {
  return {
    code: "PRECISION",
    message:
      "Portfolio volatility is zero, so the Sharpe ratio and normalized risk contributions are undefined; the result uses null and zeros respectively.",
  };
}

function mergeWarnings(
  target: ModelWarning[],
  source: readonly ModelWarning[],
  prefix: string,
): void {
  source.forEach((warning) => {
    target.push({ ...warning, message: `${prefix}${warning.message}` });
  });
}

function assertContract(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new QuantError(
      "INVALID_INPUT",
      `Unsupported contract. Expected ${expected}.`,
      "contract",
    );
  }
}

function dimensionError(message: string, path: string): QuantError {
  return new QuantError("DIMENSION_MISMATCH", message, path);
}

function envelope<Result>(
  inputContract: string,
  resultContract: string,
  result: Result,
  warnings: readonly ModelWarning[],
): ModelEnvelope<Result> {
  const uniqueWarnings = warnings.filter(
    (warning, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === warning.code && candidate.message === warning.message,
      ) === index,
  );
  return {
    result,
    warnings: uniqueWarnings,
    provenance: {
      engineVersion: CONSTRUCTION_ENGINE_VERSION,
      inputContract,
      resultContract,
    },
  };
}
