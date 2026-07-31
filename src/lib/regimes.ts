import type {
  HMMConfiguration,
  MarketAssumptions,
  Regime,
  TransitionMatrix,
} from "../types/simulation";

export const REGIME_ORDER = ["bull", "bear", "sideways"] as const;
export const REPRESENTATIVE_REGIME_PATH_COUNT = 6;

export const REGIME_LABELS: Record<Regime, string> = {
  bull: "Bull",
  bear: "Bear",
  sideways: "Sideways",
};

export const REGIME_DESCRIPTIONS: Record<Regime, string> = {
  bull: "Positive return · moderate volatility",
  bear: "Negative return · high volatility",
  sideways: "Low return · restrained volatility",
};

export function updateTransitionProbability(
  configuration: HMMConfiguration,
  fromRegime: Regime,
  toRegime: Regime,
  nextProbability: number,
): HMMConfiguration {
  const clampedProbability = Math.max(0, Math.min(1, nextProbability));
  const previousRow = configuration.transitionMatrix[fromRegime];
  const remainingRegimes = REGIME_ORDER.filter(
    (regime) => regime !== toRegime,
  );
  const previousRemainingTotal = remainingRegimes.reduce(
    (sum, regime) => sum + previousRow[regime],
    0,
  );
  const nextRemainingTotal = 1 - clampedProbability;
  const nextRow = { ...previousRow, [toRegime]: clampedProbability };

  if (previousRemainingTotal === 0) {
    for (const regime of remainingRegimes) {
      nextRow[regime] = nextRemainingTotal / remainingRegimes.length;
    }
  } else {
    for (const regime of remainingRegimes) {
      nextRow[regime] =
        (previousRow[regime] / previousRemainingTotal) * nextRemainingTotal;
    }
  }

  return {
    ...configuration,
    transitionMatrix: {
      ...configuration.transitionMatrix,
      [fromRegime]: nextRow,
    },
  };
}

export function portfolioRegimeMoments(
  assumptions: MarketAssumptions,
  stockAllocation: number,
): { expectedReturn: number; volatility: number } {
  const bondAllocation = 1 - stockAllocation;
  const stockVolatility = assumptions.stocks.volatility;
  const bondVolatility = assumptions.bonds.volatility;
  const variance =
    stockAllocation ** 2 * stockVolatility ** 2 +
    bondAllocation ** 2 * bondVolatility ** 2 +
    2 *
      stockAllocation *
      bondAllocation *
      assumptions.correlation *
      stockVolatility *
      bondVolatility;

  return {
    expectedReturn:
      stockAllocation * assumptions.stocks.expectedReturn +
      bondAllocation * assumptions.bonds.expectedReturn,
    volatility: Math.sqrt(Math.max(0, variance)),
  };
}

export function transitionMatricesEqual(
  left: TransitionMatrix,
  right: TransitionMatrix,
): boolean {
  return REGIME_ORDER.every((fromRegime) =>
    REGIME_ORDER.every(
      (toRegime) =>
        left[fromRegime][toRegime] === right[fromRegime][toRegime],
    ),
  );
}

export function hmmConfigurationsEqual(
  left: HMMConfiguration,
  right: HMMConfiguration,
): boolean {
  return (
    REGIME_ORDER.every(
      (regime) =>
        left.regimes[regime].stocks.expectedReturn ===
          right.regimes[regime].stocks.expectedReturn &&
        left.regimes[regime].stocks.volatility ===
          right.regimes[regime].stocks.volatility &&
        left.regimes[regime].bonds.expectedReturn ===
          right.regimes[regime].bonds.expectedReturn &&
        left.regimes[regime].bonds.volatility ===
          right.regimes[regime].bonds.volatility &&
        left.regimes[regime].correlation ===
          right.regimes[regime].correlation &&
        left.currentStateProbabilities[regime] ===
          right.currentStateProbabilities[regime]
    ) && transitionMatricesEqual(left.transitionMatrix, right.transitionMatrix)
  );
}
