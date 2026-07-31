import type { NumericMatrix } from "../quant/core";

/**
 * Native Portfolio Projection Lab contract introduced after the standalone
 * jump, GARCH, and composite model gates. The original request@1 contract is
 * deliberately left frozen for backwards compatibility.
 */
export const PORTFOLIO_LAB_V2_CONTRACT = {
  request: "portfolio-lab/request@2",
  result: "portfolio-lab/result@2",
  problem: "portfolio-lab/problem@2",
  warning: "portfolio-lab/warning@2",
  provenance: "portfolio-lab/provenance@2",
} as const;

export const PORTFOLIO_LAB_V2_MODEL_CONTRACT = {
  gbm: "portfolio-lab/model/gbm@2",
  jumpDiffusion: "portfolio-lab/model/merton-jump-diffusion@2",
  garch: "portfolio-lab/model/garch-1-1@2",
  composite: "portfolio-lab/model/hmm-garch-copula-jump@2",
} as const;

export type PortfolioLabV2ModelKind =
  keyof typeof PORTFOLIO_LAB_V2_MODEL_CONTRACT;

export interface PortfolioLabV2AssetAssumption {
  readonly assetId: string;
  /** Instantaneous annual drift in dS/S. */
  readonly annualDrift: number;
  /** Annualized diffusion volatility. */
  readonly annualVolatility: number;
}

export interface PortfolioLabV2GbmModel {
  readonly contract: typeof PORTFOLIO_LAB_V2_MODEL_CONTRACT.gbm;
  readonly kind: "gbm";
  readonly assets: readonly PortfolioLabV2AssetAssumption[];
  readonly correlation: NumericMatrix;
}

export interface PortfolioLabV2JumpAssumption {
  /** Expected Poisson arrivals per year. */
  readonly annualIntensity: number;
  /** Mean of the log jump multiplier. */
  readonly meanLogJump: number;
  /** Standard deviation of the log jump multiplier. */
  readonly logJumpVolatility: number;
}

export interface PortfolioLabV2JumpAssetAssumption
  extends PortfolioLabV2AssetAssumption {
  readonly jump: PortfolioLabV2JumpAssumption;
}

export interface PortfolioLabV2JumpModel {
  readonly contract: typeof PORTFOLIO_LAB_V2_MODEL_CONTRACT.jumpDiffusion;
  readonly kind: "jumpDiffusion";
  readonly assets: readonly PortfolioLabV2JumpAssetAssumption[];
  readonly correlation: NumericMatrix;
}

/**
 * The conditional variance is annualized. The recursion is
 * h[t] = omega + alpha * epsilon[t-1]^2 + beta * h[t-1].
 * This explicit convention lets alpha=beta=0 and omega=sigma^2 reproduce the
 * constant-volatility GBM case on the shared Gaussian stream.
 */
export interface PortfolioLabV2GarchVariance {
  readonly omega: number;
  readonly alpha: number;
  readonly beta: number;
  readonly initialVariance: number | "unconditional";
}

export interface PortfolioLabV2GarchAssetAssumption {
  readonly assetId: string;
  readonly annualDrift: number;
  readonly variance: PortfolioLabV2GarchVariance;
}

export type PortfolioLabV2Innovation =
  | { readonly kind: "gaussian" }
  | { readonly kind: "student-t"; readonly degreesOfFreedom: number };

export interface PortfolioLabV2GarchModel {
  readonly contract: typeof PORTFOLIO_LAB_V2_MODEL_CONTRACT.garch;
  readonly kind: "garch";
  readonly assets: readonly PortfolioLabV2GarchAssetAssumption[];
  readonly correlation: NumericMatrix;
  readonly innovation: PortfolioLabV2Innovation;
}

export interface PortfolioLabV2CompositeModel {
  readonly contract: typeof PORTFOLIO_LAB_V2_MODEL_CONTRACT.composite;
  readonly kind: "composite";
  /** Supplies drift and constant volatility when a component is disabled. */
  readonly baseAssets: readonly PortfolioLabV2AssetAssumption[];
  readonly regimes: {
    readonly labels: readonly string[];
    readonly initialProbabilities: readonly number[];
    /** One-step probabilities at the request's stepYears frequency. */
    readonly transitionMatrix: NumericMatrix;
    /** One annual drift per [regime][asset]. */
    readonly annualDrifts: NumericMatrix;
  };
  readonly garch: readonly PortfolioLabV2GarchVariance[];
  readonly copula: {
    readonly correlation: NumericMatrix;
    readonly innovation: PortfolioLabV2Innovation;
  };
  readonly jumps: readonly PortfolioLabV2JumpAssumption[];
  readonly enabled: {
    readonly regimes: boolean;
    readonly dynamicVariance: boolean;
    readonly dependence: boolean;
    readonly jumps: boolean;
  };
}

