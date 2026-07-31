export type RebalanceFrequency = "monthly" | "annual" | "never";

export interface AssetAssumptions {
  expectedReturn: number;
  volatility: number;
}

export interface SimulationInputs {
  initialCapital: number;
  monthlyContribution: number;
  horizonYears: number;
  stockAllocation: number;
  stocks: AssetAssumptions;
  bonds: AssetAssumptions;
  correlation: number;
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
  metrics: SimulationMetrics;
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
