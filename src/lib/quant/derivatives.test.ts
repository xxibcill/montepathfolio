import { describe, expect, it } from "vitest";
import {
  BINOMIAL_TREE_REQUEST_CONTRACT,
  BLACK_SCHOLES_REQUEST_CONTRACT,
  BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT,
  DERIVATIVES_RESOURCE_LIMITS,
  EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT,
  HESTON_REQUEST_CONTRACT,
  MONTE_CARLO_REQUEST_CONTRACT,
  PAYOFF_DIAGRAM_REQUEST_CONTRACT,
  STRATEGY_VALUATION_REQUEST_CONTRACT,
  buildBlackScholesSurface,
  buildPayoffDiagram,
  compareEuropeanPricingMethods,
  createCoveredCall,
  createIronCondor,
  createProtectivePut,
  createStraddle,
  createStrangle,
  createVerticalSpread,
  evaluateBasketPayoff,
  evaluateBlackScholes,
  evaluatePathPayoff,
  priceBinomialTree,
  priceBlackScholes,
  priceHestonMonteCarlo,
  priceMonteCarloOption,
  strategyExpiryValue,
  valueOptionStrategy,
  type BlackScholesRequest,
  type HestonRequest,
  type MonteCarloSingleAssetRequest,
} from "./derivatives";

const vanilla: BlackScholesRequest = {
  contract: BLACK_SCHOLES_REQUEST_CONTRACT,
  optionType: "call",
  spot: 100,
  strike: 100,
  timeToMaturityYears: 1,
  riskFreeRate: 0.05,
  volatility: 0.2,
  dividendYield: 0,
};

