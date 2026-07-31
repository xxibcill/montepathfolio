import { describe, expect, it } from "vitest";

import { DEFAULT_HMM_CONFIGURATION, REGIME_ORDER } from "./defaults";
import {
  portfolioRegimeMoments,
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
});
