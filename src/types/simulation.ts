export type RebalanceFrequency = "monthly" | "annual" | "never";
export type SimulationModel = "constant" | "hmm";
export type Regime = "bull" | "bear" | "sideways";

export interface AssetAssumptions {
  expectedReturn: number;
  volatility: number;
}

export interface MarketAssumptions {
  stocks: AssetAssumptions;
  bonds: AssetAssumptions;
  correlation: number;
}

export type RegimeProbabilities = Record<Regime, number>;
export type TransitionMatrix = Record<Regime, RegimeProbabilities>;

export interface HMMConfiguration {
  regimes: Record<Regime, MarketAssumptions>;
  transitionMatrix: TransitionMatrix;
  currentStateProbabilities: RegimeProbabilities;
}

export interface SimulationInputs {
  initialCapital: number;
  monthlyContribution: number;
  horizonYears: number;
  stockAllocation: number;
  model: SimulationModel;
  stocks: AssetAssumptions;
  bonds: AssetAssumptions;
  correlation: number;
  hmm: HMMConfiguration;
  rebalanceFrequency: RebalanceFrequency;
  inflationRate: number;
  targetValue: number;
  pathCount: number;
  seed: number;
}

export interface PercentileSeries {
  p05: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  p95: number[];
}

export interface SimulationMetrics {
  medianTerminalValue: number;
  meanTerminalValue: number;
  medianRealValue: number;
  probabilityOfTarget: number;
  probabilityOfLoss: number;
  medianMaxDrawdown: number;
  probabilityOfThirtyPercentDrawdown: number;
  probabilityOfUnrecoveredDrawdown: number;
  /** Mean peak-to-recovery duration across completed drawdown episodes only. */
  averageRecoveryMonths: number | null;
  /**
   * Mean loss versus contributed capital among the lowest 5% of ending values.
   * A value of zero means even the tail sample finished above contributions.
   */
  expectedShortfall: number;
  /**
   * Mean percentage gap versus the target among paths that finish below it.
   * A value of zero means every path reaches the target or the target is zero.
   */
  averageTargetShortfall: number;
  totalContributed: number;
}

export interface SimulationResult {
  inputs: SimulationInputs;
  months: number[];
  samplePaths: number[][];
  sampleDrawdownPaths: number[][];
  pathPercentiles: PercentileSeries;
  drawdownPercentiles: PercentileSeries;
  terminalValues: number[];
  maxDrawdowns: number[];
  /** Present only when the selected model is the HMM engine. */
  sampleRegimePaths: Regime[][];
  regimeOccupancy: RegimeProbabilities | null;
  metrics: SimulationMetrics;
  comparisonMetrics: Record<SimulationModel, SimulationMetrics>;
  computedAt: number;
}

export interface SimulationWorkerRequest {
  id: number;
  inputs: SimulationInputs;
}

export interface SimulationWorkerResponse {
  id: number;
  result?: SimulationResult;
  error?: string;
}