describe("Black-Scholes learning model", () => {
  it("matches the standard analytical call and put fixtures", () => {
    const call = priceBlackScholes(vanilla);
    const put = priceBlackScholes({ ...vanilla, optionType: "put" });

    expect(call.result.price).toBeCloseTo(10.4506, 4);
    expect(put.result.price).toBeCloseTo(5.5735, 4);
    expect(call.result.greeks.delta).toBeCloseTo(0.63683, 4);
    expect(call.result.greeks.gamma).toBeCloseTo(0.018762, 5);
    expect(call.provenance.inputContract).toBe(BLACK_SCHOLES_REQUEST_CONTRACT);
    expect(call.warnings).toEqual([]);
  });

  it("satisfies dividend-adjusted put-call parity and no-arbitrage bounds", () => {
    const inputs = {
      ...vanilla,
      spot: 92,
      strike: 100,
      riskFreeRate: 0.04,
      dividendYield: 0.015,
      timeToMaturityYears: 1.4,
    };
    const call = priceBlackScholes(inputs).result;
    const put = priceBlackScholes({ ...inputs, optionType: "put" }).result;
    const parityRight =
      inputs.spot * Math.exp(-inputs.dividendYield * inputs.timeToMaturityYears) -
      inputs.strike * Math.exp(-inputs.riskFreeRate * inputs.timeToMaturityYears);

    expect(call.price - put.price).toBeCloseTo(parityRight, 9);
    expect(call.price).toBeGreaterThanOrEqual(call.noArbitrageBounds.lower);
    expect(call.price).toBeLessThanOrEqual(call.noArbitrageBounds.upper);
    expect(put.price).toBeGreaterThanOrEqual(put.noArbitrageBounds.lower);
    expect(put.price).toBeLessThanOrEqual(put.noArbitrageBounds.upper);
  });

  it("agrees with finite differences for the analytical Greeks", () => {
    const base = {
      ...vanilla,
      spot: 103,
      strike: 97,
      dividendYield: 0.012,
      timeToMaturityYears: 0.8,
    };
    const result = priceBlackScholes(base).result;
    const spotStep = 0.01;
    const upSpot = priceBlackScholes({
      ...base,
      spot: base.spot + spotStep,
    }).result.price;
    const downSpot = priceBlackScholes({
      ...base,
      spot: base.spot - spotStep,
    }).result.price;
    const delta = (upSpot - downSpot) / (2 * spotStep);
    const gamma =
      (upSpot - 2 * result.price + downSpot) / spotStep ** 2;

    const parameterStep = 1e-5;
    const vega =
      (priceBlackScholes({
        ...base,
        volatility: base.volatility + parameterStep,
      }).result.price -
        priceBlackScholes({
          ...base,
          volatility: base.volatility - parameterStep,
        }).result.price) /
      (2 * parameterStep);
    const rho =
      (priceBlackScholes({
        ...base,
        riskFreeRate: base.riskFreeRate + parameterStep,
      }).result.price -
        priceBlackScholes({
          ...base,
          riskFreeRate: base.riskFreeRate - parameterStep,
        }).result.price) /
      (2 * parameterStep);
    const theta =
      (priceBlackScholes({
        ...base,
        timeToMaturityYears: base.timeToMaturityYears - parameterStep,
      }).result.price -
        result.price) /
      parameterStep;

    expect(result.greeks.delta).toBeCloseTo(delta, 5);
    expect(result.greeks.gamma).toBeCloseTo(gamma, 4);
    expect(result.greeks.vega).toBeCloseTo(vega, 4);
    expect(result.greeks.rho).toBeCloseTo(rho, 4);
    expect(result.greeks.theta).toBeCloseTo(theta, 3);
  });

  it("handles expiry and deterministic-forward limiting cases explicitly", () => {
    const expiry = priceBlackScholes({
      ...vanilla,
      spot: 110,
      timeToMaturityYears: 0,
    });
    expect(expiry.result.price).toBe(10);
    expect(expiry.result.d1).toBeNull();
    expect(expiry.warnings[0].code).toBe("BOUNDARY");

    const deterministic = priceBlackScholes({
      ...vanilla,
      volatility: 0,
    });
    expect(deterministic.result.price).toBeCloseTo(
      100 - 100 * Math.exp(-0.05),
      12,
    );
    expect(deterministic.result.greeks.gamma).toBe(0);
  });

  it("keeps payoff, P&L, and model surfaces as separate outputs", () => {
    const diagram = buildPayoffDiagram({
      contract: PAYOFF_DIAGRAM_REQUEST_CONTRACT,
      optionType: "call",
      strike: 100,
      premium: 7,
      side: "long",
      quantity: 2,
      terminalSpots: [90, 100, 120],
    }).result;
    expect(diagram.points[2]).toEqual({
      terminalSpot: 120,
      payoff: 40,
      profitLoss: 26,
    });
    expect(diagram.breakEvenSpots).toEqual([107]);

    const surface = buildBlackScholesSurface({
      contract: BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT,
      optionType: "call",
      strike: 100,
      riskFreeRate: 0.03,
      dividendYield: 0.01,
      axes: {
        spots: [90, 100],
        volatilities: [0.1, 0.3],
        timesToMaturityYears: [0.25, 1],
      },
    }).result;
    expect(surface.shape).toEqual([2, 2, 2]);
    expect(surface.cells).toHaveLength(8);
    expect(surface.cells.every((cell) => Number.isFinite(cell.greeks.delta))).toBe(
      true,
    );
  });

  it("exposes the validated analytical kernel for dependent models", () => {
    const reusable = evaluateBlackScholes(vanilla);
    const contracted = priceBlackScholes(vanilla).result;

    expect(reusable).toEqual(contracted);
    expect(() => evaluateBlackScholes({ ...vanilla, spot: 0 })).toThrow();
    expect(DERIVATIVES_RESOURCE_LIMITS.maximumSurfaceCells).toBe(50_000);
  });
});

