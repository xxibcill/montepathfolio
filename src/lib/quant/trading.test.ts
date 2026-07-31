import { describe, expect, it } from "vitest";
import {
  fitOrnsteinUhlenbeck,
  runAgentMarket,
  runAlmgrenChriss,
  runLimitOrderBook,
  runOrnsteinUhlenbeck,
} from "./trading";

describe("Ornstein-Uhlenbeck spread laboratory", () => {
  it("matches exact one-step conditional moments and half-life", () => {
    const input = {
      contract: "trading-lab/ornstein-uhlenbeck@1" as const,
      initialSpread: 2,
      equilibrium: 1,
      meanReversion: 0.7,
      volatility: 0.3,
      entryThreshold: 1,
      exitThreshold: 0.2,
      execution: { seed: 7, paths: 20_000, steps: 1, stepYears: 0.25, samplePaths: 3 },
    };
    const output = runOrnsteinUhlenbeck(input).result;
    expect(output.halfLifeYears).toBeCloseTo(Math.log(2) / 0.7, 12);
    expect(output.conditionalStepMean).toBeCloseTo(1 + Math.exp(-0.7 * 0.25), 12);
    const observations = runOrnsteinUhlenbeck({
      ...input,
      execution: { ...input.execution, samplePaths: 20_000 },
    }).result.sampledSpreadPaths.map((path) => path[1]);
    const empiricalMean = observations.reduce((total, value) => total + value, 0) / observations.length;
    expect(empiricalMean).toBeCloseTo(output.conditionalStepMean, 2);
  });

  it("fits a stationary series and labels nonstationary data", () => {
    const stationary = fitOrnsteinUhlenbeck({
      contract: "trading-lab/ou-calibration@1",
      spreads: [2, 1.7, 1.5, 1.35, 1.25, 1.18, 1.13],
      stepYears: 1 / 12,
    });
    expect(stationary.stationary).toBe(true);
    expect(stationary.meanReversion).toBeGreaterThan(0);

    const wandering = fitOrnsteinUhlenbeck({
      contract: "trading-lab/ou-calibration@1",
      spreads: [1, 2, 3, 4, 5, 6],
      stepYears: 1,
    });
    expect(wandering.stationary).toBe(false);
    expect(wandering.warnings).not.toHaveLength(0);
  });

  it("rejects wrong contracts, non-finite observations, and excessive work", () => {
    expect(() =>
      fitOrnsteinUhlenbeck({
        contract: "wrong-contract",
        spreads: [1, 2, 3, 4],
        stepYears: 1,
      } as never),
    ).toThrow(/contract/i);
    expect(() =>
      fitOrnsteinUhlenbeck({
        contract: "trading-lab/ou-calibration@1",
        spreads: [1, 2, Number.NaN, 4],
        stepYears: 1,
      }),
    ).toThrow(/finite/i);
    expect(() =>
      runOrnsteinUhlenbeck({
        contract: "trading-lab/ornstein-uhlenbeck@1",
        initialSpread: 0,
        equilibrium: 0,
        meanReversion: 1,
        volatility: 1,
        entryThreshold: 1,
        exitThreshold: 0.5,
        execution: {
          seed: 1,
          paths: 20_000,
          steps: 101,
          stepYears: 1 / 252,
        },
      }),
    ).toThrow(/path-steps/i);
  });

  it("labels a constant calibration as nonstationary without NaNs", () => {
    const output = fitOrnsteinUhlenbeck({
      contract: "trading-lab/ou-calibration@1",
      spreads: [2, 2, 2, 2, 2],
      stepYears: 1 / 12,
    });
    expect(output.stationary).toBe(false);
    expect(output.autoregressiveCoefficient).toBe(1);
    expect(output.volatility).toBe(0);
    expect(output.warnings).toHaveLength(1);
  });
});

