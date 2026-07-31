export const PORTFOLIO_LAB_CONTRACT = {
  request: "portfolio-lab/request@1",
  result: "portfolio-lab/result@1",
  warning: "portfolio-lab/warning@1",
  problem: "portfolio-lab/problem@1",
  provenance: "portfolio-lab/provenance@1",
  gbmDiagnostics: "portfolio-lab/diagnostics/gbm@1",
  hmmDiagnostics: "portfolio-lab/diagnostics/hmm@1",
} as const;

export const PORTFOLIO_LAB_MODEL_CONTRACT = {
  gbm: "portfolio-lab/model/gbm@1",
  hmm: "portfolio-lab/model/hmm@1",
} as const;

export type PortfolioLabModelContractByKind =
  typeof PORTFOLIO_LAB_MODEL_CONTRACT;
export type PortfolioLabModelKind = keyof PortfolioLabModelContractByKind;

declare const portfolioCaseIdBrand: unique symbol;

export type PortfolioCaseId = string & {
  readonly [portfolioCaseIdBrand]: "PortfolioCaseId";
};

/**
 * Applies the compile-time case-ID brand. Runner validation remains responsible
 * for checking that IDs are non-empty, unique, and resolvable.
 */
export function asPortfolioCaseId(value: string): PortfolioCaseId {
  return value as PortfolioCaseId;
}

export type PortfolioAsset = "stocks" | "bonds";
export type HmmRegime = "bull" | "bear" | "sideways";
export type HmmRegimeProbabilities = Readonly<Record<HmmRegime, number>>;

/**
 * Both fields are annualized decimals. `annualDrift` is the instantaneous
 * expected return in dS/S; `annualVolatility` is the diffusion volatility.
 */
export interface AnnualizedAssetAssumptions {
  readonly annualDrift: number;
  readonly annualVolatility: number;
}

export interface TwoAssetMarketAssumptions {
  readonly stocks: AnnualizedAssetAssumptions;
  readonly bonds: AnnualizedAssetAssumptions;
  /** Stock/bond return correlation in the closed interval [-1, 1]. */
  readonly correlation: number;
}

export interface GbmModelSpec {
  readonly contract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.gbm;
  readonly kind: "gbm";
  readonly market: TwoAssetMarketAssumptions;
}

export interface HmmModelSpec {
  readonly contract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.hmm;
  readonly kind: "hmm";
  readonly regimes: Readonly<
    Record<HmmRegime, TwoAssetMarketAssumptions>
  >;
  readonly transitionMatrix: Readonly<
    Record<HmmRegime, HmmRegimeProbabilities>
  >;
  /**
   * Every probability is a decimal in [0, 1]. Each transition row and this
   * initial distribution must sum to one.
   */
  readonly initialStateProbabilities: HmmRegimeProbabilities;
}

export interface MarketModelSpecByKind {
  readonly gbm: GbmModelSpec;
  readonly hmm: HmmModelSpec;
}

export type MarketModelSpec = MarketModelSpecByKind[PortfolioLabModelKind];

export interface MarketCase {
  readonly id: PortfolioCaseId;
  readonly label: string;
  readonly model: MarketModelSpec;
}

export type RebalancePolicy =
  | {
      readonly kind: "periodic";
      readonly everySteps: number;
    }
  | {
      readonly kind: "never";
    };

/**
 * Portfolio accounting is independent from market dynamics. Time index zero is
 * the opening state. Each later step advances market state, applies returns,
 * adds `contributionPerStep`, rebalances when due, then records wealth and the
 * cash-flow-neutral drawdown index.
 */
export interface PortfolioPlan {
  readonly initialCapital: number;
  readonly contributionPerStep: number;
  /** Non-negative weights that sum to one. */
  readonly targetWeights: Readonly<Record<PortfolioAsset, number>>;
  readonly rebalance: RebalancePolicy;
  /**
   * Annual effective decimal inflation rate. The cumulative inflation factor
   * after `years` is `(1 + annualInflationRate) ** years`.
   */
  readonly annualInflationRate: number;
  readonly targetValue: number;
}

export interface PortfolioLabExecution {
  readonly seed: number;
  readonly paths: number;
  readonly steps: number;
  /** Length of one simulation step in years. */
  readonly stepYears: number;
}

/**
 * Request records contain only structured-clone-safe plain data.
 *
 * Runtime validation must require a non-empty case list, unique case IDs, a
 * resolvable `primaryCaseId`, finite admissible parameters, and resource use
 * within the engine's declared limits.
 */
export interface PortfolioLabRequest {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.request;
  readonly plan: PortfolioPlan;
  readonly primaryCaseId: PortfolioCaseId;
  readonly cases: readonly MarketCase[];
  readonly execution: PortfolioLabExecution;
}

