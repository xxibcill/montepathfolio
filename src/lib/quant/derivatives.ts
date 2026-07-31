/**
 * Derivatives laboratory.
 *
 * This module intentionally keeps the contracts and the intermediate values
 * visible.  It is meant to be read alongside a lesson: prices, payoffs, P&L,
 * hedge ratios, tree continuation values, and sampling uncertainty are
 * separate concepts rather than one opaque "option value".
 *
 * Conventions used throughout:
 * - rates, dividend yields, and volatilities are annual decimal values;
 * - rates and dividend yields are continuously compounded;
 * - one contract represents one unit of the underlying;
 * - theta is the value change for one year of calendar time passing;
 * - vega and rho are for a 1.00 change (the result also reports 1% versions);
 * - Monte Carlo payoffs are paid and discounted at maturity.
 */

import {
  QuantError,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  cholesky,
  createSemanticRandom,
  mean,
  normalCdf,
  normalPdf,
  quantile,
  sampleVariance,
  type ModelEnvelope,
  type ModelWarning,
} from "./core";

export const DERIVATIVES_ENGINE_VERSION = "derivatives-lab@1";

export const BLACK_SCHOLES_REQUEST_CONTRACT =
  "derivatives/black-scholes-request@1" as const;
export const BLACK_SCHOLES_RESULT_CONTRACT =
  "derivatives/black-scholes-result@1" as const;
export const PAYOFF_DIAGRAM_REQUEST_CONTRACT =
  "derivatives/payoff-diagram-request@1" as const;
export const PAYOFF_DIAGRAM_RESULT_CONTRACT =
  "derivatives/payoff-diagram-result@1" as const;
export const BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT =
  "derivatives/black-scholes-surface-request@1" as const;
export const BLACK_SCHOLES_SURFACE_RESULT_CONTRACT =
  "derivatives/black-scholes-surface-result@1" as const;
export const BINOMIAL_TREE_REQUEST_CONTRACT =
  "derivatives/crr-tree-request@1" as const;
export const BINOMIAL_TREE_RESULT_CONTRACT =
  "derivatives/crr-tree-result@1" as const;
export const MONTE_CARLO_REQUEST_CONTRACT =
  "derivatives/monte-carlo-request@1" as const;
export const MONTE_CARLO_RESULT_CONTRACT =
  "derivatives/monte-carlo-result@1" as const;
export const EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT =
  "derivatives/european-pricing-comparison-request@1" as const;
export const EUROPEAN_PRICING_COMPARISON_RESULT_CONTRACT =
  "derivatives/european-pricing-comparison-result@1" as const;
export const HESTON_REQUEST_CONTRACT =
  "derivatives/heston-request@1" as const;
export const HESTON_RESULT_CONTRACT =
  "derivatives/heston-result@1" as const;
export const OPTION_STRATEGY_CONTRACT =
  "derivatives/option-strategy@1" as const;
export const STRATEGY_VALUATION_REQUEST_CONTRACT =
  "derivatives/strategy-valuation-request@1" as const;
export const STRATEGY_VALUATION_RESULT_CONTRACT =
  "derivatives/strategy-valuation-result@1" as const;

const MAX_SURFACE_CELLS = 50_000;
const MAX_TREE_STEPS = 2_000;
const MAX_STORED_TREE_NODES = 20_000;
const MAX_MONTE_CARLO_WORK = 10_000_000;
const MAX_SAMPLE_PATHS = 12;
const NORMAL_95 = 1.959963984540054;

/** Public limits let a UI explain a rejected request before doing any work. */
export const DERIVATIVES_RESOURCE_LIMITS = {
  maximumSurfaceCells: MAX_SURFACE_CELLS,
  maximumTreeSteps: MAX_TREE_STEPS,
  maximumStoredTreeNodes: MAX_STORED_TREE_NODES,
  maximumMonteCarloAssetSteps: MAX_MONTE_CARLO_WORK,
  maximumRetainedSamplePaths: MAX_SAMPLE_PATHS,
} as const;

export type OptionType = "call" | "put";
export type PositionSide = "long" | "short";

export interface LearningNote {
  readonly title: string;
  readonly summary: string;
  readonly formula: string;
  readonly conventions: readonly string[];
}

export interface EuropeanOptionInputs {
  readonly optionType: OptionType;
  readonly spot: number;
  readonly strike: number;
  readonly timeToMaturityYears: number;
  readonly riskFreeRate: number;
  readonly volatility: number;
  readonly dividendYield: number;
}

export interface BlackScholesRequest extends EuropeanOptionInputs {
  readonly contract: typeof BLACK_SCHOLES_REQUEST_CONTRACT;
}

export interface OptionGreeks {
  /** Change in value for a one-unit spot move. */
  readonly delta: number;
  /** Change in delta for a one-unit spot move. */
  readonly gamma: number;
  /** Change in value for a 1.00 absolute volatility move. */
  readonly vega: number;
  /** Change in value for one year of calendar time passing. */
  readonly theta: number;
  /** Change in value for a 1.00 absolute rate move. */
  readonly rho: number;
  readonly vegaPerVolatilityPoint: number;
  readonly thetaPerDay: number;
  readonly rhoPerRatePoint: number;
}

export interface BlackScholesResult {
  readonly contract: typeof BLACK_SCHOLES_RESULT_CONTRACT;
  readonly optionType: OptionType;
  readonly price: number;
  readonly intrinsicValue: number;
  readonly noArbitrageBounds: {
    readonly lower: number;
    readonly upper: number;
  };
  readonly forwardPrice: number;
  readonly discountFactors: {
    readonly riskFree: number;
    readonly dividend: number;
  };
  /** Null in an expiry or zero-volatility limiting case. */
  readonly d1: number | null;
  /** Null in an expiry or zero-volatility limiting case. */
  readonly d2: number | null;
  readonly greeks: OptionGreeks;
  readonly lesson: LearningNote;
}

/** Price a European call or put under Black-Scholes-Merton. */
export function priceBlackScholes(
  request: BlackScholesRequest,
): ModelEnvelope<BlackScholesResult> {
  assertContract(
    request.contract,
    BLACK_SCHOLES_REQUEST_CONTRACT,
    "Black-Scholes request",
  );
  const result = evaluateBlackScholes(request);
  return envelope(
    result,
    request.contract,
    BLACK_SCHOLES_RESULT_CONTRACT,
    undefined,
    limitingWarnings(request),
  );
}

/** A compact alias that reads naturally in educational examples. */
export const blackScholes = priceBlackScholes;

/**
 * Validated, contract-free Black-Scholes evaluator for models that use a
 * European option as a building block (for example Merton structural credit).
 */
export function evaluateBlackScholes(
  inputs: EuropeanOptionInputs,
): BlackScholesResult {
  validateEuropeanInputs(inputs);
  return blackScholesKernel(inputs);
}

function blackScholesKernel(inputs: EuropeanOptionInputs): BlackScholesResult {
  const {
    optionType,
    spot,
    strike,
    timeToMaturityYears: time,
    riskFreeRate: rate,
    volatility,
    dividendYield,
  } = inputs;
  const riskFreeDiscount = Math.exp(-rate * time);
  const dividendDiscount = Math.exp(-dividendYield * time);
  const discountedSpot = spot * dividendDiscount;
  const discountedStrike = strike * riskFreeDiscount;
  const forwardPrice = spot * Math.exp((rate - dividendYield) * time);
  const intrinsicValue = optionPayoff(optionType, spot, strike);
  const lower =
    optionType === "call"
      ? Math.max(0, discountedSpot - discountedStrike)
      : Math.max(0, discountedStrike - discountedSpot);
  const upper =
    optionType === "call" ? discountedSpot : discountedStrike;

  if (time === 0) {
    const delta = expiryDelta(optionType, spot, strike);
    return {
      contract: BLACK_SCHOLES_RESULT_CONTRACT,
      optionType,
      price: intrinsicValue,
      intrinsicValue,
      noArbitrageBounds: { lower: intrinsicValue, upper: intrinsicValue },
      forwardPrice: spot,
      discountFactors: { riskFree: 1, dividend: 1 },
      d1: null,
      d2: null,
      greeks: makeGreeks(delta, 0, 0, 0, 0),
      lesson: blackScholesLesson(),
    };
  }

  if (volatility === 0) {
    const forwardInTheMoney =
      optionType === "call" ? forwardPrice > strike : forwardPrice < strike;
    const atBoundary = forwardPrice === strike;
    const direction = optionType === "call" ? 1 : -1;
    const activeWeight = forwardInTheMoney ? 1 : atBoundary ? 0.5 : 0;
    const delta = direction * dividendDiscount * activeWeight;
    const rho =
      direction * strike * time * riskFreeDiscount * activeWeight;
    const theta =
      direction *
      (dividendYield * discountedSpot - rate * discountedStrike) *
      activeWeight;
    return {
      contract: BLACK_SCHOLES_RESULT_CONTRACT,
      optionType,
      price: lower,
      intrinsicValue,
      noArbitrageBounds: { lower, upper },
      forwardPrice,
      discountFactors: {
        riskFree: riskFreeDiscount,
        dividend: dividendDiscount,
      },
      d1: null,
      d2: null,
      greeks: makeGreeks(delta, 0, 0, theta, rho),
      lesson: blackScholesLesson(),
    };
  }

  const volatilityTime = volatility * Math.sqrt(time);
  const d1 =
    (Math.log(spot / strike) +
      (rate - dividendYield + 0.5 * volatility ** 2) * time) /
    volatilityTime;
  const d2 = d1 - volatilityTime;
  const density = normalPdf(d1);
  const commonGamma =
    (dividendDiscount * density) / (spot * volatilityTime);
  const vega = spot * dividendDiscount * density * Math.sqrt(time);

  let price: number;
  let delta: number;
  let theta: number;
  let rho: number;
  if (optionType === "call") {
    price =
      discountedSpot * normalCdf(d1) -
      discountedStrike * normalCdf(d2);
    delta = dividendDiscount * normalCdf(d1);
    theta =
      (-spot * dividendDiscount * density * volatility) /
        (2 * Math.sqrt(time)) -
      rate * discountedStrike * normalCdf(d2) +
      dividendYield * discountedSpot * normalCdf(d1);
    rho = strike * time * riskFreeDiscount * normalCdf(d2);
  } else {
    price =
      discountedStrike * normalCdf(-d2) -
      discountedSpot * normalCdf(-d1);
    delta = dividendDiscount * (normalCdf(d1) - 1);
    theta =
      (-spot * dividendDiscount * density * volatility) /
        (2 * Math.sqrt(time)) +
      rate * discountedStrike * normalCdf(-d2) -
      dividendYield * discountedSpot * normalCdf(-d1);
    rho = -strike * time * riskFreeDiscount * normalCdf(-d2);
  }

  return {
    contract: BLACK_SCHOLES_RESULT_CONTRACT,
    optionType,
    price,
    intrinsicValue,
    noArbitrageBounds: { lower, upper },
    forwardPrice,
    discountFactors: {
      riskFree: riskFreeDiscount,
      dividend: dividendDiscount,
    },
    d1,
    d2,
    greeks: makeGreeks(delta, commonGamma, vega, theta, rho),
    lesson: blackScholesLesson(),
  };
}

