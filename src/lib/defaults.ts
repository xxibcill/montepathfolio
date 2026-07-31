import type { SimulationInputs } from "../types/simulation";

export const DEFAULT_INPUTS: SimulationInputs = {
  initialCapital: 50_000,
  monthlyContribution: 1_000,
  horizonYears: 25,
  stockAllocation: 0.7,
  stocks: {
    expectedReturn: 0.085,
    volatility: 0.18,
  },
  bonds: {
    expectedReturn: 0.04,
    volatility: 0.07,
  },
  correlation: 0.15,
  rebalanceFrequency: "annual",
  inflationRate: 0.025,
  targetValue: 1_000_000,
  pathCount: 1_000,
  seed: 8_291,
};

export const STORAGE_KEY = "pathfolio-risk-sandbox-v1";

export function loadStoredInputs(): SimulationInputs {
  if (typeof window === "undefined") {
    return DEFAULT_INPUTS;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_INPUTS;
    }

    const parsed = JSON.parse(stored) as Partial<SimulationInputs>;
    return {
      ...DEFAULT_INPUTS,
      ...parsed,
      stocks: { ...DEFAULT_INPUTS.stocks, ...parsed.stocks },
      bonds: { ...DEFAULT_INPUTS.bonds, ...parsed.bonds },
      pathCount: 1_000,
      seed: DEFAULT_INPUTS.seed,
    };
  } catch {
    return DEFAULT_INPUTS;
  }
}
