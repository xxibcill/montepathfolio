import type {
  HMMHistoryObservation,
  HMMModelAssetState,
  HMMModelMetadata,
  HMMModelPayload,
  HMMModelState,
  ThreeStateMatrix,
  ThreeStateVector,
} from "../types/hmm-model";
import type {
  HMMConfiguration,
  MarketAssumptions,
  Regime,
} from "../types/simulation";
import { REGIME_ORDER } from "./regimes";

const STATE_COUNT = REGIME_ORDER.length;
const DISTRIBUTION_TOLERANCE = 1e-8;

export function parseHMMModelPayload(value: unknown): HMMModelPayload {
  const payload = requireRecord(value, "HMM model payload");
  const states = parseStates(payload.states);
  const transitionMatrix = parseProbabilityMatrix(
    payload.transitionMatrix,
    "transitionMatrix",
  );
  const currentStateProbabilities = parseProbabilityVector(
    payload.currentStateProbabilities,
    "currentStateProbabilities",
  );

  return {
    metadata: parseMetadata(payload.metadata),
    states,
    transitionMatrix,
    currentStateProbabilities,
    history:
      payload.history === undefined ? undefined : parseHistory(payload.history),
  };
}

export function createHMMConfiguration(
  payload: HMMModelPayload,
): HMMConfiguration {
  const stateIndex = (regime: Regime) =>
    payload.states.findIndex((state) => state.label === regime);
  const state = (regime: Regime) => payload.states[stateIndex(regime)];
  const probability = (from: Regime, to: Regime) =>
    payload.transitionMatrix[stateIndex(from)][stateIndex(to)];
  const currentProbability = (regime: Regime) =>
    payload.currentStateProbabilities[stateIndex(regime)];

  return {
    regimes: {
      bull: toMarketAssumptions(state("bull")),
      bear: toMarketAssumptions(state("bear")),
      sideways: toMarketAssumptions(state("sideways")),
    },
    transitionMatrix: {
      bull: {
        bull: probability("bull", "bull"),
        bear: probability("bull", "bear"),
        sideways: probability("bull", "sideways"),
      },
      bear: {
        bull: probability("bear", "bull"),
        bear: probability("bear", "bear"),
        sideways: probability("bear", "sideways"),
      },
      sideways: {
        bull: probability("sideways", "bull"),
        bear: probability("sideways", "bear"),
        sideways: probability("sideways", "sideways"),
      },
    },
    currentStateProbabilities: {
      bull: currentProbability("bull"),
      bear: currentProbability("bear"),
      sideways: currentProbability("sideways"),
    },
  };
}

function parseMetadata(value: unknown): HMMModelMetadata {
  const metadata = requireRecord(value, "metadata");

  return {
    name: requireString(metadata.name, "metadata.name"),
    observationFrequency: requireString(
      metadata.observationFrequency,
      "metadata.observationFrequency",
    ),
    features: requireStringArray(metadata.features, "metadata.features"),
    calibration: requireString(metadata.calibration, "metadata.calibration"),
  };
}

function parseStates(
  value: unknown,
): [HMMModelState, HMMModelState, HMMModelState] {
  const states = requireFixedArray(value, "states", "entries").map(
    (state, index) => parseState(state, index),
  ) as [HMMModelState, HMMModelState, HMMModelState];
  const labels = new Set(states.map((state) => state.label));
  const ids = new Set(states.map((state) => state.id));

  if (
    labels.size !== STATE_COUNT ||
    !REGIME_ORDER.every((regime) => labels.has(regime))
  ) {
    throw new Error("states must contain exactly one bull, bear, and sideways state");
  }
  if (ids.size !== STATE_COUNT) {
    throw new Error("state ids must be unique");
  }

  return states;
}

function parseState(value: unknown, index: number): HMMModelState {
  const name = `states[${index}]`;
  const state = requireRecord(value, name);

  return {
    id: requireInteger(state.id, `${name}.id`),
    label: requireRegime(state.label, `${name}.label`),
    stocks: parseAssetState(state.stocks, `${name}.stocks`),
    bonds: parseAssetState(state.bonds, `${name}.bonds`),
    correlation: requireNumberInRange(
      state.correlation,
      `${name}.correlation`,
      -1,
      1,
    ),
  };
}

function parseAssetState(
  value: unknown,
  name: string,
): HMMModelAssetState {
  const asset = requireRecord(value, name);

  return {
    annualReturn: requireFiniteNumber(
      asset.annualReturn,
      `${name}.annualReturn`,
    ),
    annualVolatility: requireNumberInRange(
      asset.annualVolatility,
      `${name}.annualVolatility`,
      0,
      Number.POSITIVE_INFINITY,
    ),
  };
}

function parseProbabilityMatrix(
  value: unknown,
  name: string,
): ThreeStateMatrix {
  const rows = requireFixedArray(value, name, "rows");

  return rows.map((row, index) =>
    parseProbabilityVector(row, `${name}[${index}]`),
  ) as ThreeStateMatrix;
}

function parseProbabilityVector(
  value: unknown,
  name: string,
): ThreeStateVector {
  const probabilities = requireFixedArray(value, name, "entries").map(
    (probability, index) =>
      requireNumberInRange(probability, `${name}[${index}]`, 0, 1),
  ) as ThreeStateVector;
  const total = probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );

  if (Math.abs(total - 1) > DISTRIBUTION_TOLERANCE) {
    throw new Error(`${name} probabilities must sum to 1`);
  }

  return probabilities;
}

function parseHistory(value: unknown): HMMHistoryObservation[] {
  if (!Array.isArray(value)) {
    throw new Error("history must be an array");
  }

  return value.map((entry, index) => {
    const name = `history[${index}]`;
    const observation = requireRecord(entry, name);

    return {
      date: requireString(observation.date, `${name}.date`),
      normalizedPrice: requireNumberInRange(
        observation.normalizedPrice,
        `${name}.normalizedPrice`,
        0,
        Number.POSITIVE_INFINITY,
      ),
      state: requireRegime(observation.state, `${name}.state`),
    };
  });
}

function toMarketAssumptions(state: HMMModelState): MarketAssumptions {
  return {
    stocks: {
      expectedReturn: state.stocks.annualReturn,
      volatility: state.stocks.annualVolatility,
    },
    bonds: {
      expectedReturn: state.bonds.annualReturn,
      volatility: state.bonds.annualVolatility,
    },
    correlation: state.correlation,
  };
}

function requireFixedArray(
  value: unknown,
  name: string,
  itemName: string,
): unknown[] {
  if (!Array.isArray(value) || value.length !== STATE_COUNT) {
    throw new Error(`${name} must have ${STATE_COUNT} ${itemName}`);
  }

  return value;
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requireString(item, `${name}[${index}]`),
  );
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }

  return value;
}

function requireInteger(value: unknown, name: string): number {
  const number = requireFiniteNumber(value, name);
  if (!Number.isInteger(number)) {
    throw new Error(`${name} must be an integer`);
  }

  return number;
}

function requireNumberInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const number = requireFiniteNumber(value, name);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }

  return number;
}

function requireRegime(value: unknown, name: string): Regime {
  if (
    typeof value !== "string" ||
    !REGIME_ORDER.includes(value as Regime)
  ) {
    throw new Error(`${name} must be bull, bear, or sideways`);
  }

  return value as Regime;
}