function makeGreeks(
  delta: number,
  gamma: number,
  vega: number,
  theta: number,
  rho: number,
): OptionGreeks {
  return {
    delta,
    gamma,
    vega,
    theta,
    rho,
    vegaPerVolatilityPoint: vega / 100,
    thetaPerDay: theta / 365,
    rhoPerRatePoint: rho / 100,
  };
}

function blackScholesLesson(): LearningNote {
  return {
    title: "Black-Scholes-Merton European option value",
    summary:
      "The model value is the discounted risk-neutral expected payoff; it is not the payoff or the trade's profit.",
    formula:
      "Call = S·e^(-qT)·N(d1) - K·e^(-rT)·N(d2); put follows put-call parity.",
    conventions: [
      "r and q are continuously compounded annual decimal rates.",
      "Volatility is an annual decimal standard deviation.",
      "The option is European and can be exercised only at maturity.",
    ],
  };
}

export function optionPayoff(
  optionType: OptionType,
  terminalSpot: number,
  strike: number,
): number {
  validateOptionType(optionType, "optionType");
  assertNonNegative(terminalSpot, "terminalSpot");
  assertPositive(strike, "strike");
  return optionType === "call"
    ? Math.max(terminalSpot - strike, 0)
    : Math.max(strike - terminalSpot, 0);
}

export interface PayoffDiagramRequest {
  readonly contract: typeof PAYOFF_DIAGRAM_REQUEST_CONTRACT;
  readonly optionType: OptionType;
  readonly strike: number;
  readonly premium: number;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly terminalSpots: readonly number[];
}

export interface PayoffDiagramPoint {
  readonly terminalSpot: number;
  /** Expiry option cash flow after applying side and quantity. */
  readonly payoff: number;
  /** Payoff less the signed initial premium; financing is not included. */
  readonly profitLoss: number;
}

export interface PayoffDiagramResult {
  readonly contract: typeof PAYOFF_DIAGRAM_RESULT_CONTRACT;
  readonly points: readonly PayoffDiagramPoint[];
  readonly breakEvenSpots: readonly number[];
  readonly lesson: LearningNote;
}

export function buildPayoffDiagram(
  request: PayoffDiagramRequest,
): ModelEnvelope<PayoffDiagramResult> {
  assertContract(
    request.contract,
    PAYOFF_DIAGRAM_REQUEST_CONTRACT,
    "payoff diagram request",
  );
  validateOptionType(request.optionType, "optionType");
  assertPositive(request.strike, "strike");
  assertNonNegative(request.premium, "premium");
  validateSide(request.side, "side");
  assertPositive(request.quantity, "quantity");
  validateNumberArray(request.terminalSpots, "terminalSpots", 1, 2_000, false);
  const sign = request.side === "long" ? 1 : -1;
  const points = request.terminalSpots.map((terminalSpot) => {
    assertNonNegative(terminalSpot, "terminalSpots");
    const unsignedPayoff = optionPayoff(
      request.optionType,
      terminalSpot,
      request.strike,
    );
    return {
      terminalSpot,
      payoff: sign * request.quantity * unsignedPayoff,
      profitLoss:
        sign * request.quantity * (unsignedPayoff - request.premium),
    };
  });
  const breakEvenSpots = [
    request.optionType === "call"
      ? request.strike + request.premium
      : Math.max(0, request.strike - request.premium),
  ];
  const result: PayoffDiagramResult = {
    contract: PAYOFF_DIAGRAM_RESULT_CONTRACT,
    points,
    breakEvenSpots,
    lesson: {
      title: "Payoff and profit/loss are different",
      summary:
        "Payoff is the expiry cash flow. P&L also includes the premium paid (long) or received (short).",
      formula: "Long P&L = quantity × (payoff − premium); short P&L has the opposite sign.",
      conventions: ["Premium financing and transaction costs are excluded."],
    },
  };
  return envelope(
    result,
    request.contract,
    PAYOFF_DIAGRAM_RESULT_CONTRACT,
  );
}

export interface BlackScholesSurfaceRequest {
  readonly contract: typeof BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT;
  readonly optionType: OptionType;
  readonly strike: number;
  readonly riskFreeRate: number;
  readonly dividendYield: number;
  readonly axes: {
    readonly spots: readonly number[];
    readonly volatilities: readonly number[];
    readonly timesToMaturityYears: readonly number[];
  };
}

export interface BlackScholesSurfaceCell {
  readonly spot: number;
  readonly volatility: number;
  readonly timeToMaturityYears: number;
  readonly price: number;
  readonly greeks: OptionGreeks;
}

export interface BlackScholesSurfaceResult {
  readonly contract: typeof BLACK_SCHOLES_SURFACE_RESULT_CONTRACT;
  readonly shape: readonly [number, number, number];
  /** Spot is the outer dimension, then volatility, then time. */
  readonly cells: readonly BlackScholesSurfaceCell[];
  readonly lesson: LearningNote;
}

export function buildBlackScholesSurface(
  request: BlackScholesSurfaceRequest,
): ModelEnvelope<BlackScholesSurfaceResult> {
  assertContract(
    request.contract,
    BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT,
    "Black-Scholes surface request",
  );
  validateOptionType(request.optionType, "optionType");
  assertPositive(request.strike, "strike");
  assertFinite(request.riskFreeRate, "riskFreeRate");
  assertFinite(request.dividendYield, "dividendYield");
  validateNumberArray(request.axes.spots, "axes.spots", 1, 200, true);
  validateNumberArray(
    request.axes.volatilities,
    "axes.volatilities",
    1,
    200,
    false,
  );
  validateNumberArray(
    request.axes.timesToMaturityYears,
    "axes.timesToMaturityYears",
    1,
    200,
    false,
  );
  const cellCount =
    request.axes.spots.length *
    request.axes.volatilities.length *
    request.axes.timesToMaturityYears.length;
  if (cellCount > MAX_SURFACE_CELLS) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `A surface is limited to ${MAX_SURFACE_CELLS.toLocaleString()} cells.`,
      "axes",
    );
  }

  const cells: BlackScholesSurfaceCell[] = [];
  for (const spot of request.axes.spots) {
    for (const volatility of request.axes.volatilities) {
      for (const timeToMaturityYears of request.axes.timesToMaturityYears) {
        const value = blackScholesKernel({
          optionType: request.optionType,
          spot,
          strike: request.strike,
          riskFreeRate: request.riskFreeRate,
          dividendYield: request.dividendYield,
          volatility,
          timeToMaturityYears,
        });
        cells.push({
          spot,
          volatility,
          timeToMaturityYears,
          price: value.price,
          greeks: value.greeks,
        });
      }
    }
  }
  const result: BlackScholesSurfaceResult = {
    contract: BLACK_SCHOLES_SURFACE_RESULT_CONTRACT,
    shape: [
      request.axes.spots.length,
      request.axes.volatilities.length,
      request.axes.timesToMaturityYears.length,
    ],
    cells,
    lesson: {
      title: "A sensitivity surface",
      summary:
        "Holding strike and rates fixed exposes how price and hedge sensitivities bend across spot, volatility, and remaining time.",
      formula: "Each cell evaluates the same Black-Scholes formula with only its three axis inputs changed.",
      conventions: ["Cells are ordered spot → volatility → time."],
    },
  };
  return envelope(
    result,
    request.contract,
    BLACK_SCHOLES_SURFACE_RESULT_CONTRACT,
  );
}

export type ExerciseStyle = "european" | "american";

export interface BinomialTreeRequest extends EuropeanOptionInputs {
  readonly contract: typeof BINOMIAL_TREE_REQUEST_CONTRACT;
  readonly exerciseStyle: ExerciseStyle;
  readonly steps: number;
  readonly nodeData?: {
    /** Small trees default to true; large trees default to false. */
    readonly include: boolean;
    /** A caller-controlled guard, also capped by the engine maximum. */
    readonly maxNodes?: number;
  };
}

export interface BinomialNode {
  readonly step: number;
  readonly upMoves: number;
  readonly spot: number;
  readonly intrinsicValue: number;
  readonly continuationValue: number | null;
  readonly optionValue: number;
  readonly earlyExercise: boolean;
}

export interface EarlyExerciseBoundary {
  readonly step: number;
  readonly timeYears: number;
  readonly exercisedNodeCount: number;
  readonly minimumExercisedSpot: number | null;
  readonly maximumExercisedSpot: number | null;
}

export interface BinomialTreeResult {
  readonly contract: typeof BINOMIAL_TREE_RESULT_CONTRACT;
  readonly price: number;
  readonly parameters: {
    readonly stepYears: number;
    readonly upFactor: number;
    readonly downFactor: number;
    readonly riskNeutralUpProbability: number;
    readonly discountPerStep: number;
  };
  readonly rootDelta: number;
  readonly rootGamma: number | null;
  readonly rootTheta: number | null;
  readonly earlyExerciseBoundary: readonly EarlyExerciseBoundary[];
  /** Empty when node storage was not requested. */
  readonly nodes: readonly BinomialNode[];
  readonly nodeDataOmitted: boolean;
  readonly nodeDataBounds: {
    readonly totalNodeCount: number;
    readonly storedNodeCount: number;
    readonly requestedMaximumNodeCount: number;
    readonly engineMaximumNodeCount: number;
  };
  readonly lesson: LearningNote;
}