describe("deterministic limit-order book", () => {
  it("enforces price-time priority and conserves the ledger", () => {
    const output = runLimitOrderBook({
      contract: "trading-lab/limit-order-book@1",
      events: [
        { kind: "limit", id: "ask-late", owner: "maker-b", side: "sell", price: 101, quantity: 4 },
        { kind: "limit", id: "ask-early", owner: "maker-a", side: "sell", price: 100, quantity: 3 },
        { kind: "limit", id: "ask-second", owner: "maker-c", side: "sell", price: 100, quantity: 3 },
        { kind: "market", id: "buy", owner: "taker", side: "buy", quantity: 5 },
      ],
    });
    expect(output.trades.map((trade) => trade.makerOrderId)).toEqual([
      "ask-early",
      "ask-second",
    ]);
    expect(output.trades.map((trade) => trade.quantity)).toEqual([3, 2]);
    expect(output.conservation.cashDifference).toBeCloseTo(0, 12);
    expect(output.conservation.inventoryDifference).toBe(0);
    expect(output.conservation.executedBuyQuantity).toBe(
      output.conservation.executedSellQuantity,
    );
  });

  it("cancels only orders owned by the requester and replays exactly", () => {
    const input = {
      contract: "trading-lab/limit-order-book@1" as const,
      events: [
        { kind: "limit" as const, id: "bid", owner: "a", side: "buy" as const, price: 99, quantity: 2 },
        { kind: "cancel" as const, id: "bad-cancel", owner: "b", orderId: "bid" },
        { kind: "cancel" as const, id: "good-cancel", owner: "a", orderId: "bid" },
      ],
    };
    const first = runLimitOrderBook(input);
    expect(first.eventLog[1].status).toBe("rejected");
    expect(first.eventLog[2].status).toBe("cancelled");
    expect(first).toEqual(runLimitOrderBook(input));
  });

  it("charges maker and taker fees and reconciles every accounting snapshot", () => {
    const output = runLimitOrderBook({
      contract: "trading-lab/limit-order-book@1",
      events: [
        {
          kind: "limit",
          id: "ask",
          owner: "seller",
          side: "sell",
          price: 100,
          quantity: 2,
        },
        {
          kind: "market",
          id: "buy",
          owner: "buyer",
          side: "buy",
          quantity: 2,
        },
      ],
      fees: {
        makerRate: 0.001,
        takerRate: 0.002,
        fixedPerTrade: 0.5,
        collector: "exchange",
      },
    });
    expect(output.trades[0]).toMatchObject({
      maker: "seller",
      taker: "buyer",
      makerFee: 0.2,
      takerFee: 0.9,
      totalFees: 1.1,
    });
    expect(output.accounts.find((account) => account.owner === "seller")).toMatchObject({
      cash: 199.8,
      inventory: -2,
      feesPaid: 0.2,
    });
    expect(output.accounts.find((account) => account.owner === "buyer")).toMatchObject({
      cash: -200.9,
      inventory: 2,
      feesPaid: 0.9,
    });
    expect(output.accounts.find((account) => account.owner === "exchange")?.cash).toBeCloseTo(1.1, 12);
    expect(output.eventLog[1].feesCharged).toBeCloseTo(1.1, 12);
    expect(output.conservation.cashDifference).toBeCloseTo(0, 12);
    expect(output.conservation.inventoryDifference).toBeCloseTo(0, 12);
    expect(output.conservation.feesPaidDifference).toBeCloseTo(0, 12);
    expect(output.accountingSnapshots).toHaveLength(2);
    expect(
      output.accountingSnapshots.every(
        (snapshot) =>
          snapshot.cashConserved &&
          snapshot.inventoryConserved &&
          snapshot.feesReconciled,
      ),
    ).toBe(true);
  });
});