export type PortfolioLabV2Model =
  | PortfolioLabV2GbmModel
  | PortfolioLabV2JumpModel
  | PortfolioLabV2GarchModel
  | PortfolioLabV2CompositeModel;

export interface PortfolioLabV2Case {
  readonly id: string;
  readonly label: string;
  readonly model: PortfolioLabV2Model;
}

export interface PortfolioLabV2Allocation {
  readonly assetId: string;
  readonly targetWeight: number;
}

export type PortfolioLabV2RebalancePolicy =
  | { readonly kind: "never" }
  | { readonly kind: "periodic"; readonly everySteps: number };

export interface PortfolioLabV2Plan {
  readonly initialCapital: number;
  /** Added after market returns and allocated at target weights. */
  readonly contributionPerStep: number;
  /** Removed after contributions, pro rata from current holdings, without debt. */
  readonly withdrawalPerStep: number;
  readonly allocation: readonly PortfolioLabV2Allocation[];
  readonly rebalance: PortfolioLabV2RebalancePolicy;
  readonly annualInflationRate: number;
  readonly targetValue: number;
}

export interface PortfolioLabV2Request {
  readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.request;
  readonly plan: PortfolioLabV2Plan;
  readonly primaryCaseId: string;
  readonly cases: readonly PortfolioLabV2Case[];
  readonly risk: {
    /** Strictly above 0.5 and below 1. */
    readonly confidenceLevel: number;
  };
  readonly execution: {
    readonly seed: number;
    readonly paths: number;
    readonly steps: number;
    readonly stepYears: number;
    readonly samplePaths?: number;
  };
}

export interface PortfolioLabV2WealthMetrics {
  readonly medianTerminalValue: number;
  readonly meanTerminalValue: number;
  readonly medianRealTerminalValue: number;
  readonly totalContributed: number;
  readonly meanTotalWithdrawn: number;
}

export interface PortfolioLabV2GoalMetrics {
  readonly probabilityOfTarget: number;
  readonly averageShortfallRatio: number;
}

export interface PortfolioLabV2LossMetrics {
  readonly probabilityBelowNetInvestedCapital: number;
  /** Capital-relative classroom measure; deliberately not called CVaR. */
  readonly tailCapitalShortfall: number;
}

export interface PortfolioLabV2DrawdownMetrics {
  readonly medianMaximumDrawdown: number;
  readonly probabilityOverThirtyPercent: number;
  readonly probabilityUnrecovered: number;
  readonly averageCompletedRecoverySteps: number | null;
}

export interface PortfolioLabV2RiskMetrics {
  readonly valueAtRisk: number;
  readonly conditionalValueAtRisk: number;
  readonly confidenceLevel: number;
  readonly tailObservationCount: number;
  readonly lossConvention: "positive-terminal-economic-loss";
  readonly finiteSampleConvention: "all-observations-at-or-above-r7-var";
}

export interface PortfolioLabV2Metrics {
  readonly wealth: PortfolioLabV2WealthMetrics;
  readonly goal: PortfolioLabV2GoalMetrics;
  readonly loss: PortfolioLabV2LossMetrics;
  readonly drawdown: PortfolioLabV2DrawdownMetrics;
  readonly risk: PortfolioLabV2RiskMetrics;
}

export interface PortfolioLabV2CaseSummary {
  readonly id: string;
  readonly label: string;
  readonly model: PortfolioLabV2ModelKind;
  readonly modelContract: PortfolioLabV2Model["contract"];
  readonly metrics: PortfolioLabV2Metrics;
}

export interface PortfolioLabV2HoldingSeries {
  readonly assetId: string;
  readonly values: readonly number[];
}

export interface PortfolioLabV2SampledPath {
  readonly pathIndex: number;
  readonly wealth: readonly number[];
  readonly holdings: readonly PortfolioLabV2HoldingSeries[];
  /** Market-only index used to keep cash flows out of drawdown. */
  readonly cashFlowNeutralIndex: readonly number[];
  readonly drawdown: readonly number[];
  readonly totalWithdrawn: number;
}

export interface PortfolioLabV2Percentiles {
  readonly p05: readonly number[];
  readonly p10: readonly number[];
  readonly p50: readonly number[];
  readonly p90: readonly number[];
  readonly p95: readonly number[];
}

export interface PortfolioLabV2Distribution {
  readonly terminalWealth: readonly number[];
  readonly terminalEconomicLosses: readonly number[];
  readonly maximumDrawdowns: readonly number[];
  readonly wealthPercentiles: PortfolioLabV2Percentiles;
  readonly drawdownPercentiles: PortfolioLabV2Percentiles;
}