/** Cox-Ross-Rubinstein backward induction for European and American options. */
export function priceBinomialTree(
  request: BinomialTreeRequest,
): ModelEnvelope<BinomialTreeResult> {
  assertContract(
    request.contract,
    BINOMIAL_TREE_REQUEST_CONTRACT,
    "CRR tree request",
  );
  validateEuropeanInputs(request);
  if (request.timeToMaturityYears === 0) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "A binomial tree needs positive time to maturity; use the expiry payoff for T = 0.",
      "timeToMaturityYears",
    );
  }
  assertPositive(request.volatility, "volatility");
  validateExerciseStyle(request.exerciseStyle);
  assertIntegerInRange(request.steps, 1, MAX_TREE_STEPS, "steps");

  const totalNodes = ((request.steps + 1) * (request.steps + 2)) / 2;
  const includeNodes = request.nodeData?.include ?? totalNodes <= 2_000;
  const requestedNodeLimit = request.nodeData?.maxNodes ?? MAX_STORED_TREE_NODES;
  assertIntegerInRange(
    requestedNodeLimit,
    1,
    MAX_STORED_TREE_NODES,
    "nodeData.maxNodes",
  );
  if (includeNodes && totalNodes > requestedNodeLimit) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `Storing this tree needs ${totalNodes.toLocaleString()} nodes, above the requested ${requestedNodeLimit.toLocaleString()}-node limit. Turn node data off or use fewer steps.`,
      "nodeData",
    );
  }

  const dt = request.timeToMaturityYears / request.steps;
  const up = Math.exp(request.volatility * Math.sqrt(dt));
  const down = 1 / up;
  const growth = Math.exp(
    (request.riskFreeRate - request.dividendYield) * dt,
  );
  const probability = (growth - down) / (up - down);
  if (probability < 0 || probability > 1 || !Number.isFinite(probability)) {
    throw new QuantError(
      "INVALID_INPUT",
      "The CRR step size implies a risk-neutral probability outside [0, 1]. Increase the step count or review rate, yield, and volatility inputs.",
      "steps",
    );
  }
  const discount = Math.exp(-request.riskFreeRate * dt);
  const spotLayers: number[][] | null = includeNodes ? [] : null;
  const valueLayers: number[][] | null = includeNodes ? [] : null;
  const continuationLayers: (number | null)[][] | null = includeNodes
    ? []
    : null;
  const exerciseLayers: boolean[][] | null = includeNodes ? [] : null;

  const terminalSpots = Array.from({ length: request.steps + 1 }, (_, upMoves) =>
    treeSpot(request.spot, up, down, request.steps, upMoves),
  );
  let values = terminalSpots.map((spot) =>
    optionPayoff(request.optionType, spot, request.strike),
  );
  if (includeNodes) {
    spotLayers![request.steps] = terminalSpots;
    valueLayers![request.steps] = [...values];
    continuationLayers![request.steps] = values.map(() => null);
    exerciseLayers![request.steps] = values.map(() => false);
  }

  const boundaries: EarlyExerciseBoundary[] = Array.from(
    { length: request.steps },
    (_, step) => ({
      step,
      timeYears: step * dt,
      exercisedNodeCount: 0,
      minimumExercisedSpot: null,
      maximumExercisedSpot: null,
    }),
  );
  let layerOneValues: number[] | null =
    request.steps === 1 ? [...values] : null;
  let layerOneSpots: number[] | null =
    request.steps === 1 ? [...terminalSpots] : null;
  let layerTwoValues: number[] | null =
    request.steps === 2 ? [...values] : null;

  for (let step = request.steps - 1; step >= 0; step -= 1) {
    const spots = Array.from({ length: step + 1 }, (_, upMoves) =>
      treeSpot(request.spot, up, down, step, upMoves),
    );
    const continuations = Array.from({ length: step + 1 }, (_, upMoves) =>
      discount *
      (probability * values[upMoves + 1] +
        (1 - probability) * values[upMoves]),
    );
    const exercised = continuations.map(() => false);
    const nextValues = continuations.map((continuation, upMoves) => {
      const intrinsic = optionPayoff(
        request.optionType,
        spots[upMoves],
        request.strike,
      );
      if (
        request.exerciseStyle === "american" &&
        intrinsic > continuation + 1e-12 &&
        intrinsic > 0
      ) {
        exercised[upMoves] = true;
        return intrinsic;
      }
      return continuation;
    });
    const exercisedSpots = spots.filter((_, index) => exercised[index]);
    boundaries[step] = {
      step,
      timeYears: step * dt,
      exercisedNodeCount: exercisedSpots.length,
      minimumExercisedSpot:
        exercisedSpots.length === 0 ? null : Math.min(...exercisedSpots),
      maximumExercisedSpot:
        exercisedSpots.length === 0 ? null : Math.max(...exercisedSpots),
    };
    if (step === 2) layerTwoValues = [...nextValues];
    if (step === 1) {
      layerOneValues = [...nextValues];
      layerOneSpots = [...spots];
    }
    if (includeNodes) {
      spotLayers![step] = spots;
      valueLayers![step] = [...nextValues];
      continuationLayers![step] = continuations;
      exerciseLayers![step] = exercised;
    }
    values = nextValues;
  }

  const rootDelta =
    layerOneValues !== null && layerOneSpots !== null
      ? (layerOneValues[1] - layerOneValues[0]) /
        (layerOneSpots[1] - layerOneSpots[0])
      : expiryDelta(request.optionType, request.spot, request.strike);
  let rootGamma: number | null = null;
  let rootTheta: number | null = null;
  if (layerTwoValues !== null) {
    const downDown = treeSpot(request.spot, up, down, 2, 0);
    const middle = treeSpot(request.spot, up, down, 2, 1);
    const upUp = treeSpot(request.spot, up, down, 2, 2);
    const lowerDelta =
      (layerTwoValues[1] - layerTwoValues[0]) / (middle - downDown);
    const upperDelta =
      (layerTwoValues[2] - layerTwoValues[1]) / (upUp - middle);
    rootGamma =
      (upperDelta - lowerDelta) / ((upUp - downDown) / 2);
    rootTheta = (layerTwoValues[1] - values[0]) / (2 * dt);
  }

  const nodes: BinomialNode[] = [];
  if (includeNodes) {
    for (let step = 0; step <= request.steps; step += 1) {
      for (let upMoves = 0; upMoves <= step; upMoves += 1) {
        const spot = spotLayers![step][upMoves];
        nodes.push({
          step,
          upMoves,
          spot,
          intrinsicValue: optionPayoff(
            request.optionType,
            spot,
            request.strike,
          ),
          continuationValue: continuationLayers![step][upMoves],
          optionValue: valueLayers![step][upMoves],
          earlyExercise: exerciseLayers![step][upMoves],
        });
      }
    }
  }

  const result: BinomialTreeResult = {
    contract: BINOMIAL_TREE_RESULT_CONTRACT,
    price: values[0],
    parameters: {
      stepYears: dt,
      upFactor: up,
      downFactor: down,
      riskNeutralUpProbability: probability,
      discountPerStep: discount,
    },
    rootDelta,
    rootGamma,
    rootTheta,
    earlyExerciseBoundary: boundaries,
    nodes,
    nodeDataOmitted: !includeNodes,
    nodeDataBounds: {
      totalNodeCount: totalNodes,
      storedNodeCount: nodes.length,
      requestedMaximumNodeCount: requestedNodeLimit,
      engineMaximumNodeCount: MAX_STORED_TREE_NODES,
    },
    lesson: {
      title: "CRR backward induction",
      summary:
        "At each node, a European option keeps discounted continuation value; an American option may instead take the larger immediate exercise value.",
      formula: "V = max(if American: intrinsic, e^(-rΔt)·[p·Vup + (1-p)·Vdown]).",
      conventions: [
        "p = (e^((r-q)Δt) − d)/(u − d), u = e^(σ√Δt), and d = 1/u.",
        "Maturity payoff is not marked as early exercise.",
      ],
    },
  };
  return envelope(
    result,
    request.contract,
    BINOMIAL_TREE_RESULT_CONTRACT,
  );
}

export const crrBinomialTree = priceBinomialTree;

export interface SingleAssetMarket {
  readonly kind: "single";
  readonly spot: number;
  readonly volatility: number;
  readonly dividendYield: number;
}

export interface BasketAsset {
  readonly label?: string;
  readonly spot: number;
  readonly volatility: number;
  readonly dividendYield: number;
}

export interface BasketMarket {
  readonly kind: "basket";
  readonly assets: readonly BasketAsset[];
  readonly correlation: readonly (readonly number[])[];
}

export interface EuropeanPayoffSpec {
  readonly kind: "european";
  readonly optionType: OptionType;
  readonly strike: number;
}

export interface AsianPayoffSpec {
  readonly kind: "asian";
  readonly optionType: OptionType;
  readonly strike: number;
  readonly averaging: "arithmetic" | "geometric";
  /** The simulated path always contains S(0); choose whether it is averaged. */
  readonly includeInitial?: boolean;
}

export type BarrierType =
  | "up-and-out"
  | "down-and-out"
  | "up-and-in"
  | "down-and-in";

export interface BarrierPayoffSpec {
  readonly kind: "barrier";
  readonly optionType: OptionType;
  readonly strike: number;
  readonly barrier: number;
  readonly barrierType: BarrierType;
  /** Paid at maturity when the vanilla payoff is inactive. */
  readonly rebate?: number;
}

export type LookbackPayoffSpec =
  | {
      readonly kind: "lookback";
      readonly optionType: OptionType;
      readonly style: "fixed-strike";
      readonly strike: number;
      readonly includeInitial?: boolean;
    }
  | {
      readonly kind: "lookback";
      readonly optionType: OptionType;
      readonly style: "floating-strike";
      readonly includeInitial?: boolean;
    };

export interface BasketPayoffSpec {
  readonly kind: "basket";
  readonly optionType: OptionType;
  readonly strike: number;
  readonly weights: readonly number[];
}

export type SingleAssetPayoffSpec =
  | EuropeanPayoffSpec
  | AsianPayoffSpec
  | BarrierPayoffSpec
  | LookbackPayoffSpec;

export interface MonteCarloExecution {
  readonly seed: number;
  /** Number of actual trajectories, including both members of antithetic pairs. */
  readonly paths: number;
  readonly steps: number;
  readonly antithetic?: boolean;
  readonly controlVariate?: boolean;
  /** At most a few paths are retained for teaching; all others are summarized. */
  readonly samplePathCount?: number;
}

interface MonteCarloRequestBase {
  readonly contract: typeof MONTE_CARLO_REQUEST_CONTRACT;
  readonly timeToMaturityYears: number;
  readonly riskFreeRate: number;
  readonly execution: MonteCarloExecution;
}

export interface MonteCarloSingleAssetRequest extends MonteCarloRequestBase {
  readonly market: SingleAssetMarket;
  readonly instrument: SingleAssetPayoffSpec;
}

export interface MonteCarloBasketRequest extends MonteCarloRequestBase {
  readonly market: BasketMarket;
  readonly instrument: BasketPayoffSpec;
}

export type MonteCarloOptionRequest =
  | MonteCarloSingleAssetRequest
  | MonteCarloBasketRequest;

export interface ConfidenceInterval {
  readonly level: 0.95;
  readonly lower: number;
  readonly upper: number;
}

export interface MonteCarloEstimate {
  readonly price: number;
  readonly standardError: number;
  readonly confidenceInterval: ConfidenceInterval;
}

export interface MonteCarloSamplePath {
  readonly trajectoryIndex: number;
  readonly antitheticSign: 1 | -1;
  readonly times: readonly number[];
  /** One price series per asset; a single-asset option therefore has one row. */
  readonly pricesByAsset: readonly (readonly number[])[];
  readonly payoff: number;
}

export interface MonteCarloOptionResult {
  readonly contract: typeof MONTE_CARLO_RESULT_CONTRACT;
  readonly instrumentKind: MonteCarloOptionRequest["instrument"]["kind"];
  readonly estimate: MonteCarloEstimate;
  readonly rawEstimate: MonteCarloEstimate;
  readonly simulatedPaths: number;
  /** Antithetic pairs count as one independent observation for the standard error. */
  readonly independentSamples: number;
  readonly varianceReduction: {
    readonly antithetic: boolean;
    readonly controlVariate: boolean;
    readonly controlBeta: number;
    readonly standardErrorRatioToRaw: number;
  };
  readonly discountedPayoffStandardDeviation: number;
  readonly samplePaths: readonly MonteCarloSamplePath[];
  readonly lesson: LearningNote;
}

