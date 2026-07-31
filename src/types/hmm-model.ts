import type { Regime } from "./simulation";

export interface HMMModelMetadata {
  name: string;
  observationFrequency: string;
  features: string[];
  calibration: string;
}

export interface HMMModelAssetState {
  annualReturn: number;
  annualVolatility: number;
}

export interface HMMModelState {
  id: number;
  label: Regime;
  stocks: HMMModelAssetState;
  bonds: HMMModelAssetState;
  correlation: number;
}

export interface HMMHistoryObservation {
  date: string;
  normalizedPrice: number;
  state: Regime;
}

export type ThreeStateVector = [number, number, number];
export type ThreeStateMatrix = [
  ThreeStateVector,
  ThreeStateVector,
  ThreeStateVector,
];

export interface HMMModelPayload {
  metadata: HMMModelMetadata;
  states: [HMMModelState, HMMModelState, HMMModelState];
  transitionMatrix: ThreeStateMatrix;
  currentStateProbabilities: ThreeStateVector;
  history?: HMMHistoryObservation[];
}