export interface PortfolioLabV2JumpEvent {
  readonly pathIndex: number;
  readonly stepIndex: number;
  readonly assetIndex: number;
  readonly count: number;
  readonly aggregateLogJump: number;
}

export type PortfolioLabV2Diagnostics =
  | {
      readonly kind: "gbm";
      readonly annualDrifts: readonly number[];
      readonly annualVolatilities: readonly number[];
    }
  | {
      readonly kind: "jumpDiffusion";
      readonly empiricalAnnualJumpCounts: readonly number[];
      readonly probabilityOfAnyCrash: number;
      readonly jumpConditionedMeanMaximumDrawdown: number | null;
      readonly sampledJumpEvents: readonly PortfolioLabV2JumpEvent[];
    }
  | {
      readonly kind: "garch";
      readonly persistence: readonly number[];
      readonly unconditionalVariance: readonly (number | null)[];
      readonly sampledConditionalVariances: readonly (readonly (readonly number[])[])[];
    }
  | {
      readonly kind: "composite";
      readonly updateOrder: "hmm->garch->copula->jump->portfolio";
      readonly regimeOccupancy: readonly number[];
      readonly sampledRegimes: readonly (readonly number[])[];
      readonly sampledConditionalVariances: readonly (readonly (readonly number[])[])[];
      readonly sampledJumpEvents: readonly PortfolioLabV2JumpEvent[];
      readonly enabled: PortfolioLabV2CompositeModel["enabled"];
    };

export interface PortfolioLabV2CaseDetail extends PortfolioLabV2CaseSummary {
  readonly samples: readonly PortfolioLabV2SampledPath[];
  readonly distribution: PortfolioLabV2Distribution;
  readonly diagnostics: PortfolioLabV2Diagnostics;
}

export interface PortfolioLabV2Warning {
  readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.warning;
  readonly code: "ASSUMPTION" | "STATIONARITY" | "PRECISION";
  readonly caseId?: string;
  readonly message: string;
}

export interface PortfolioLabV2Provenance {
  readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.provenance;
  readonly requestContract: typeof PORTFOLIO_LAB_V2_CONTRACT.request;
  readonly engineVersion: "portfolio-lab-engine@2";
  readonly randomStreamVersion: "semantic-keyed-streams@2";
  readonly eventOrderVersion: "market->contribution->withdrawal->rebalance->record@2";
  readonly quantileMethod: "linear-r7";
  readonly seed: number;
  readonly timeGrid: { readonly steps: number; readonly stepYears: number };
  readonly selectedPathIndexes: readonly number[];
  readonly requestedCaseIds: readonly string[];
}

export interface PortfolioLabV2Result {
  readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.result;
  readonly primary: PortfolioLabV2CaseDetail;
  readonly comparisons: readonly PortfolioLabV2CaseSummary[];
  readonly warnings: readonly PortfolioLabV2Warning[];
  readonly provenance: PortfolioLabV2Provenance;
}

export interface PortfolioLabV2Issue {
  readonly code:
    | "MISSING"
    | "NOT_FINITE"
    | "OUT_OF_RANGE"
    | "NOT_INTEGER"
    | "DUPLICATE_ID"
    | "INVALID_REFERENCE"
    | "INVALID_DISTRIBUTION"
    | "DIMENSION_MISMATCH"
    | "UNSUPPORTED_MODEL";
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type PortfolioLabV2Problem =
  | {
      readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.problem;
      readonly code: "UNSUPPORTED_CONTRACT";
      readonly message: string;
      readonly receivedContract: string | null;
      readonly supportedContracts: readonly string[];
    }
  | {
      readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.problem;
      readonly code: "INVALID_REQUEST";
      readonly message: string;
      readonly issues: readonly PortfolioLabV2Issue[];
    }
  | {
      readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.problem;
      readonly code: "RESOURCE_LIMIT";
      readonly message: string;
      readonly resource: "CASES" | "ASSETS" | "PATHS" | "STEPS" | "PATH_STEPS";
      readonly requested: number;
      readonly limit: number;
    }
  | {
      readonly contract: typeof PORTFOLIO_LAB_V2_CONTRACT.problem;
      readonly code: "NUMERICAL_FAILURE";
      readonly message: string;
      readonly caseId?: string;
      readonly location?: {
        readonly pathIndex?: number;
        readonly stepIndex?: number;
        readonly quantity?: string;
      };
    };

export type PortfolioLabV2Outcome =
  | { readonly ok: true; readonly result: PortfolioLabV2Result }
  | { readonly ok: false; readonly problem: PortfolioLabV2Problem };