export interface EuropeanPricingComparisonRequest
  extends EuropeanOptionInputs {
  readonly contract: typeof EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT;
  readonly tree: {
    readonly steps: number;
    readonly nodeData?: BinomialTreeRequest["nodeData"];
  };
  readonly monteCarlo: MonteCarloExecution;
}

export interface EuropeanPricingComparisonResult {
  readonly contract: typeof EUROPEAN_PRICING_COMPARISON_RESULT_CONTRACT;
  /** Inputs shared by all three methods, made explicit for a fair comparison. */
  readonly sharedOptionContract: EuropeanOptionInputs;
  readonly blackScholes: BlackScholesResult;
  readonly crr: BinomialTreeResult;
  readonly monteCarlo: MonteCarloOptionResult;
  readonly agreement: {
    readonly crrMinusBlackScholes: number;
    readonly monteCarloMinusBlackScholes: number;
    readonly blackScholesInsideMonteCarlo95PercentInterval: boolean;
    readonly crrInsideMonteCarlo95PercentInterval: boolean;
  };
  readonly lesson: LearningNote;
}

/**
 * Evaluate a single-asset payoff on a path whose first value is S(0). This is
 * exported so a learner can check path-dependent rules by hand.
 */
export function evaluatePathPayoff(
  instrument: SingleAssetPayoffSpec,
  path: readonly number[],
): number {
  validatePricePath(path, "path");
  validateSinglePayoff(instrument);
  const terminal = path[path.length - 1];
  if (instrument.kind === "european") {
    return optionPayoff(instrument.optionType, terminal, instrument.strike);
  }
  if (instrument.kind === "asian") {
    const observations = instrument.includeInitial ? path : path.slice(1);
    if (observations.length === 0) {
      throw new QuantError(
        "INVALID_INPUT",
        "An Asian payoff needs at least one monitored price.",
        "path",
      );
    }
    const average =
      instrument.averaging === "arithmetic"
        ? mean(observations)
        : geometricMean(observations);
    return optionPayoff(instrument.optionType, average, instrument.strike);
  }
  if (instrument.kind === "barrier") {
    const upward = instrument.barrierType.startsWith("up-");
    const knockIn = instrument.barrierType.endsWith("-in");
    const touched = upward
      ? path.some((spot) => spot >= instrument.barrier)
      : path.some((spot) => spot <= instrument.barrier);
    const active = knockIn ? touched : !touched;
    return active
      ? optionPayoff(instrument.optionType, terminal, instrument.strike)
      : (instrument.rebate ?? 0);
  }

  const observations = instrument.includeInitial ? path : path.slice(1);
  if (observations.length === 0) {
    throw new QuantError(
      "INVALID_INPUT",
      "A lookback payoff needs at least one monitored price.",
      "path",
    );
  }
  const minimum = Math.min(...observations);
  const maximum = Math.max(...observations);
  if (instrument.style === "fixed-strike") {
    return instrument.optionType === "call"
      ? Math.max(maximum - instrument.strike, 0)
      : Math.max(instrument.strike - minimum, 0);
  }
  return instrument.optionType === "call"
    ? Math.max(terminal - minimum, 0)
    : Math.max(maximum - terminal, 0);
}

export function evaluateBasketPayoff(
  instrument: BasketPayoffSpec,
  terminalSpots: readonly number[],
): number {
  validateBasketPayoff(instrument, terminalSpots.length);
  validateNumberArray(terminalSpots, "terminalSpots", 1, 100, false);
  const basket = terminalSpots.reduce(
    (total, spot, index) => total + instrument.weights[index] * spot,
    0,
  );
  return optionPayoff(instrument.optionType, Math.max(0, basket), instrument.strike);
}

/** Exact-GBM Monte Carlo pricing for vanilla and path-dependent payoffs. */
export function priceMonteCarloOption(
  request: MonteCarloOptionRequest,
): ModelEnvelope<MonteCarloOptionResult> {
  validateMonteCarloRequest(request);
  const { execution } = request;
  const antithetic = execution.antithetic ?? false;
  const useControl = execution.controlVariate ?? false;
  const pairSize = antithetic ? 2 : 1;
  const independentSamples = execution.paths / pairSize;
  const samplePathCount = execution.samplePathCount ?? 0;
  const random = createSemanticRandom(execution.seed, "derivatives/gbm-monte-carlo@1");
  const discount = Math.exp(
    -request.riskFreeRate * request.timeToMaturityYears,
  );
  const discountedPayoffs: number[] = [];
  const controls: number[] = [];
  const samplePaths: MonteCarloSamplePath[] = [];
  const expectedControl = monteCarloExpectedControl(request, discount);
  const basketFactor = isBasketMonteCarloRequest(request)
    ? cholesky(request.market.correlation)
    : null;

  for (let sample = 0; sample < independentSamples; sample += 1) {
    let payoffSum = 0;
    let controlSum = 0;
    for (let member = 0; member < pairSize; member += 1) {
      const sign: 1 | -1 = member === 0 ? 1 : -1;
      const trajectoryIndex = sample * pairSize + member;
      if (isBasketMonteCarloRequest(request)) {
        const simulated = simulateBasketGbmPath(
          request,
          random,
          sample,
          sign,
          trajectoryIndex < samplePathCount,
          basketFactor!,
        );
        const payoff = evaluateBasketPayoff(
          request.instrument,
          simulated.terminalSpots,
        );
        payoffSum += discount * payoff;
        controlSum +=
          discount *
          simulated.terminalSpots.reduce(
            (total, spot, index) =>
              total + request.instrument.weights[index] * spot,
            0,
          );
        if (trajectoryIndex < samplePathCount) {
          samplePaths.push({
            trajectoryIndex,
            antitheticSign: sign,
            times: timeGrid(
              request.timeToMaturityYears,
              request.execution.steps,
            ),
            pricesByAsset: simulated.paths,
            payoff,
          });
        }
      } else if (isSingleMonteCarloRequest(request)) {
        const path = simulateSingleGbmPath(request, random, sample, sign);
        const payoff = evaluatePathPayoff(request.instrument, path);
        payoffSum += discount * payoff;
        controlSum += singlePathControl(request.instrument, path, discount);
        if (trajectoryIndex < samplePathCount) {
          samplePaths.push({
            trajectoryIndex,
            antitheticSign: sign,
            times: timeGrid(
              request.timeToMaturityYears,
              request.execution.steps,
            ),
            pricesByAsset: [path],
            payoff,
          });
        }
      } else {
        throw new QuantError(
          "INVALID_INPUT",
          "Payoff and market kinds do not match.",
          "market.kind",
        );
      }
    }
    discountedPayoffs.push(payoffSum / pairSize);
    controls.push(controlSum / pairSize);
  }

  const rawEstimate = summarizeEstimate(discountedPayoffs);
  let observations = discountedPayoffs;
  let beta = 0;
  if (useControl) {
    const controlVariance = sampleVariance(controls);
    if (controlVariance > 1e-20) {
      beta = sampleCovariance(discountedPayoffs, controls) / controlVariance;
      observations = discountedPayoffs.map(
        (payoff, index) => payoff - beta * (controls[index] - expectedControl),
      );
    }
  }
  const estimate = summarizeEstimate(observations);
  const warnings = monteCarloWarnings(estimate);
  if (isBasketMonteCarloRequest(request)) {
    const weightSum = request.instrument.weights.reduce(
      (total, weight) => total + weight,
      0,
    );
    if (Math.abs(weightSum - 1) > 1e-10) {
      warnings.push({
        code: "ASSUMPTION",
        message: `Basket weights sum to ${weightSum.toFixed(6)}, so the basket is not a one-unit fully invested basket.`,
      });
    }
  }
  const result: MonteCarloOptionResult = {
    contract: MONTE_CARLO_RESULT_CONTRACT,
    instrumentKind: request.instrument.kind,
    estimate,
    rawEstimate,
    simulatedPaths: execution.paths,
    independentSamples,
    varianceReduction: {
      antithetic,
      controlVariate: useControl,
      controlBeta: beta,
      standardErrorRatioToRaw:
        rawEstimate.standardError === 0
          ? 1
          : estimate.standardError / rawEstimate.standardError,
    },
    discountedPayoffStandardDeviation: Math.sqrt(sampleVariance(observations)),
    samplePaths,
    lesson: {
      title: "Monte Carlo pricing and sampling error",
      summary:
        "The estimate is the sample mean of discounted risk-neutral payoffs. Its confidence interval measures simulation noise, not model uncertainty.",
      formula: "Price estimate = mean(e^(-rT)·payoff); SE = sample SD/√n; 95% CI = estimate ± 1.96·SE.",
      conventions: [
        "GBM steps are sampled exactly at the monitoring dates.",
        "Barriers are monitored discretely at S(0) and each simulated date.",
        "Antithetic pairs are one independent observation for standard-error calculations.",
      ],
    },
  };
  return envelope(
    result,
    request.contract,
    MONTE_CARLO_RESULT_CONTRACT,
    execution.seed,
    warnings,
  );
}

export const monteCarloOptionPrice = priceMonteCarloOption;

/** Compare three European pricers without allowing their contracts to drift. */
export function compareEuropeanPricingMethods(
  request: EuropeanPricingComparisonRequest,
): ModelEnvelope<EuropeanPricingComparisonResult> {
  assertContract(
    request.contract,
    EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT,
    "European pricing comparison request",
  );
  validateEuropeanInputs(request);
  if (request.timeToMaturityYears === 0) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "A three-method comparison needs positive time to maturity.",
      "timeToMaturityYears",
    );
  }
  assertPositive(request.volatility, "volatility");

  const sharedOptionContract: EuropeanOptionInputs = {
    optionType: request.optionType,
    spot: request.spot,
    strike: request.strike,
    timeToMaturityYears: request.timeToMaturityYears,
    riskFreeRate: request.riskFreeRate,
    volatility: request.volatility,
    dividendYield: request.dividendYield,
  };
  const analytical = priceBlackScholes({
    contract: BLACK_SCHOLES_REQUEST_CONTRACT,
    ...sharedOptionContract,
  });
  const tree = priceBinomialTree({
    contract: BINOMIAL_TREE_REQUEST_CONTRACT,
    ...sharedOptionContract,
    exerciseStyle: "european",
    steps: request.tree.steps,
    nodeData: request.tree.nodeData,
  });
  const monteCarlo = priceMonteCarloOption({
    contract: MONTE_CARLO_REQUEST_CONTRACT,
    timeToMaturityYears: request.timeToMaturityYears,
    riskFreeRate: request.riskFreeRate,
    market: {
      kind: "single",
      spot: request.spot,
      volatility: request.volatility,
      dividendYield: request.dividendYield,
    },
    instrument: {
      kind: "european",
      optionType: request.optionType,
      strike: request.strike,
    },
    execution: request.monteCarlo,
  });
  const interval = monteCarlo.result.estimate.confidenceInterval;
  const isInsideInterval = (price: number) =>
    price >= interval.lower && price <= interval.upper;

  return envelope(
    {
      contract: EUROPEAN_PRICING_COMPARISON_RESULT_CONTRACT,
      sharedOptionContract,
      blackScholes: analytical.result,
      crr: tree.result,
      monteCarlo: monteCarlo.result,
      agreement: {
        crrMinusBlackScholes:
          tree.result.price - analytical.result.price,
        monteCarloMinusBlackScholes:
          monteCarlo.result.estimate.price - analytical.result.price,
        blackScholesInsideMonteCarlo95PercentInterval: isInsideInterval(
          analytical.result.price,
        ),
        crrInsideMonteCarlo95PercentInterval: isInsideInterval(
          tree.result.price,
        ),
      },
      lesson: {
        title: "One contract, three numerical methods",
        summary:
          "Black-Scholes is analytical, CRR approaches it as the tree is refined, and Monte Carlo surrounds a noisy estimate with a sampling interval.",
        formula:
          "Compare C_BS, C_CRR(n), and C_MC ± 1.96·SE only after holding S, K, T, r, q, and σ fixed.",
        conventions: [
          "The tree uses European exercise so it prices the same claim.",
          "The Monte Carlo interval measures sampling error, not model uncertainty.",
        ],
      },
    },
    request.contract,
    EUROPEAN_PRICING_COMPARISON_RESULT_CONTRACT,
    request.monteCarlo.seed,
    mergeWarnings(analytical.warnings, tree.warnings, monteCarlo.warnings),
  );
}