export interface NominalWealthSeries {
  readonly kind: "nominal-wealth";
  readonly values: readonly number[];
}

export interface DrawdownRatioSeries {
  readonly kind: "drawdown-ratio";
  readonly values: readonly number[];
}

export interface PercentileSeries<
  Series extends NominalWealthSeries | DrawdownRatioSeries,
> {
  readonly p05: Series;
  readonly p10: Series;
  readonly p50: Series;
  readonly p90: Series;
  readonly p95: Series;
}

export interface WealthMetrics {
  readonly medianTerminalValue: number;
  readonly meanTerminalValue: number;
  readonly medianRealTerminalValue: number;
  readonly totalContributed: number;
}

export interface GoalMetrics {
  readonly probabilityOfTarget: number;
  /** Mean target gap ratio among paths below the target. */
  readonly averageShortfallRatio: number;
}

export interface LossMetrics {
  readonly probabilityBelowContributions: number;
  /**
   * Mean capital-loss ratio among the lowest five percent of terminal values.
   * This is not standard loss-tail Expected Shortfall/CVaR.
   */
  readonly tailCapitalShortfall: number;
}

export interface DrawdownMetrics {
  readonly medianMaximumDrawdown: number;
  readonly probabilityOverThirtyPercent: number;
  readonly probabilityUnrecovered: number;
  /** Null when no drawdown episode completes during the time grid. */
  readonly averageCompletedRecoverySteps: number | null;
}

export interface PortfolioMetrics {
  readonly wealth: WealthMetrics;
  readonly goal: GoalMetrics;
  readonly loss: LossMetrics;
  readonly drawdown: DrawdownMetrics;
}

interface PortfolioCaseSummaryBase {
  readonly id: PortfolioCaseId;
  readonly label: string;
  readonly metrics: PortfolioMetrics;
}

type PortfolioCaseModelIdentity<Kind extends PortfolioLabModelKind> = {
  readonly model: Kind;
  readonly modelContract: PortfolioLabModelContractByKind[Kind];
};

type PortfolioCaseSummaryByModel = {
  readonly [Kind in PortfolioLabModelKind]: PortfolioCaseSummaryBase &
    PortfolioCaseModelIdentity<Kind>;
};

export type GbmCaseSummary = PortfolioCaseSummaryByModel["gbm"];
export type HmmCaseSummary = PortfolioCaseSummaryByModel["hmm"];
export type PortfolioCaseSummary =
  PortfolioCaseSummaryByModel[PortfolioLabModelKind];

export interface SampledPortfolioPath {
  /** Original simulation path index, independent of sample array position. */
  readonly pathIndex: number;
  /** Nominal portfolio wealth at time zero and after every step. */
  readonly wealth: NominalWealthSeries;
  /** Cash-flow-neutral drawdown ratio at the same time indexes. */
  readonly drawdown: DrawdownRatioSeries;
}

export interface PortfolioDistribution {
  readonly terminalWealth: NominalWealthSeries;
  readonly maximumDrawdowns: DrawdownRatioSeries;
  readonly wealthPercentiles: PercentileSeries<NominalWealthSeries>;
  readonly drawdownPercentiles: PercentileSeries<DrawdownRatioSeries>;
}

export interface GbmDiagnostics {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.gbmDiagnostics;
  readonly kind: "gbm";
}

export interface SampledHmmStatePath {
  readonly pathIndex: number;
  /** Includes the state at time zero followed by one state per step. */
  readonly states: readonly HmmRegime[];
}

export interface HmmDiagnostics {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.hmmDiagnostics;
  readonly kind: "hmm";
  readonly regimeOccupancy: HmmRegimeProbabilities;
  readonly sampledStatePaths: readonly SampledHmmStatePath[];
}

interface PortfolioCaseDetailBase extends PortfolioCaseSummaryBase {
  readonly samples: readonly SampledPortfolioPath[];
  readonly distribution: PortfolioDistribution;
}

interface PortfolioCaseDiagnosticsByModel {
  readonly gbm: GbmDiagnostics;
  readonly hmm: HmmDiagnostics;
}

type PortfolioCaseDetailByModel = {
  readonly [Kind in PortfolioLabModelKind]: PortfolioCaseDetailBase &
    PortfolioCaseModelIdentity<Kind> & {
      readonly diagnostics: PortfolioCaseDiagnosticsByModel[Kind];
    };
};

export type GbmCaseDetail = PortfolioCaseDetailByModel["gbm"];
export type HmmCaseDetail = PortfolioCaseDetailByModel["hmm"];
export type PortfolioCaseDetail =
  PortfolioCaseDetailByModel[PortfolioLabModelKind];

export type PortfolioLabWarningCode =
  | "MODEL_ASSUMPTION"
  | "NUMERICAL_STABILITY"
  | "STATISTICAL_PRECISION";