describe("Cox-Ross-Rubinstein tree", () => {
  it("matches a one-step hand calculation and exposes its nodes", () => {
    const result = priceBinomialTree({
      ...vanilla,
      contract: BINOMIAL_TREE_REQUEST_CONTRACT,
      exerciseStyle: "european",
      steps: 1,
      nodeData: { include: true, maxNodes: 3 },
    }).result;
    const { upFactor, downFactor, riskNeutralUpProbability, discountPerStep } =
      result.parameters;
    const upPayoff = Math.max(100 * upFactor - 100, 0);
    const downPayoff = Math.max(100 * downFactor - 100, 0);
    const handValue =
      discountPerStep *
      (riskNeutralUpProbability * upPayoff +
        (1 - riskNeutralUpProbability) * downPayoff);

    expect(result.price).toBeCloseTo(handValue, 12);
    expect(result.nodes).toHaveLength(3);
    expect(result.rootDelta).toBeCloseTo(
      (upPayoff - downPayoff) / (100 * upFactor - 100 * downFactor),
      12,
    );
  });

  it("matches a two-step backward-induction calculation", () => {
    const result = priceBinomialTree({
      ...vanilla,
      contract: BINOMIAL_TREE_REQUEST_CONTRACT,
      exerciseStyle: "european",
      steps: 2,
      nodeData: { include: true, maxNodes: 6 },
    }).result;
    const {
      upFactor: up,
      downFactor: down,
      riskNeutralUpProbability: probability,
      discountPerStep: discount,
    } = result.parameters;
    const terminal = [
      Math.max(100 * down ** 2 - 100, 0),
      Math.max(100 * up * down - 100, 0),
      Math.max(100 * up ** 2 - 100, 0),
    ];
    const oneStep = [
      discount *
        (probability * terminal[1] + (1 - probability) * terminal[0]),
      discount *
        (probability * terminal[2] + (1 - probability) * terminal[1]),
    ];
    const handValue =
      discount *
      (probability * oneStep[1] + (1 - probability) * oneStep[0]);

    expect(result.price).toBeCloseTo(handValue, 12);
    expect(result.nodes).toHaveLength(6);
  });

  it("values American exercise and converges to Black-Scholes", () => {
    const common = {
      ...vanilla,
      contract: BINOMIAL_TREE_REQUEST_CONTRACT,
      optionType: "put" as const,
      steps: 250,
      nodeData: { include: false },
    };
    const european = priceBinomialTree({
      ...common,
      exerciseStyle: "european",
    }).result;
    const american = priceBinomialTree({
      ...common,
      exerciseStyle: "american",
    }).result;
    const analytical = priceBlackScholes({
      ...vanilla,
      optionType: "put",
    }).result.price;

    expect(american.price).toBeGreaterThanOrEqual(european.price);
    expect(
      american.earlyExerciseBoundary.some(
        (boundary) => boundary.exercisedNodeCount > 0,
      ),
    ).toBe(true);
    expect(Math.abs(european.price - analytical)).toBeLessThan(0.01);
    expect(european.nodes).toEqual([]);
    expect(european.nodeDataOmitted).toBe(true);
  });

  it("reports tree storage bounds and refuses a caller limit overrun", () => {
    const request = {
      ...vanilla,
      contract: BINOMIAL_TREE_REQUEST_CONTRACT,
      exerciseStyle: "european" as const,
      steps: 10,
      nodeData: { include: true, maxNodes: 66 },
    };
    const result = priceBinomialTree(request).result;

    expect(result.nodeDataBounds).toEqual({
      totalNodeCount: 66,
      storedNodeCount: 66,
      requestedMaximumNodeCount: 66,
      engineMaximumNodeCount:
        DERIVATIVES_RESOURCE_LIMITS.maximumStoredTreeNodes,
    });
    expect(() =>
      priceBinomialTree({
        ...request,
        nodeData: { include: true, maxNodes: 65 },
      }),
    ).toThrow();
  });
});