function simulateSingleGbmPath(
  request: MonteCarloSingleAssetRequest,
  random: ReturnType<typeof createSemanticRandom>,
  sample: number,
  sign: 1 | -1,
): number[] {
  const dt = request.timeToMaturityYears / request.execution.steps;
  const diffusion = request.market.volatility * Math.sqrt(dt);
  const drift =
    (request.riskFreeRate -
      request.market.dividendYield -
      0.5 * request.market.volatility ** 2) *
    dt;
  const path = [request.market.spot];
  for (let step = 1; step <= request.execution.steps; step += 1) {
    const z = sign * random.normal("path", sample, "step", step, "asset", 0);
    path.push(path[step - 1] * Math.exp(drift + diffusion * z));
  }
  return path;
}

function simulateBasketGbmPath(
  request: MonteCarloBasketRequest,
  random: ReturnType<typeof createSemanticRandom>,
  sample: number,
  sign: 1 | -1,
  retainPath: boolean,
  factor: readonly (readonly number[])[],
): { readonly terminalSpots: number[]; readonly paths: number[][] } {
  const dt = request.timeToMaturityYears / request.execution.steps;
  const spots = request.market.assets.map((asset) => asset.spot);
  const paths = request.market.assets.map((asset) =>
    retainPath ? [asset.spot] : [],
  );
  for (let step = 1; step <= request.execution.steps; step += 1) {
    const independent = request.market.assets.map(
      (_, assetIndex) =>
        sign *
        random.normal(
          "path",
          sample,
          "step",
          step,
          "independent-factor",
          assetIndex,
        ),
    );
    for (let assetIndex = 0; assetIndex < spots.length; assetIndex += 1) {
      let correlatedShock = 0;
      for (let factorIndex = 0; factorIndex <= assetIndex; factorIndex += 1) {
        correlatedShock +=
          factor[assetIndex][factorIndex] * independent[factorIndex];
      }
      const asset = request.market.assets[assetIndex];
      const drift =
        (request.riskFreeRate -
          asset.dividendYield -
          0.5 * asset.volatility ** 2) *
        dt;
      spots[assetIndex] *= Math.exp(
        drift + asset.volatility * Math.sqrt(dt) * correlatedShock,
      );
      if (retainPath) paths[assetIndex].push(spots[assetIndex]);
    }
  }
  return { terminalSpots: spots, paths };
}

function singlePathControl(
  instrument: SingleAssetPayoffSpec,
  path: readonly number[],
  discount: number,
): number {
  if (instrument.kind === "asian") {
    const observations = instrument.includeInitial ? path : path.slice(1);
    return discount * mean(observations);
  }
  return discount * path[path.length - 1];
}

function monteCarloExpectedControl(
  request: MonteCarloOptionRequest,
  discount: number,
): number {
  if (isBasketMonteCarloRequest(request)) {
    return request.market.assets.reduce(
      (total, asset, index) =>
        total +
        request.instrument.weights[index] *
          asset.spot *
          Math.exp(-asset.dividendYield * request.timeToMaturityYears),
      0,
    );
  }
  if (!isSingleMonteCarloRequest(request)) {
    throw new QuantError(
      "INVALID_INPUT",
      "Payoff and market kinds do not match.",
      "market.kind",
    );
  }
  if (request.instrument.kind !== "asian") {
    return (
      request.market.spot *
      Math.exp(-request.market.dividendYield * request.timeToMaturityYears)
    );
  }
  const dt = request.timeToMaturityYears / request.execution.steps;
  const start = request.instrument.includeInitial ? 0 : 1;
  let expectation = 0;
  let count = 0;
  for (let step = start; step <= request.execution.steps; step += 1) {
    expectation +=
      request.market.spot *
      Math.exp(
        (request.riskFreeRate - request.market.dividendYield) * step * dt,
      );
    count += 1;
  }
  return discount * (expectation / count);
}

function summarizeEstimate(observations: readonly number[]): MonteCarloEstimate {
  const price = mean(observations);
  const standardError = Math.sqrt(sampleVariance(observations) / observations.length);
  return {
    price,
    standardError,
    confidenceInterval: {
      level: 0.95,
      lower: price - NORMAL_95 * standardError,
      upper: price + NORMAL_95 * standardError,
    },
  };
}

function monteCarloWarnings(
  estimate: MonteCarloEstimate,
): ModelWarning[] {
  const halfWidth = NORMAL_95 * estimate.standardError;
  if (halfWidth > 0.1 * Math.max(Math.abs(estimate.price), 0.01)) {
    return [
      {
        code: "PRECISION",
        message:
          "The 95% confidence-interval half-width exceeds 10% of the estimated price; use more paths before drawing a fine comparison.",
      },
    ];
  }
  return [];
}

export interface HestonRequest {
  readonly contract: typeof HESTON_REQUEST_CONTRACT;
  readonly option: {
    readonly optionType: OptionType;
    readonly strike: number;
  };
  readonly market: {
    readonly spot: number;
    readonly initialVariance: number;
    readonly riskFreeRate: number;
    readonly dividendYield: number;
  };
  readonly model: {
    /** Mean-reversion speed κ. */
    readonly meanReversion: number;
    /** Long-run variance θ. */
    readonly longRunVariance: number;
    /** Volatility of variance ξ. */
    readonly volatilityOfVariance: number;
    /** Correlation between price and variance Brownian shocks. */
    readonly rho: number;
  };
  readonly timeToMaturityYears: number;
  readonly execution: MonteCarloExecution;
}

export interface HestonSamplePath {
  readonly trajectoryIndex: number;
  readonly antitheticSign: 1 | -1;
  readonly times: readonly number[];
  readonly spots: readonly number[];
  readonly variances: readonly number[];
}

export interface HestonResult {
  readonly contract: typeof HESTON_RESULT_CONTRACT;
  readonly estimate: MonteCarloEstimate;
  readonly simulatedPaths: number;
  readonly independentSamples: number;
  readonly scheme: "projected-full-truncation-euler";
  readonly diagnostics: {
    readonly allVariancesNonNegative: boolean;
    readonly projectedVarianceSteps: number;
    readonly meanTerminalSpot: number;
    readonly terminalSpotDistribution: {
      readonly minimum: number;
      readonly percentile05: number;
      readonly median: number;
      readonly percentile95: number;
      readonly maximum: number;
      readonly standardDeviation: number;
    };
    readonly meanTerminalVariance: number;
    readonly expectedTerminalVariance: number;
    readonly meanVarianceAcrossSteps: number;
    readonly observedShockCorrelation: number;
    readonly fellerConditionSatisfied: boolean;
  };
  readonly samplePaths: readonly HestonSamplePath[];
  readonly lesson: LearningNote;
}

/**
 * Simulate Heston and price a European option with a projected full-truncation
 * Euler scheme. Coefficients use max(v, 0), and a negative proposed next
 * variance is projected to zero before it is stored.
 */