describe("agent market", () => {
  it("routes all strategies through the validated book deterministically", () => {
    const input = {
      contract: "trading-lab/agent-market@1" as const,
      initialPrice: 100,
      tickSize: 1,
      steps: 5,
      seed: 13,
      agents: [
        { id: "maker", kind: "market-maker" as const, orderSize: 5 },
        { id: "fund", kind: "fundamental" as const, orderSize: 1, fundamentalValue: 102 },
        { id: "trend", kind: "trend" as const, orderSize: 1 },
        { id: "noise", kind: "noise" as const, orderSize: 1 },
        {
          id: "risk",
          kind: "risk-budget" as const,
          orderSize: 1,
          targetRiskBudget: 100,
        },
      ],
    };
    const output = runAgentMarket(input);
    expect(output).toEqual(runAgentMarket(input));
    expect(output.decisions).toHaveLength(input.steps * input.agents.length);
    expect(output.scenarioNotForecast).toBe(true);
    expect(output.orderBook.conservation.cashDifference).toBeCloseTo(0, 12);
    expect(output.agentWealth).toHaveLength(input.agents.length);
  });

  it("uses settled fills—not submission hints—for risk-budget decisions", () => {
    const output = runAgentMarket({
      contract: "trading-lab/agent-market@1",
      initialPrice: 100,
      tickSize: 1,
      steps: 3,
      seed: 21,
      agents: [
        {
          id: "risk",
          kind: "risk-budget",
          orderSize: 1,
          targetRiskBudget: 1,
          maximumInventory: 1,
        },
        { id: "maker", kind: "market-maker", orderSize: 5 },
      ],
    });
    const decisions = output.decisions.filter(
      (decision) => decision.agentId === "risk",
    );
    expect(decisions.map((decision) => decision.observedInventory).slice(0, 2)).toEqual([0, 0]);
    expect(Math.abs(decisions[2].observedInventory)).toBe(1);
    for (const decision of decisions) {
      expect(decision.estimatedVolatility).toBeGreaterThan(0);
      expect(
        Math.abs(decision.targetInventory ?? 0) *
          output.priceSeries[decision.step] *
          (decision.estimatedVolatility ?? 0),
      ).toBeLessThanOrEqual((decision.riskBudget ?? 0) + 1e-12);
    }
  });

  it("reports fee-adjusted wealth and step ledgers", () => {
    const output = runAgentMarket({
      contract: "trading-lab/agent-market@1",
      initialPrice: 100,
      tickSize: 1,
      steps: 1,
      seed: 5,
      agents: [
        { id: "maker", kind: "market-maker", orderSize: 2 },
        {
          id: "fund",
          kind: "fundamental",
          orderSize: 1,
          fundamentalValue: 102,
        },
      ],
      fees: { makerRate: 0.001, takerRate: 0.002, fixedPerTrade: 0.1 },
    });
    expect(output.orderBook.trades).toHaveLength(1);
    expect(output.wealthHistory).toHaveLength(1);
    expect(output.wealthHistory[0].accounts).toEqual(output.agentWealth);
    expect(output.agentWealth.every((account) => account.feesPaid > 0)).toBe(true);
    expect(
      output.agentWealth.reduce(
        (total, account) => total + account.markedWealth,
        0,
      ),
    ).toBeCloseTo(-output.orderBook.conservation.feesCharged, 12);
    expect(
      output.agentWealth.reduce(
        (total, account) => total + account.grossMarkedWealth,
        0,
      ),
    ).toBeCloseTo(0, 12);
  });

  it("caps agent count and generated replay work", () => {
    expect(() =>
      runAgentMarket({
        contract: "trading-lab/agent-market@1",
        initialPrice: 100,
        tickSize: 1,
        steps: 1,
        seed: 1,
        agents: Array.from({ length: 65 }, (_, index) => ({
          id: `agent-${index}`,
          kind: "noise" as const,
          orderSize: 1,
        })),
      }),
    ).toThrow(/agents.length/i);
  });
});

describe("Almgren-Chriss optimal execution", () => {
  it("liquidates monotonically and reconciles cost components", () => {
    const output = runAlmgrenChriss({
      contract: "trading-lab/almgren-chriss@1",
      shares: 100_000,
      horizon: 1,
      intervals: 10,
      volatilityPerSqrtTime: 0.02,
      temporaryImpact: 1e-6,
      permanentImpact: 2e-7,
      riskAversion: 1e-6,
    }).result;
    expect(output.sharesRemaining[0]).toBe(100_000);
    expect(output.sharesRemaining.at(-1)).toBe(0);
    expect(
      output.sharesRemaining.every(
        (value, index) => index === 0 || value <= output.sharesRemaining[index - 1],
      ),
    ).toBe(true);
    expect(output.trades.reduce((total, value) => total + value, 0)).toBeCloseTo(100_000, 8);
    expect(output.expectedCost).toBeCloseTo(
      output.expectedTemporaryCost + output.expectedPermanentCost,
      12,
    );
  });

  it("uses a linear schedule at zero risk aversion", () => {
    const output = runAlmgrenChriss({
      contract: "trading-lab/almgren-chriss@1",
      shares: 100,
      horizon: 1,
      intervals: 4,
      volatilityPerSqrtTime: 0.2,
      temporaryImpact: 0.01,
      permanentImpact: 0,
      riskAversion: 0,
    }).result;
    expect(output.sharesRemaining).toEqual([100, 75, 50, 25, 0]);
    expect(output.trades).toEqual([25, 25, 25, 25]);
  });

  it("stays finite and front-loads liquidation in the high-risk limit", () => {
    const output = runAlmgrenChriss({
      contract: "trading-lab/almgren-chriss@1",
      shares: 100,
      horizon: 1,
      intervals: 10,
      volatilityPerSqrtTime: 0.2,
      temporaryImpact: 0.01,
      permanentImpact: 0,
      riskAversion: 1e50,
    }).result;
    expect(output.sharesRemaining.every(Number.isFinite)).toBe(true);
    expect(output.trades.every(Number.isFinite)).toBe(true);
    expect(output.sharesRemaining[1]).toBeLessThan(1e-30);
    expect(output.trades[0]).toBeCloseTo(100, 10);
    expect(output.trades.reduce((total, trade) => total + trade, 0)).toBeCloseTo(100, 12);
    expect(output.objective).toBeGreaterThan(0);
    expect(Number.isFinite(output.objective)).toBe(true);
  });
});