describe("same-contract European pricing comparison", () => {
  it("compares analytical, tree, and Monte Carlo prices with one input set", () => {
    const comparison = compareEuropeanPricingMethods({
      ...vanilla,
      contract: EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT,
      tree: { steps: 500, nodeData: { include: false } },
      monteCarlo: {
        seed: 2026,
        paths: 40_000,
        steps: 1,
        antithetic: true,
        controlVariate: true,
      },
    });
    const result = comparison.result;

    expect(result.sharedOptionContract).toEqual({
      optionType: vanilla.optionType,
      spot: vanilla.spot,
      strike: vanilla.strike,
      timeToMaturityYears: vanilla.timeToMaturityYears,
      riskFreeRate: vanilla.riskFreeRate,
      volatility: vanilla.volatility,
      dividendYield: vanilla.dividendYield,
    });
    expect(Math.abs(result.agreement.crrMinusBlackScholes)).toBeLessThan(0.01);
    expect(
      result.agreement.blackScholesInsideMonteCarlo95PercentInterval,
    ).toBe(true);
    expect(result.agreement.crrInsideMonteCarlo95PercentInterval).toBe(true);
    expect(result.monteCarlo.estimate.confidenceInterval.level).toBe(0.95);
    expect(comparison.provenance.seed).toBe(2026);
  });
});

describe("Monte Carlo option pricing", () => {
  it("evaluates Asian, barrier, lookback, and basket path fixtures by hand", () => {
    expect(
      evaluatePathPayoff(
        {
          kind: "asian",
          optionType: "call",
          strike: 95,
          averaging: "arithmetic",
          includeInitial: false,
        },
        [100, 110, 90],
      ),
    ).toBe(5);
    expect(
      evaluatePathPayoff(
        {
          kind: "barrier",
          optionType: "call",
          strike: 100,
          barrier: 115,
          barrierType: "up-and-out",
          rebate: 2,
        },
        [100, 116, 120],
      ),
    ).toBe(2);
    expect(
      evaluatePathPayoff(
        {
          kind: "lookback",
          optionType: "call",
          style: "fixed-strike",
          strike: 100,
        },
        [100, 130, 105],
      ),
    ).toBe(30);
    expect(
      evaluatePathPayoff(
        {
          kind: "lookback",
          optionType: "put",
          style: "floating-strike",
        },
        [100, 130, 105],
      ),
    ).toBe(25);
    expect(
      evaluateBasketPayoff(
        {
          kind: "basket",
          optionType: "call",
          strike: 100,
          weights: [0.4, 0.6],
        },
        [90, 120],
      ),
    ).toBe(8);
  });

  it("reports a reproducible interval covering the European benchmark", () => {
    const request: MonteCarloSingleAssetRequest = {
      contract: MONTE_CARLO_REQUEST_CONTRACT,
      market: {
        kind: "single",
        spot: 100,
        volatility: 0.2,
        dividendYield: 0,
      },
      instrument: { kind: "european", optionType: "call", strike: 100 },
      riskFreeRate: 0.05,
      timeToMaturityYears: 1,
      execution: {
        seed: 42,
        paths: 20_000,
        steps: 1,
        antithetic: true,
        samplePathCount: 2,
      },
    };
    const first = priceMonteCarloOption(request);
    const repeat = priceMonteCarloOption(request);
    const analytical = priceBlackScholes(vanilla).result.price;

    expect(first).toEqual(repeat);
    expect(first.result.estimate.confidenceInterval.lower).toBeLessThan(
      analytical,
    );
    expect(first.result.estimate.confidenceInterval.upper).toBeGreaterThan(
      analytical,
    );
    expect(first.result.estimate.standardError).toBeGreaterThan(0);
    expect(first.result.samplePaths).toHaveLength(2);
    expect(first.result.independentSamples).toBe(10_000);
  });

  it("uses a control without changing the estimand and reduces vanilla error", () => {
    const request: MonteCarloSingleAssetRequest = {
      contract: MONTE_CARLO_REQUEST_CONTRACT,
      market: {
        kind: "single",
        spot: 100,
        volatility: 0.25,
        dividendYield: 0.01,
      },
      instrument: { kind: "european", optionType: "call", strike: 100 },
      riskFreeRate: 0.04,
      timeToMaturityYears: 1,
      execution: {
        seed: 7,
        paths: 10_000,
        steps: 4,
        controlVariate: true,
      },
    };
    const result = priceMonteCarloOption(request).result;
    const analytical = priceBlackScholes({
      contract: BLACK_SCHOLES_REQUEST_CONTRACT,
      optionType: "call",
      spot: 100,
      strike: 100,
      timeToMaturityYears: 1,
      riskFreeRate: 0.04,
      volatility: 0.25,
      dividendYield: 0.01,
    }).result.price;

    expect(result.estimate.standardError).toBeLessThan(
      result.rawEstimate.standardError,
    );
    expect(result.estimate.confidenceInterval.lower).toBeLessThan(analytical);
    expect(result.estimate.confidenceInterval.upper).toBeGreaterThan(analytical);
  });

  it("prices every requested path family with finite uncertainty", () => {
    const base = {
      contract: MONTE_CARLO_REQUEST_CONTRACT,
      market: {
        kind: "single" as const,
        spot: 100,
        volatility: 0.2,
        dividendYield: 0,
      },
      riskFreeRate: 0.03,
      timeToMaturityYears: 1,
      execution: { seed: 3, paths: 2_000, steps: 12 },
    };
    const instruments = [
      {
        kind: "asian" as const,
        optionType: "call" as const,
        strike: 100,
        averaging: "arithmetic" as const,
      },
      {
        kind: "barrier" as const,
        optionType: "call" as const,
        strike: 100,
        barrier: 130,
        barrierType: "up-and-out" as const,
      },
      {
        kind: "lookback" as const,
        optionType: "put" as const,
        style: "fixed-strike" as const,
        strike: 100,
      },
    ];
    for (const instrument of instruments) {
      const result = priceMonteCarloOption({ ...base, instrument }).result;
      expect(result.estimate.price).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.estimate.standardError)).toBe(true);
    }

    const basket = priceMonteCarloOption({
      contract: MONTE_CARLO_REQUEST_CONTRACT,
      market: {
        kind: "basket",
        assets: [
          { spot: 100, volatility: 0.2, dividendYield: 0 },
          { spot: 100, volatility: 0.3, dividendYield: 0.01 },
        ],
        correlation: [
          [1, 0.4],
          [0.4, 1],
        ],
      },
      instrument: {
        kind: "basket",
        optionType: "put",
        strike: 100,
        weights: [0.5, 0.5],
      },
      riskFreeRate: 0.03,
      timeToMaturityYears: 1,
      execution: { seed: 3, paths: 2_000, steps: 4 },
    }).result;
    expect(basket.estimate.standardError).toBeGreaterThan(0);
  });
});