export function priceHestonMonteCarlo(
  request: HestonRequest,
): ModelEnvelope<HestonResult> {
  validateHestonRequest(request);
  const antithetic = request.execution.antithetic ?? false;
  const pairSize = antithetic ? 2 : 1;
  const independentSamples = request.execution.paths / pairSize;
  const samplePathCount = request.execution.samplePathCount ?? 0;
  const random = createSemanticRandom(
    request.execution.seed,
    "derivatives/heston-full-truncation@1",
  );
  const dt = request.timeToMaturityYears / request.execution.steps;
  const sqrtDt = Math.sqrt(dt);
  const rhoComplement = Math.sqrt(Math.max(0, 1 - request.model.rho ** 2));
  const discount = Math.exp(
    -request.market.riskFreeRate * request.timeToMaturityYears,
  );
  const observations: number[] = [];
  const terminalSpots: number[] = [];
  const terminalVariances: number[] = [];
  const samplePaths: HestonSamplePath[] = [];
  const correlationState = emptyCorrelationState();
  let varianceSum = 0;
  let varianceCount = 0;
  let projectedVarianceSteps = 0;

  for (let sample = 0; sample < independentSamples; sample += 1) {
    let pairPayoff = 0;
    for (let member = 0; member < pairSize; member += 1) {
      const sign: 1 | -1 = member === 0 ? 1 : -1;
      const trajectoryIndex = sample * pairSize + member;
      let spot = request.market.spot;
      let variance = request.market.initialVariance;
      const retain = trajectoryIndex < samplePathCount;
      const spotPath = retain ? [spot] : [];
      const variancePath = retain ? [variance] : [];
      varianceSum += variance;
      varianceCount += 1;

      for (let step = 1; step <= request.execution.steps; step += 1) {
        const varianceShock =
          sign * random.normal("path", sample, "step", step, "variance");
        const independentPriceShock =
          sign * random.normal("path", sample, "step", step, "price-orthogonal");
        const priceShock =
          request.model.rho * varianceShock +
          rhoComplement * independentPriceShock;
        updateCorrelationState(correlationState, varianceShock, priceShock);
        const usableVariance = Math.max(0, variance);
        const proposedVariance =
          variance +
          request.model.meanReversion *
            (request.model.longRunVariance - usableVariance) *
            dt +
          request.model.volatilityOfVariance *
            Math.sqrt(usableVariance) *
            sqrtDt *
            varianceShock;
        if (proposedVariance < 0) projectedVarianceSteps += 1;
        const nextVariance = Math.max(0, proposedVariance);
        spot *= Math.exp(
          (request.market.riskFreeRate -
            request.market.dividendYield -
            0.5 * usableVariance) *
            dt +
            Math.sqrt(usableVariance) * sqrtDt * priceShock,
        );
        variance = nextVariance;
        varianceSum += variance;
        varianceCount += 1;
        if (retain) {
          spotPath.push(spot);
          variancePath.push(variance);
        }
      }

      pairPayoff +=
        discount *
        optionPayoff(request.option.optionType, spot, request.option.strike);
      terminalSpots.push(spot);
      terminalVariances.push(variance);
      if (retain) {
        samplePaths.push({
          trajectoryIndex,
          antitheticSign: sign,
          times: timeGrid(
            request.timeToMaturityYears,
            request.execution.steps,
          ),
          spots: spotPath,
          variances: variancePath,
        });
      }
    }
    observations.push(pairPayoff / pairSize);
  }

  const estimate = summarizeEstimate(observations);
  const fellerConditionSatisfied =
    2 * request.model.meanReversion * request.model.longRunVariance >=
    request.model.volatilityOfVariance ** 2;
  const warnings = monteCarloWarnings(estimate);
  if (!fellerConditionSatisfied) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "The Feller condition 2κθ ≥ ξ² is not satisfied. The chosen scheme remains nonnegative, but the continuous process can spend substantial time near zero variance.",
    });
  }
  if (projectedVarianceSteps > 0) {
    warnings.push({
      code: "ASSUMPTION",
      message: `${projectedVarianceSteps.toLocaleString()} negative Euler variance proposals were projected to zero. Check convergence with a finer time grid.`,
    });
  }
  const expectedTerminalVariance =
    request.model.meanReversion === 0
      ? request.market.initialVariance
      : request.model.longRunVariance +
        (request.market.initialVariance - request.model.longRunVariance) *
          Math.exp(
            -request.model.meanReversion * request.timeToMaturityYears,
          );
  const result: HestonResult = {
    contract: HESTON_RESULT_CONTRACT,
    estimate,
    simulatedPaths: request.execution.paths,
    independentSamples,
    scheme: "projected-full-truncation-euler",
    diagnostics: {
      allVariancesNonNegative: terminalVariances.every(
        (variance) => variance >= 0,
      ),
      projectedVarianceSteps,
      meanTerminalSpot: mean(terminalSpots),
      terminalSpotDistribution: {
        minimum: terminalSpots.reduce((lowest, spot) => Math.min(lowest, spot)),
        percentile05: quantile(terminalSpots, 0.05),
        median: quantile(terminalSpots, 0.5),
        percentile95: quantile(terminalSpots, 0.95),
        maximum: terminalSpots.reduce((highest, spot) => Math.max(highest, spot)),
        standardDeviation: Math.sqrt(sampleVariance(terminalSpots)),
      },
      meanTerminalVariance: mean(terminalVariances),
      expectedTerminalVariance,
      meanVarianceAcrossSteps: varianceSum / varianceCount,
      observedShockCorrelation: correlationFromState(correlationState),
      fellerConditionSatisfied,
    },
    samplePaths,
    lesson: {
      title: "Heston stochastic variance",
      summary:
        "Variance mean-reverts but is itself random. Correlated price and variance shocks can create the leverage effect and a volatility smile absent from constant-volatility GBM.",
      formula: "dv = κ(θ−max(v,0))dt + ξ√max(v,0)dWv; dlogS = (r−q−v/2)dt + √v dWs.",
      conventions: [
        "Corr(dWs,dWv) = ρ.",
        "Negative Euler proposals are projected to zero and counted.",
        "The confidence interval captures Monte Carlo error only.",
      ],
    },
  };
  return envelope(
    result,
    request.contract,
    HESTON_RESULT_CONTRACT,
    request.execution.seed,
    warnings,
  );
}

export const simulateHeston = priceHestonMonteCarlo;

export interface OptionLeg {
  readonly kind: "option";
  readonly label?: string;
  readonly optionType: OptionType;
  readonly strike: number;
  readonly side: PositionSide;
  readonly quantity: number;
  /** Observed trade premium; when omitted, model value is used as the entry cost. */
  readonly premium?: number;
}

export interface UnderlyingLeg {
  readonly kind: "underlying";
  readonly label?: string;
  readonly side: PositionSide;
  readonly quantity: number;
  /** Observed entry price; when omitted, the valuation spot is used. */
  readonly entryPrice?: number;
}

export type StrategyLeg = OptionLeg | UnderlyingLeg;

export interface OptionStrategy {
  readonly contract: typeof OPTION_STRATEGY_CONTRACT;
  readonly name: string;
  readonly legs: readonly StrategyLeg[];
}

export type NamedStrategySpec =
  | {
      readonly kind: "covered-call";
      readonly callStrike: number;
      readonly quantity?: number;
    }
  | {
      readonly kind: "protective-put";
      readonly putStrike: number;
      readonly quantity?: number;
    }
  | {
      readonly kind: "straddle";
      readonly strike: number;
      readonly side?: PositionSide;
      readonly quantity?: number;
    }
  | {
      readonly kind: "strangle";
      readonly putStrike: number;
      readonly callStrike: number;
      readonly side?: PositionSide;
      readonly quantity?: number;
    }
  | {
      readonly kind: "vertical-spread";
      readonly optionType: OptionType;
      readonly direction: "bull" | "bear";
      readonly lowerStrike: number;
      readonly upperStrike: number;
      readonly quantity?: number;
    }
  | {
      readonly kind: "iron-condor";
      readonly longPutStrike: number;
      readonly shortPutStrike: number;
      readonly shortCallStrike: number;
      readonly longCallStrike: number;
      readonly quantity?: number;
    };

export interface StrategyValuationRequest {
  readonly contract: typeof STRATEGY_VALUATION_REQUEST_CONTRACT;
  readonly strategy: OptionStrategy;
  readonly market: Omit<EuropeanOptionInputs, "optionType" | "strike">;
  readonly terminalSpots: readonly number[];
}

export interface StrategyLegValuation {
  readonly legIndex: number;
  readonly kind: StrategyLeg["kind"];
  readonly signedQuantity: number;
  readonly modelUnitValue: number;
  readonly entryUnitCost: number;
  readonly signedModelValue: number;
  readonly signedEntryCost: number;
  readonly greeks: OptionGreeks;
}

export interface StrategyDiagramPoint {
  readonly terminalSpot: number;
  /** Aggregate cash value of all option and underlying legs at expiry. */
  readonly payoff: number;
  /** Payoff minus net initial cost; financing and transaction costs are excluded. */
  readonly profitLoss: number;
}

export interface StrategyValuationResult {
  readonly contract: typeof STRATEGY_VALUATION_RESULT_CONTRACT;
  readonly strategyName: string;
  readonly currentModelValue: number;
  /** Positive is a debit, negative is a credit. */
  readonly netInitialCost: number;
  readonly greeks: OptionGreeks;
  readonly legValuations: readonly StrategyLegValuation[];
  readonly diagram: readonly StrategyDiagramPoint[];
  readonly lesson: LearningNote;
}

export function optionLeg(
  optionType: OptionType,
  strike: number,
  side: PositionSide,
  quantity = 1,
  premium?: number,
): OptionLeg {
  validateOptionType(optionType, "optionType");
  assertPositive(strike, "strike");
  validateSide(side, "side");
  assertPositive(quantity, "quantity");
  if (premium !== undefined) assertNonNegative(premium, "premium");
  return { kind: "option", optionType, strike, side, quantity, premium };
}

export function underlyingLeg(
  side: PositionSide,
  quantity = 1,
  entryPrice?: number,
): UnderlyingLeg {
  validateSide(side, "side");
  assertPositive(quantity, "quantity");
  if (entryPrice !== undefined) assertNonNegative(entryPrice, "entryPrice");
  return { kind: "underlying", side, quantity, entryPrice };
}

export function createNamedStrategy(spec: NamedStrategySpec): OptionStrategy {
  const quantity = spec.quantity ?? 1;
  assertPositive(quantity, "quantity");
  switch (spec.kind) {
    case "covered-call":
      return createCoveredCall(spec.callStrike, quantity);
    case "protective-put":
      return createProtectivePut(spec.putStrike, quantity);
    case "straddle":
      return createStraddle(spec.strike, spec.side ?? "long", quantity);
    case "strangle":
      return createStrangle(
        spec.putStrike,
        spec.callStrike,
        spec.side ?? "long",
        quantity,
      );
    case "vertical-spread":
      return createVerticalSpread(
        spec.optionType,
        spec.direction,
        spec.lowerStrike,
        spec.upperStrike,
        quantity,
      );
    case "iron-condor":
      return createIronCondor(
        spec.longPutStrike,
        spec.shortPutStrike,
        spec.shortCallStrike,
        spec.longCallStrike,
        quantity,
      );
  }
}

export function createCoveredCall(
  callStrike: number,
  quantity = 1,
): OptionStrategy {
  return strategy("Covered call", [
    underlyingLeg("long", quantity),
    optionLeg("call", callStrike, "short", quantity),
  ]);
}

export function createProtectivePut(
  putStrike: number,
  quantity = 1,
): OptionStrategy {
  return strategy("Protective put", [
    underlyingLeg("long", quantity),
    optionLeg("put", putStrike, "long", quantity),
  ]);
}

export function createStraddle(
  strike: number,
  side: PositionSide = "long",
  quantity = 1,
): OptionStrategy {
  return strategy(`${capitalize(side)} straddle`, [
    optionLeg("put", strike, side, quantity),
    optionLeg("call", strike, side, quantity),
  ]);
}

export function createStrangle(
  putStrike: number,
  callStrike: number,
  side: PositionSide = "long",
  quantity = 1,
): OptionStrategy {
  assertOrderedStrikes([putStrike, callStrike], "strangle strikes");
  return strategy(`${capitalize(side)} strangle`, [
    optionLeg("put", putStrike, side, quantity),
    optionLeg("call", callStrike, side, quantity),
  ]);
}

export function createVerticalSpread(
  optionType: OptionType,
  direction: "bull" | "bear",
  lowerStrike: number,
  upperStrike: number,
  quantity = 1,
): OptionStrategy {
  validateOptionType(optionType, "optionType");
  if (direction !== "bull" && direction !== "bear") {
    throw new QuantError(
      "INVALID_INPUT",
      "direction must be bull or bear.",
      "direction",
    );
  }
  assertOrderedStrikes([lowerStrike, upperStrike], "vertical spread strikes");
  const lowerSide: PositionSide = direction === "bull" ? "long" : "short";
  const upperSide: PositionSide = direction === "bull" ? "short" : "long";
  return strategy(`${capitalize(direction)} ${optionType} spread`, [
    optionLeg(optionType, lowerStrike, lowerSide, quantity),
    optionLeg(optionType, upperStrike, upperSide, quantity),
  ]);
}

export function createBullCallSpread(
  lowerStrike: number,
  upperStrike: number,
  quantity = 1,
): OptionStrategy {
  return createVerticalSpread(
    "call",
    "bull",
    lowerStrike,
    upperStrike,
    quantity,
  );
}

