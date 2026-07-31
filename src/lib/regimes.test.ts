import { describe, expect, it } from "vitest";

import { DEFAULT_HMM_CONFIGURATION } from "./defaults";
import {
  hmmConfigurationsEqual,
  portfolioRegimeMoments,
  REGIME_ORDER,
  updateTransitionProbability,
} from "./regimes";

describe("regime configuration helpers", () => {
  it("redistributes a transition row while preserving a total of one", () => {
    const updated = updateTransitionProbability(
      DEFAULT_HMM_CONFIGURATION,
      "bull",
      "bear",
      0.2,
    );
    const row = updated.transitionMatrix.bull;
    const rowTotal = REGIME_ORDER.reduce(
      (sum, regime) => sum + row[regime],
      0,
    );

    expect(row.bear).toBe(0.2);
    expect(rowTotal).toBeCloseTo(1, 12);
    expect(row.bull / row.sideways).toBeCloseTo(0.94 / 0.04, 12);
    expect(DEFAULT_HMM_CONFIGURATION.transitionMatrix.bull.bear).toBe(0.02);
  });

  it("derives portfolio volatility from regime-specific covariance", () => {
    const assumptions = {
      stocks: { expectedReturn: 0.1, volatility: 0.2 },
      bonds: { expectedReturn: 0.04, volatility: 0.1 },
      correlation: 0,
    };
    const moments = portfolioRegimeMoments(assumptions, 0.5);

    expect(moments.expectedReturn).toBeCloseTo(0.07, 12);
    expect(moments.volatility).toBeCloseTo(
      Math.sqrt(0.5 ** 2 * 0.2 ** 2 + 0.5 ** 2 * 0.1 ** 2),
      12,
    );
  });

  it("compares the complete HMM configuration without duplicating field walks", () => {
    const updatedTransition = updateTransitionProbability(
      DEFAULT_HMM_CONFIGURATION,
      "bear",
      "bull",
      0.2,
    );
    const updatedAssumptions = {
      ...DEFAULT_HMM_CONFIGURATION,
      regimes: {
        ...DEFAULT_HMM_CONFIGURATION.regimes,
        bull: {
          ...DEFAULT_HMM_CONFIGURATION.regimes.bull,
          correlation: 0.25,
        },
      },
    };

    expect(
      hmmConfigurationsEqual(
        DEFAULT_HMM_CONFIGURATION,
        DEFAULT_HMM_CONFIGURATION,
      ),
    ).toBe(true);
    expect(
      hmmConfigurationsEqual(DEFAULT_HMM_CONFIGURATION, updatedTransition),
    ).toBe(false);
    expect(
      hmmConfigurationsEqual(DEFAULT_HMM_CONFIGURATION, updatedAssumptions),
    ).toBe(false);
  });
});
