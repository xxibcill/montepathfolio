import hmmModel from "../data/hmm-model.json";
import type {
  HMMConfiguration,
  Regime,
  SimulationInputs,
} from "../types/simulation";

export const REGIME_ORDER = ["bull", "bear", "sideways"] as const;

function loadDefaultHMMConfiguration(): HMMConfiguration {
  const regimes = Object.fromEntries(
    hmmModel.states.map((state) => [
      state.label,
      {
        stocks: {
          expectedReturn: state.stocks.annualReturn,
          volatility: state.stocks.annualVolatility,
        },
        bonds: {
          expectedReturn: state.bonds.annualReturn,
          volatility: state.bonds.annualVolatility,
        },
        correlation: state.correlation,
      },
    ]),
  ) as HMMConfiguration["regimes"];
  const transitionMatrix = Object.fromEntries(
    REGIME_ORDER.map((fromRegime, rowIndex) => [
      fromRegime,
      Object.fromEntries(
        REGIME_ORDER.map((toRegime, columnIndex) => [
          toRegime,
          hmmModel.transitionMatrix[rowIndex][columnIndex],
        ]),
      ),
    ]),
  ) as HMMConfiguration["transitionMatrix"];
  const currentStateProbabilities = Object.fromEntries(
    REGIME_ORDER.map((regime, index) => [
      regime,
      hmmModel.currentStateProbabilities[index],
    ]),
  ) as HMMConfiguration["currentStateProbabilities"];

  return { regimes, transitionMatrix, currentStateProbabilities };
}

export const DEFAULT_HMM_CONFIGURATION = loadDefaultHMMConfiguration();

export const DEFAULT_INPUTS: SimulationInputs = {
  initialCapital: 50_000,
  monthlyContribution: 1_000,
  horizonYears: 25,
  stockAllocation: 0.7,
  model: "hmm",
  stocks: {
    expectedReturn: 0.085,
    volatility: 0.18,
  },
  bonds: {
    expectedReturn: 0.04,
    volatility: 0.07,
  },
  correlation: 0.15,
  hmm: DEFAULT_HMM_CONFIGURATION,
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
    const storedHMM = parsed.hmm;
    const regimes = Object.fromEntries(
      REGIME_ORDER.map((regime) => [
        regime,
        {
          stocks: {
            ...DEFAULT_HMM_CONFIGURATION.regimes[regime].stocks,
            ...storedHMM?.regimes?.[regime]?.stocks,
          },
          bonds: {
            ...DEFAULT_HMM_CONFIGURATION.regimes[regime].bonds,
            ...storedHMM?.regimes?.[regime]?.bonds,
          },
          correlation:
            storedHMM?.regimes?.[regime]?.correlation ??
            DEFAULT_HMM_CONFIGURATION.regimes[regime].correlation,
        },
      ]),
    ) as Record<Regime, HMMConfiguration["regimes"][Regime]>;

    return {
      ...DEFAULT_INPUTS,
      ...parsed,
      stocks: { ...DEFAULT_INPUTS.stocks, ...parsed.stocks },
      bonds: { ...DEFAULT_INPUTS.bonds, ...parsed.bonds },
      hmm: {
        regimes,
        transitionMatrix: Object.fromEntries(
          REGIME_ORDER.map((regime) => [
            regime,
            {
              ...DEFAULT_HMM_CONFIGURATION.transitionMatrix[regime],
              ...storedHMM?.transitionMatrix?.[regime],
            },
          ]),
        ) as HMMConfiguration["transitionMatrix"],
        currentStateProbabilities: {
          ...DEFAULT_HMM_CONFIGURATION.currentStateProbabilities,
          ...storedHMM?.currentStateProbabilities,
        },
      },
      pathCount: 1_000,
      seed: DEFAULT_INPUTS.seed,
    };
  } catch {
    return DEFAULT_INPUTS;
  }
}