export function createBearPutSpread(
  lowerStrike: number,
  upperStrike: number,
  quantity = 1,
): OptionStrategy {
  return createVerticalSpread(
    "put",
    "bear",
    lowerStrike,
    upperStrike,
    quantity,
  );
}

export function createIronCondor(
  longPutStrike: number,
  shortPutStrike: number,
  shortCallStrike: number,
  longCallStrike: number,
  quantity = 1,
): OptionStrategy {
  assertOrderedStrikes(
    [longPutStrike, shortPutStrike, shortCallStrike, longCallStrike],
    "iron condor strikes",
  );
  return strategy("Iron condor", [
    optionLeg("put", longPutStrike, "long", quantity),
    optionLeg("put", shortPutStrike, "short", quantity),
    optionLeg("call", shortCallStrike, "short", quantity),
    optionLeg("call", longCallStrike, "long", quantity),
  ]);
}

/** Value arbitrary legs by composing the validated Black-Scholes kernel. */
export function valueOptionStrategy(
  request: StrategyValuationRequest,
): ModelEnvelope<StrategyValuationResult> {
  assertContract(
    request.contract,
    STRATEGY_VALUATION_REQUEST_CONTRACT,
    "strategy valuation request",
  );
  validateStrategy(request.strategy);
  validateEuropeanInputs({
    ...request.market,
    optionType: "call",
    strike: 1,
  });
  validateNumberArray(request.terminalSpots, "terminalSpots", 1, 2_000, false);
  request.terminalSpots.forEach((spot, index) =>
    assertNonNegative(spot, `terminalSpots.${index}`),
  );

  const legValuations: StrategyLegValuation[] = [];
  let currentModelValue = 0;
  let netInitialCost = 0;
  let delta = 0;
  let gamma = 0;
  let vega = 0;
  let theta = 0;
  let rho = 0;
  request.strategy.legs.forEach((leg, legIndex) => {
    const sign = leg.side === "long" ? 1 : -1;
    const signedQuantity = sign * leg.quantity;
    if (leg.kind === "underlying") {
      const entryUnitCost = leg.entryPrice ?? request.market.spot;
      const legGreeks = makeGreeks(signedQuantity, 0, 0, 0, 0);
      const signedModelValue = signedQuantity * request.market.spot;
      const signedEntryCost = signedQuantity * entryUnitCost;
      currentModelValue += signedModelValue;
      netInitialCost += signedEntryCost;
      delta += signedQuantity;
      legValuations.push({
        legIndex,
        kind: leg.kind,
        signedQuantity,
        modelUnitValue: request.market.spot,
        entryUnitCost,
        signedModelValue,
        signedEntryCost,
        greeks: legGreeks,
      });
      return;
    }
    const model = blackScholesKernel({
      ...request.market,
      optionType: leg.optionType,
      strike: leg.strike,
    });
    const entryUnitCost = leg.premium ?? model.price;
    const signedModelValue = signedQuantity * model.price;
    const signedEntryCost = signedQuantity * entryUnitCost;
    const legGreeks = scaleGreeks(model.greeks, signedQuantity);
    currentModelValue += signedModelValue;
    netInitialCost += signedEntryCost;
    delta += legGreeks.delta;
    gamma += legGreeks.gamma;
    vega += legGreeks.vega;
    theta += legGreeks.theta;
    rho += legGreeks.rho;
    legValuations.push({
      legIndex,
      kind: leg.kind,
      signedQuantity,
      modelUnitValue: model.price,
      entryUnitCost,
      signedModelValue,
      signedEntryCost,
      greeks: legGreeks,
    });
  });

  const diagram = request.terminalSpots.map((terminalSpot) => {
    const payoff = strategyExpiryValue(request.strategy, terminalSpot);
    return {
      terminalSpot,
      payoff,
      profitLoss: payoff - netInitialCost,
    };
  });
  const result: StrategyValuationResult = {
    contract: STRATEGY_VALUATION_RESULT_CONTRACT,
    strategyName: request.strategy.name,
    currentModelValue,
    netInitialCost,
    greeks: makeGreeks(delta, gamma, vega, theta, rho),
    legValuations,
    diagram,
    lesson: {
      title: "Strategies are sums of legs",
      summary:
        "A named strategy needs no new pricing formula: add each signed leg's value, expiry cash flow, and Greeks.",
      formula: "Strategy metric = Σ(side sign × quantity × leg metric).",
      conventions: [
        "An underlying share has delta 1 and zero option Greeks in this static snapshot.",
        "P&L uses entry premiums when supplied and otherwise uses model values.",
        "Expiry P&L excludes financing, dividends on stock legs, transaction costs, and assignment fees.",
      ],
    },
  };
  return envelope(
    result,
    request.contract,
    STRATEGY_VALUATION_RESULT_CONTRACT,
  );
}

export const priceOptionStrategy = valueOptionStrategy;

export function strategyExpiryValue(
  optionStrategy: OptionStrategy,
  terminalSpot: number,
): number {
  validateStrategy(optionStrategy);
  assertNonNegative(terminalSpot, "terminalSpot");
  return optionStrategy.legs.reduce((total, leg) => {
    const sign = leg.side === "long" ? 1 : -1;
    const unitValue =
      leg.kind === "underlying"
        ? terminalSpot
        : optionPayoff(leg.optionType, terminalSpot, leg.strike);
    return total + sign * leg.quantity * unitValue;
  }, 0);
}

function strategy(name: string, legs: readonly StrategyLeg[]): OptionStrategy {
  const result: OptionStrategy = {
    contract: OPTION_STRATEGY_CONTRACT,
    name,
    legs,
  };
  validateStrategy(result);
  return result;
}

function scaleGreeks(greeks: OptionGreeks, scale: number): OptionGreeks {
  return makeGreeks(
    greeks.delta * scale,
    greeks.gamma * scale,
    greeks.vega * scale,
    greeks.theta * scale,
    greeks.rho * scale,
  );
}

function mergeWarnings(
  ...groups: (readonly ModelWarning[])[]
): ModelWarning[] {
  const unique = new Map<string, ModelWarning>();
  for (const warning of groups.flat()) {
    unique.set(`${warning.code}:${warning.message}`, warning);
  }
  return [...unique.values()];
}

function envelope<Result>(
  result: Result,
  inputContract: string,
  resultContract: string,
  seed?: number,
  warnings: readonly ModelWarning[] = [],
): ModelEnvelope<Result> {
  return {
    result,
    warnings,
    provenance: {
      engineVersion: DERIVATIVES_ENGINE_VERSION,
      seed,
      inputContract,
      resultContract,
    },
  };
}

function assertContract(
  actual: unknown,
  expected: string,
  label: string,
): void {
  if (actual !== expected) {
    throw new QuantError(
      "INVALID_INPUT",
      `${label} contract must be ${expected}.`,
      "contract",
    );
  }
}

function validateEuropeanInputs(inputs: EuropeanOptionInputs): void {
  validateOptionType(inputs.optionType, "optionType");
  assertPositive(inputs.spot, "spot");
  assertPositive(inputs.strike, "strike");
  assertNonNegative(inputs.timeToMaturityYears, "timeToMaturityYears");
  assertFinite(inputs.riskFreeRate, "riskFreeRate");
  assertNonNegative(inputs.volatility, "volatility");
  assertFinite(inputs.dividendYield, "dividendYield");
}

function validateOptionType(value: unknown, path: string): asserts value is OptionType {
  if (value !== "call" && value !== "put") {
    throw new QuantError(
      "INVALID_INPUT",
      `${path} must be call or put.`,
      path,
    );
  }
}

function validateSide(value: unknown, path: string): asserts value is PositionSide {
  if (value !== "long" && value !== "short") {
    throw new QuantError(
      "INVALID_INPUT",
      `${path} must be long or short.`,
      path,
    );
  }
}

function validateExerciseStyle(value: unknown): asserts value is ExerciseStyle {
  if (value !== "european" && value !== "american") {
    throw new QuantError(
      "INVALID_INPUT",
      "exerciseStyle must be european or american.",
      "exerciseStyle",
    );
  }
}