describe("Heston stochastic volatility", () => {
  const deterministicVariance: HestonRequest = {
    contract: HESTON_REQUEST_CONTRACT,
    option: { optionType: "call", strike: 100 },
    market: {
      spot: 100,
      initialVariance: 0.04,
      riskFreeRate: 0.05,
      dividendYield: 0,
    },
    model: {
      meanReversion: 2,
      longRunVariance: 0.04,
      volatilityOfVariance: 0,
      rho: -0.6,
    },
    timeToMaturityYears: 1,
    execution: {
      seed: 11,
      paths: 10_000,
      steps: 20,
      antithetic: true,
      samplePathCount: 3,
    },
  };

  it("approaches Black-Scholes when volatility of variance vanishes", () => {
    const result = priceHestonMonteCarlo(deterministicVariance).result;
    const analytical = priceBlackScholes(vanilla).result.price;

    expect(result.estimate.confidenceInterval.lower).toBeLessThan(analytical);
    expect(result.estimate.confidenceInterval.upper).toBeGreaterThan(analytical);
    expect(result.diagnostics.meanTerminalVariance).toBeCloseTo(0.04, 12);
    expect(result.diagnostics.expectedTerminalVariance).toBeCloseTo(0.04, 12);
    expect(
      Math.abs(result.diagnostics.observedShockCorrelation + 0.6),
    ).toBeLessThan(0.01);
    expect(result.samplePaths).toHaveLength(3);
    expect(
      result.samplePaths.every((path) =>
        path.variances.every((variance) => variance >= 0),
      ),
    ).toBe(true);
  });

  it("keeps all stored variances nonnegative under volatile variance shocks", () => {
    const result = priceHestonMonteCarlo({
      ...deterministicVariance,
      model: {
        meanReversion: 1.5,
        longRunVariance: 0.04,
        volatilityOfVariance: 0.8,
        rho: -0.7,
      },
      execution: {
        seed: 19,
        paths: 2_000,
        steps: 40,
        samplePathCount: 6,
      },
    });
    expect(result.result.diagnostics.allVariancesNonNegative).toBe(true);
    expect(result.result.diagnostics.projectedVarianceSteps).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.code === "BOUNDARY")).toBe(
      true,
    );
  });

  it("mean-reverts toward the documented long-run variance", () => {
    const result = priceHestonMonteCarlo({
      ...deterministicVariance,
      market: { ...deterministicVariance.market, initialVariance: 0.09 },
      model: {
        ...deterministicVariance.model,
        meanReversion: 3,
        longRunVariance: 0.04,
        volatilityOfVariance: 0,
      },
      execution: { seed: 2, paths: 200, steps: 500 },
    }).result;
    expect(
      Math.abs(
        result.diagnostics.meanTerminalVariance -
          result.diagnostics.expectedTerminalVariance,
      ),
    ).toBeLessThan(0.0001);
    expect(result.diagnostics.meanTerminalVariance).toBeLessThan(0.09);
    expect(result.diagnostics.meanTerminalVariance).toBeGreaterThan(0.04);
  });
});

