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

export type MarketModelSpec = GbmModelSpec | HmmModelSpec;

export interface MarketCase {
  readonly id: string;
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
  /** Annualized decimal inflation rate. */
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
  readonly primaryCaseId: string;
  readonly cases: readonly MarketCase[];
  readonly execution: PortfolioLabExecution;
}

export interface PercentileSeries {
  readonly p05: readonly number[];
  readonly p10: readonly number[];
  readonly p50: readonly number[];
  readonly p90: readonly number[];
  readonly p95: readonly number[];
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
  readonly id: string;
  readonly label: string;
  readonly metrics: PortfolioMetrics;
}

export interface GbmCaseSummary extends PortfolioCaseSummaryBase {
  readonly model: "gbm";
  readonly modelContract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.gbm;
}

export interface HmmCaseSummary extends PortfolioCaseSummaryBase {
  readonly model: "hmm";
  readonly modelContract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.hmm;
}

export type PortfolioCaseSummary = GbmCaseSummary | HmmCaseSummary;

export interface SampledPortfolioPath {
  /** Original simulation path index, independent of sample array position. */
  readonly pathIndex: number;
  /** Nominal portfolio wealth at time zero and after every step. */
  readonly wealth: readonly number[];
  /** Cash-flow-neutral drawdown ratio at the same time indexes. */
  readonly drawdown: readonly number[];
}

export interface PortfolioDistribution {
  readonly terminalWealth: readonly number[];
  readonly maximumDrawdowns: readonly number[];
  readonly wealthPercentiles: PercentileSeries;
  readonly drawdownPercentiles: PercentileSeries;
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

export interface GbmCaseDetail extends PortfolioCaseDetailBase {
  readonly model: "gbm";
  readonly modelContract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.gbm;
  readonly diagnostics: GbmDiagnostics;
}

export interface HmmCaseDetail extends PortfolioCaseDetailBase {
  readonly model: "hmm";
  readonly modelContract: typeof PORTFOLIO_LAB_MODEL_CONTRACT.hmm;
  readonly diagnostics: HmmDiagnostics;
}

export type PortfolioCaseDetail = GbmCaseDetail | HmmCaseDetail;

export type PortfolioLabWarningCode =
  | "MODEL_ASSUMPTION"
  | "NUMERICAL_STABILITY"
  | "STATISTICAL_PRECISION";

export type PortfolioLabWarningScope =
  | { readonly kind: "request" }
  | { readonly kind: "case"; readonly caseId: string };

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

export interface UnsupportedContractProblem extends PortfolioLabProblemBase {
  readonly code: "UNSUPPORTED_CONTRACT";
  readonly receivedContract: string | null;
  readonly supportedContracts: readonly [
    typeof PORTFOLIO_LAB_CONTRACT.request,
  ];
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
  readonly caseId: string;
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