function validateNumberArray(
  values: readonly number[],
  path: string,
  minimumLength: number,
  maximumLength: number,
  strictlyPositive: boolean,
): void {
  if (!Array.isArray(values)) {
    throw new QuantError("INVALID_INPUT", `${path} must be an array.`, path);
  }
  if (values.length < minimumLength || values.length > maximumLength) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must contain between ${minimumLength} and ${maximumLength} values.`,
      path,
    );
  }
  values.forEach((value, index) => {
    if (strictlyPositive) assertPositive(value, `${path}.${index}`);
    else assertNonNegative(value, `${path}.${index}`);
  });
}

function limitingWarnings(inputs: EuropeanOptionInputs): ModelWarning[] {
  const warnings: ModelWarning[] = [];
  if (inputs.timeToMaturityYears === 0) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "At expiry the model value is the payoff; most analytical Greeks are not differentiable exactly at the strike.",
    });
  }
  if (inputs.volatility === 0 && inputs.timeToMaturityYears > 0) {
    warnings.push({
      code: "BOUNDARY",
      message:
        "Zero volatility uses the deterministic forward limiting value; gamma and vega are reported as zero away from the exercise boundary.",
    });
  }
  return warnings;
}

function expiryDelta(
  optionType: OptionType,
  spot: number,
  strike: number,
): number {
  if (optionType === "call") {
    return spot > strike ? 1 : spot < strike ? 0 : 0.5;
  }
  return spot < strike ? -1 : spot > strike ? 0 : -0.5;
}

function treeSpot(
  initialSpot: number,
  up: number,
  down: number,
  step: number,
  upMoves: number,
): number {
  return initialSpot * up ** upMoves * down ** (step - upMoves);
}

function validateSinglePayoff(instrument: SingleAssetPayoffSpec): void {
  if (instrument === null || typeof instrument !== "object") {
    throw new QuantError(
      "INVALID_INPUT",
      "instrument must be a payoff specification.",
      "instrument",
    );
  }
  validateOptionType(instrument.optionType, "instrument.optionType");
  if (
    instrument.kind !== "european" &&
    instrument.kind !== "asian" &&
    instrument.kind !== "barrier" &&
    instrument.kind !== "lookback"
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      "Unsupported single-asset payoff kind.",
      "instrument.kind",
    );
  }
  if (instrument.kind !== "lookback" || instrument.style === "fixed-strike") {
    assertPositive(instrument.strike, "instrument.strike");
  }
  if (instrument.kind === "asian") {
    if (
      instrument.averaging !== "arithmetic" &&
      instrument.averaging !== "geometric"
    ) {
      throw new QuantError(
        "INVALID_INPUT",
        "Asian averaging must be arithmetic or geometric.",
        "instrument.averaging",
      );
    }
  }
  if (instrument.kind === "barrier") {
    assertPositive(instrument.barrier, "instrument.barrier");
    if (
      instrument.barrierType !== "up-and-out" &&
      instrument.barrierType !== "down-and-out" &&
      instrument.barrierType !== "up-and-in" &&
      instrument.barrierType !== "down-and-in"
    ) {
      throw new QuantError(
        "INVALID_INPUT",
        "Unsupported barrier type.",
        "instrument.barrierType",
      );
    }
    if (instrument.rebate !== undefined) {
      assertNonNegative(instrument.rebate, "instrument.rebate");
    }
  }
  if (
    instrument.kind === "lookback" &&
    instrument.style !== "fixed-strike" &&
    instrument.style !== "floating-strike"
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      "Lookback style must be fixed-strike or floating-strike.",
      "instrument.style",
    );
  }
}

function validateBasketPayoff(
  instrument: BasketPayoffSpec,
  assetCount: number,
): void {
  if (instrument.kind !== "basket") {
    throw new QuantError(
      "INVALID_INPUT",
      "Basket market requires a basket payoff.",
      "instrument.kind",
    );
  }
  validateOptionType(instrument.optionType, "instrument.optionType");
  assertPositive(instrument.strike, "instrument.strike");
  if (!Array.isArray(instrument.weights) || instrument.weights.length !== assetCount) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Basket weights must have one entry per asset.",
      "instrument.weights",
    );
  }
  instrument.weights.forEach((weight, index) =>
    assertNonNegative(weight, `instrument.weights.${index}`),
  );
  if (instrument.weights.every((weight) => weight === 0)) {
    throw new QuantError(
      "INVALID_INPUT",
      "At least one basket weight must be positive.",
      "instrument.weights",
    );
  }
}

function isBasketMonteCarloRequest(
  request: MonteCarloOptionRequest,
): request is MonteCarloBasketRequest {
  return request.market.kind === "basket" && request.instrument.kind === "basket";
}

function isSingleMonteCarloRequest(
  request: MonteCarloOptionRequest,
): request is MonteCarloSingleAssetRequest {
  return request.market.kind === "single" && request.instrument.kind !== "basket";
}

function validateMonteCarloRequest(request: MonteCarloOptionRequest): void {
  assertContract(
    request.contract,
    MONTE_CARLO_REQUEST_CONTRACT,
    "Monte Carlo request",
  );
  assertPositive(request.timeToMaturityYears, "timeToMaturityYears");
  assertFinite(request.riskFreeRate, "riskFreeRate");
  validateMonteCarloExecution(request.execution);

  let assetCount = 1;
  if (request.instrument.kind === "basket") {
    if (request.market.kind !== "basket") {
      throw new QuantError(
        "INVALID_INPUT",
        "A basket payoff requires a basket market.",
        "market.kind",
      );
    }
    const assets = request.market.assets;
    if (!Array.isArray(assets) || assets.length < 2 || assets.length > 20) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "A basket must contain between 2 and 20 assets.",
        "market.assets",
      );
    }
    assets.forEach((asset, index) => {
      assertPositive(asset.spot, `market.assets.${index}.spot`);
      assertNonNegative(
        asset.volatility,
        `market.assets.${index}.volatility`,
      );
      assertFinite(
        asset.dividendYield,
        `market.assets.${index}.dividendYield`,
      );
    });
    validateCorrelationMatrix(request.market.correlation, assets.length);
    validateBasketPayoff(request.instrument, assets.length);
    assetCount = assets.length;
  } else {
    if (request.market.kind !== "single") {
      throw new QuantError(
        "INVALID_INPUT",
        "A single-asset payoff requires a single-asset market.",
        "market.kind",
      );
    }
    assertPositive(request.market.spot, "market.spot");
    assertNonNegative(request.market.volatility, "market.volatility");
    assertFinite(request.market.dividendYield, "market.dividendYield");
    validateSinglePayoff(request.instrument);
  }
  validateSimulationWork(
    request.execution.paths,
    request.execution.steps,
    assetCount,
  );
}

function validateMonteCarloExecution(execution: MonteCarloExecution): void {
  assertFinite(execution.seed, "execution.seed");
  assertIntegerInRange(execution.paths, 2, 100_000, "execution.paths");
  assertIntegerInRange(execution.steps, 1, 2_000, "execution.steps");
  if (execution.antithetic && execution.paths % 2 !== 0) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Antithetic sampling needs an even path count.",
      "execution.paths",
    );
  }
  if (execution.antithetic && execution.paths < 4) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Antithetic sampling needs at least two independent pairs (four paths).",
      "execution.paths",
    );
  }
  const samplePathCount = execution.samplePathCount ?? 0;
  assertIntegerInRange(
    samplePathCount,
    0,
    MAX_SAMPLE_PATHS,
    "execution.samplePathCount",
  );
  if (samplePathCount > execution.paths) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "samplePathCount cannot exceed paths.",
      "execution.samplePathCount",
    );
  }
}

function validateSimulationWork(
  paths: number,
  steps: number,
  assets: number,
): void {
  const work = paths * steps * assets;
  if (work > MAX_MONTE_CARLO_WORK) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `The request needs ${work.toLocaleString()} asset-steps, above the ${MAX_MONTE_CARLO_WORK.toLocaleString()} limit.`,
      "execution",
    );
  }
}

function validateCorrelationMatrix(
  matrix: readonly (readonly number[])[],
  size: number,
): void {
  if (!Array.isArray(matrix) || matrix.length !== size) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Correlation matrix rows must match the number of assets.",
      "market.correlation",
    );
  }
  matrix.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new QuantError(
        "DIMENSION_MISMATCH",
        "Correlation matrix must be square and match the assets.",
        `market.correlation.${rowIndex}`,
      );
    }
    row.forEach((value, columnIndex) => {
      assertFinite(value, `market.correlation.${rowIndex}.${columnIndex}`);
      if (value < -1 || value > 1) {
        throw new QuantError(
          "OUT_OF_RANGE",
          "Correlation entries must be between -1 and 1.",
          `market.correlation.${rowIndex}.${columnIndex}`,
        );
      }
    });
    if (Math.abs(row[rowIndex] - 1) > 1e-10) {
      throw new QuantError(
        "INVALID_INPUT",
        "Correlation matrix diagonal entries must equal one.",
        `market.correlation.${rowIndex}.${rowIndex}`,
      );
    }
  });
  cholesky(matrix);
}

function validatePricePath(path: readonly number[], label: string): void {
  validateNumberArray(path, label, 1, 100_000, false);
}

function geometricMean(values: readonly number[]): number {
  if (values.some((value) => value === 0)) return 0;
  return Math.exp(mean(values.map((value) => Math.log(value))));
}

function sampleCovariance(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length < 2) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Covariance inputs need at least two paired observations.",
    );
  }
  const leftMean = mean(left);
  const rightMean = mean(right);
  return (
    left.reduce(
      (total, value, index) =>
        total + (value - leftMean) * (right[index] - rightMean),
      0,
    ) /
    (left.length - 1)
  );
}

function timeGrid(timeYears: number, steps: number): number[] {
  return Array.from(
    { length: steps + 1 },
    (_, index) => (index * timeYears) / steps,
  );
}

function validateHestonRequest(request: HestonRequest): void {
  assertContract(request.contract, HESTON_REQUEST_CONTRACT, "Heston request");
  validateOptionType(request.option.optionType, "option.optionType");
  assertPositive(request.option.strike, "option.strike");
  assertPositive(request.market.spot, "market.spot");
  assertNonNegative(request.market.initialVariance, "market.initialVariance");
  assertFinite(request.market.riskFreeRate, "market.riskFreeRate");
  assertFinite(request.market.dividendYield, "market.dividendYield");
  assertNonNegative(request.model.meanReversion, "model.meanReversion");
  assertNonNegative(request.model.longRunVariance, "model.longRunVariance");
  assertNonNegative(
    request.model.volatilityOfVariance,
    "model.volatilityOfVariance",
  );
  assertFinite(request.model.rho, "model.rho");
  if (request.model.rho < -1 || request.model.rho > 1) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "model.rho must be between -1 and 1.",
      "model.rho",
    );
  }
  assertPositive(request.timeToMaturityYears, "timeToMaturityYears");
  validateMonteCarloExecution(request.execution);
  validateSimulationWork(request.execution.paths, request.execution.steps, 1);
}

interface CorrelationState {
  count: number;
  meanX: number;
  meanY: number;
  sumSquaresX: number;
  sumSquaresY: number;
  coMoment: number;
}

function emptyCorrelationState(): CorrelationState {
  return {
    count: 0,
    meanX: 0,
    meanY: 0,
    sumSquaresX: 0,
    sumSquaresY: 0,
    coMoment: 0,
  };
}

function updateCorrelationState(
  state: CorrelationState,
  x: number,
  y: number,
): void {
  state.count += 1;
  const deltaX = x - state.meanX;
  state.meanX += deltaX / state.count;
  const deltaY = y - state.meanY;
  state.meanY += deltaY / state.count;
  state.sumSquaresX += deltaX * (x - state.meanX);
  state.sumSquaresY += deltaY * (y - state.meanY);
  state.coMoment += deltaX * (y - state.meanY);
}

function correlationFromState(state: CorrelationState): number {
  const denominator = Math.sqrt(state.sumSquaresX * state.sumSquaresY);
  return denominator === 0 ? 0 : state.coMoment / denominator;
}

function validateStrategy(optionStrategy: OptionStrategy): void {
  assertContract(
    optionStrategy.contract,
    OPTION_STRATEGY_CONTRACT,
    "option strategy",
  );
  if (
    typeof optionStrategy.name !== "string" ||
    optionStrategy.name.trim().length === 0
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      "A strategy needs a non-empty name.",
      "strategy.name",
    );
  }
  if (
    !Array.isArray(optionStrategy.legs) ||
    optionStrategy.legs.length === 0 ||
    optionStrategy.legs.length > 32
  ) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "A strategy must contain between 1 and 32 legs.",
      "strategy.legs",
    );
  }
  optionStrategy.legs.forEach((leg, index) => {
    validateSide(leg.side, `strategy.legs.${index}.side`);
    assertPositive(leg.quantity, `strategy.legs.${index}.quantity`);
    if (leg.kind === "option") {
      validateOptionType(
        leg.optionType,
        `strategy.legs.${index}.optionType`,
      );
      assertPositive(leg.strike, `strategy.legs.${index}.strike`);
      if (leg.premium !== undefined) {
        assertNonNegative(leg.premium, `strategy.legs.${index}.premium`);
      }
    } else if (leg.kind === "underlying") {
      if (leg.entryPrice !== undefined) {
        assertNonNegative(
          leg.entryPrice,
          `strategy.legs.${index}.entryPrice`,
        );
      }
    } else {
      throw new QuantError(
        "INVALID_INPUT",
        "Strategy leg kind must be option or underlying.",
        `strategy.legs.${index}.kind`,
      );
    }
  });
}

function assertOrderedStrikes(values: readonly number[], label: string): void {
  values.forEach((value, index) => assertPositive(value, `${label}.${index}`));
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      throw new QuantError(
        "INVALID_INPUT",
        `${label} must be strictly increasing.`,
        label,
      );
    }
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