export type PortfolioLabWarningScope =
  | { readonly kind: "request" }
  | { readonly kind: "case"; readonly caseId: PortfolioCaseId };

export interface PortfolioLabWarning {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.warning;
  readonly code: PortfolioLabWarningCode;
  readonly scope: PortfolioLabWarningScope;
  readonly message: string;
}

export interface PortfolioLabTimeGrid {
  readonly steps: number;
  readonly stepYears: number;
}

/**
 * Provenance is deterministic model output. Wall-clock timing and timestamps
 * belong to runner telemetry and must not be added here.
 */
export interface PortfolioLabProvenance {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.provenance;
  readonly requestContract: typeof PORTFOLIO_LAB_CONTRACT.request;
  readonly engineVersion: string;
  readonly randomStreamVersion: string;
  readonly eventOrderVersion: string;
  readonly quantileMethod: "linear-r7";
  readonly seed: number;
  readonly timeGrid: PortfolioLabTimeGrid;
  readonly selectedPathIndexes: readonly number[];
}

/**
 * `primary` contains bounded path detail and model diagnostics. `comparisons`
 * contains one lightweight summary for each requested non-primary case, in
 * request order. No unrequested model may be simulated.
 */
export interface PortfolioLabResult {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.result;
  readonly primary: PortfolioCaseDetail;
  readonly comparisons: readonly PortfolioCaseSummary[];
  readonly warnings: readonly PortfolioLabWarning[];
  readonly provenance: PortfolioLabProvenance;
}

export type PortfolioLabIssueCode =
  | "MISSING"
  | "NOT_FINITE"
  | "OUT_OF_RANGE"
  | "NOT_INTEGER"
  | "DUPLICATE_ID"
  | "INVALID_REFERENCE"
  | "INVALID_DISTRIBUTION"
  | "UNSUPPORTED_MODEL";

export interface PortfolioLabIssue {
  readonly code: PortfolioLabIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

interface PortfolioLabProblemBase {
  readonly contract: typeof PORTFOLIO_LAB_CONTRACT.problem;
  readonly message: string;
}

export interface InvalidRequestProblem extends PortfolioLabProblemBase {
  readonly code: "INVALID_REQUEST";
  readonly issues: readonly PortfolioLabIssue[];
}

export type PortfolioLabInputContract =
  | typeof PORTFOLIO_LAB_CONTRACT.request
  | PortfolioLabModelContractByKind[PortfolioLabModelKind];

export type PortfolioLabContractPath =
  | readonly ["contract"]
  | readonly ["cases", number, "model", "contract"];

export interface UnsupportedContractProblem extends PortfolioLabProblemBase {
  readonly code: "UNSUPPORTED_CONTRACT";
  readonly path: PortfolioLabContractPath;
  readonly receivedContract: string | null;
  readonly supportedContracts: readonly PortfolioLabInputContract[];
}

export interface ResourceLimitProblem extends PortfolioLabProblemBase {
  readonly code: "RESOURCE_LIMIT";
  readonly resource: "CASES" | "PATHS" | "STEPS" | "ESTIMATED_BYTES";
  readonly requested: number;
  readonly limit: number;
}

export interface CancelledProblem extends PortfolioLabProblemBase {
  readonly code: "CANCELLED";
}

export interface WorkerFailureProblem extends PortfolioLabProblemBase {
  readonly code: "WORKER_FAILURE";
  readonly phase: "START" | "SEND" | "RECEIVE" | "CRASH";
}

export interface NumericalFailureProblem extends PortfolioLabProblemBase {
  readonly code: "NUMERICAL_FAILURE";
  readonly caseId: PortfolioCaseId;
  readonly location?: {
    readonly pathIndex?: number;
    readonly stepIndex?: number;
    readonly quantity?: string;
  };
}

export type PortfolioLabProblem =
  | InvalidRequestProblem
  | UnsupportedContractProblem
  | ResourceLimitProblem
  | CancelledProblem
  | WorkerFailureProblem
  | NumericalFailureProblem;

export type PortfolioLabProblemCode = PortfolioLabProblem["code"];

export type PortfolioLabOutcome =
  | {
      readonly ok: true;
      readonly result: PortfolioLabResult;
    }
  | {
      readonly ok: false;
      readonly problem: PortfolioLabProblem;
    };

export interface PortfolioLabRun {
  /**
   * Resolves exactly once with deterministic output or a structured problem.
   * Operational failures never escape as untyped rejection strings.
   */
  readonly outcome: Promise<PortfolioLabOutcome>;
  /** Cancellation is idempotent; the first terminal event wins. */
  cancel(): void;
}

/**
 * The sole behavioral interface at the portfolio-lab seam. Web Worker and
 * in-process adapters will both implement this interface.
 */
export interface PortfolioLabRunner {
  run(request: PortfolioLabRequest): PortfolioLabRun;
}
