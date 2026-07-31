import { describe, expect, it } from "vitest";

import type { HMMModelPayload } from "../types/hmm-model";
import {
  createHMMConfiguration,
  parseHMMModelPayload,
} from "./hmm-model";

const PAYLOAD: HMMModelPayload = {
  metadata: {
    name: "Test model",
    observationFrequency: "weekly",
    features: ["log return", "realized volatility"],
    calibration: "Test fixture",
  },
  states: [
    {
      id: 4,
      label: "bear",
      stocks: { annualReturn: -0.2, annualVolatility: 0.3 },
      bonds: { annualReturn: 0.05, annualVolatility: 0.08 },
      correlation: -0.1,
    },
    {
      id: 9,
      label: "bull",
      stocks: { annualReturn: 0.12, annualVolatility: 0.14 },
      bonds: { annualReturn: 0.03, annualVolatility: 0.05 },
      correlation: 0.05,
    },
    {
      id: 12,
      label: "sideways",
      stocks: { annualReturn: 0.03, annualVolatility: 0.1 },
      bonds: { annualReturn: 0.03, annualVolatility: 0.06 },
      correlation: 0.15,
    },
  ],
  transitionMatrix: [
    [0.7, 0.2, 0.1],
    [0.03, 0.92, 0.05],
    [0.08, 0.12, 0.8],
  ],
  currentStateProbabilities: [0.1, 0.75, 0.15],
  history: [
    { date: "2025-01", normalizedPrice: 100, state: "bull" },
    { date: "2025-04", normalizedPrice: 95, state: "bear" },
  ],
};

describe("HMM model payload", () => {
  it("maps transitions and probabilities by state label, not array position", () => {
    const configuration = createHMMConfiguration(
      parseHMMModelPayload(PAYLOAD),
    );

    expect(configuration.currentStateProbabilities).toEqual({
      bull: 0.75,
      bear: 0.1,
      sideways: 0.15,
    });
    expect(configuration.transitionMatrix.bull).toEqual({
      bull: 0.92,
      bear: 0.03,
      sideways: 0.05,
    });
    expect(configuration.transitionMatrix.bear).toEqual({
      bull: 0.2,
      bear: 0.7,
      sideways: 0.1,
    });
  });

  it("rejects malformed state sets and matrix dimensions", () => {
    const duplicateState = {
      ...PAYLOAD,
      states: [
        PAYLOAD.states[0],
        { ...PAYLOAD.states[1], label: "bear" },
        PAYLOAD.states[2],
      ],
    };
    const shortMatrix = {
      ...PAYLOAD,
      transitionMatrix: PAYLOAD.transitionMatrix.slice(0, 2),
    };

    expect(() => parseHMMModelPayload(duplicateState)).toThrow(
      "exactly one bull, bear, and sideways state",
    );
    expect(() => parseHMMModelPayload(shortMatrix)).toThrow(
      "transitionMatrix must have 3 rows",
    );
  });
});