describe("composable named strategies", () => {
  it("constructs the named leg sets and aggregates expiry payoffs", () => {
    const coveredCall = createCoveredCall(100);
    const protectivePut = createProtectivePut(90);
    const straddle = createStraddle(100);
    const strangle = createStrangle(90, 110);
    const vertical = createVerticalSpread("call", "bull", 90, 110);
    const condor = createIronCondor(80, 90, 110, 120);

    expect(strategyExpiryValue(coveredCall, 150)).toBe(100);
    expect(strategyExpiryValue(protectivePut, 50)).toBe(90);
    expect(strategyExpiryValue(straddle, 120)).toBe(20);
    expect(strategyExpiryValue(strangle, 100)).toBe(0);
    expect(strategyExpiryValue(vertical, 130)).toBe(20);
    expect(strategyExpiryValue(condor, 100)).toBe(0);
    expect(strategyExpiryValue(condor, 70)).toBe(-10);
  });

  it("sums model values, entry cash flows, and Greeks leg by leg", () => {
    const strategy = createStraddle(100);
    const result = valueOptionStrategy({
      contract: STRATEGY_VALUATION_REQUEST_CONTRACT,
      strategy,
      market: {
        spot: 100,
        volatility: 0.2,
        riskFreeRate: 0.05,
        dividendYield: 0,
        timeToMaturityYears: 1,
      },
      terminalSpots: [80, 100, 120],
    }).result;
    const call = priceBlackScholes(vanilla).result;
    const put = priceBlackScholes({ ...vanilla, optionType: "put" }).result;

    expect(result.currentModelValue).toBeCloseTo(call.price + put.price, 12);
    expect(result.greeks.delta).toBeCloseTo(
      call.greeks.delta + put.greeks.delta,
      12,
    );
    expect(result.greeks.gamma).toBeCloseTo(
      call.greeks.gamma + put.greeks.gamma,
      12,
    );
    expect(result.diagram[0].payoff).toBe(20);
    expect(result.diagram[1].profitLoss).toBeCloseTo(-result.netInitialCost, 12);
  });
});
