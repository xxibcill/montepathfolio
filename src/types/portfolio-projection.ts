export type PortfolioProjectionRebalanceFrequency =
  | "monthly"
  | "annual"
  | "never";
export type PortfolioProjectionModel = "constant" | "hmm";
export type PortfolioProjectionRegime = "bull" | "bear" | "sideways";

export interface PortfolioProjectionAssetAssumptions {
  readonly expectedReturn: number;
  readonly volatility: number;
}

export interface PortfolioProjectionMarketAssumptions {
  readonly stocks: PortfolioProjectionAssetAssumptions;
  readonly bonds: PortfolioProjectionAssetAssumptions;
  readonly correlation: number;
}

export type PortfolioProjectionRegimeProbabilities = Record<
  PortfolioProjectionRegime,
  number
>;

export type PortfolioProjectionTransitionMatrix = Record<
  PortfolioProjectionRegime,
  PortfolioProjectionRegimeProbabilities
>;

export interface PortfolioProjectionHmmConfiguration {
  readonly regimes: Record<
    PortfolioProjectionRegime,
    PortfolioProjectionMarketAssumptions
  >;
  readonly transitionMatrix: PortfolioProjectionTransitionMatrix;
  readonly currentStateProbabilities: PortfolioProjectionRegimeProbabilities;
}

/**
 * Persisted learner-facing scenario. The field names intentionally remain
 * compatible with the original local-storage payload while execution is now
 * handled by the native portfolio-lab contract.
 */
export interface PortfolioProjectionInputs {
  readonly initialCapital: number;
  readonly monthlyContribution: number;
  readonly horizonYears: number;
  readonly stockAllocation: number;
  readonly model: PortfolioProjectionModel;
  readonly stocks: PortfolioProjectionAssetAssumptions;
  readonly bonds: PortfolioProjectionAssetAssumptions;
  readonly correlation: number;
  readonly hmm: PortfolioProjectionHmmConfiguration;
  readonly rebalanceFrequency: PortfolioProjectionRebalanceFrequency;
  readonly inflationRate: number;
  readonly targetValue: number;
  readonly pathCount: number;
  readonly seed: number;
}
