import {
  QUANT_CORE_VERSION,
  QuantError,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  createSemanticRandom,
  mean,
  sampleVariance,
  type ModelEnvelope,
  type ModelWarning,
} from "./core";

export const TRADING_LAB_VERSION = "trading-lab@1";

export interface OrnsteinUhlenbeckInput {
  readonly contract: "trading-lab/ornstein-uhlenbeck@1";
  readonly initialSpread: number;
  readonly equilibrium: number;
  /** Mean-reversion speed per year. */
  readonly meanReversion: number;
  /** Diffusion volatility per square-root year. */
  readonly volatility: number;
  readonly entryThreshold: number;
  readonly exitThreshold: number;
  readonly execution: {
    readonly seed: number;
    readonly paths: number;
    readonly steps: number;
    readonly stepYears: number;
    readonly samplePaths?: number;
  };
}

export interface OrnsteinUhlenbeckResult {
  readonly contract: "trading-lab/ornstein-uhlenbeck-result@1";
  readonly sampledSpreadPaths: readonly (readonly number[])[];
  readonly halfLifeYears: number;
  readonly conditionalStepMean: number;
  readonly conditionalStepVariance: number;
  readonly probabilityOfEntry: number;
  readonly probabilityOfEquilibriumHit: number;
  readonly sampledSignals: readonly {
    readonly pathIndex: number;
    readonly stepIndex: number;
    readonly action: "long-spread" | "short-spread" | "exit";
  }[];
}

export function runOrnsteinUhlenbeck(
  input: OrnsteinUhlenbeckInput,
): ModelEnvelope<OrnsteinUhlenbeckResult> {
  validateOuInput(input);
  const meanReversionStep =
    input.meanReversion * input.execution.stepYears;
  const decay = Math.exp(-meanReversionStep);
  const conditionalVariance =
    (input.volatility ** 2 * -Math.expm1(-2 * meanReversionStep)) /
    (2 * input.meanReversion);
  assertFinite(conditionalVariance, "conditionalStepVariance");
  const halfLifeYears = Math.log(2) / input.meanReversion;
  assertFinite(halfLifeYears, "halfLifeYears");
  const conditionalStepMean =
    input.equilibrium +
    (input.initialSpread - input.equilibrium) * decay;
  assertFinite(conditionalStepMean, "conditionalStepMean");
  const random = createSemanticRandom(input.execution.seed, input.contract);
  const sampleCount = Math.min(
    input.execution.samplePaths ?? 32,
    input.execution.paths,
  );
  const sampledSpreadPaths: number[][] = [];
  const sampledSignals: OrnsteinUhlenbeckResult["sampledSignals"][number][] = [];
  let entryHits = 0;
  let equilibriumHits = 0;

  for (let pathIndex = 0; pathIndex < input.execution.paths; pathIndex += 1) {
    let spread = input.initialSpread;
    let entered = false;
    let hitEquilibrium = false;
    let position: "long" | "short" | null = null;
    const path = [spread];
    for (let stepIndex = 1; stepIndex <= input.execution.steps; stepIndex += 1) {
      const priorSpread = spread;
      spread =
        input.equilibrium +
        (spread - input.equilibrium) * decay +
        Math.sqrt(conditionalVariance) *
          random.normal("spread", pathIndex, stepIndex);
      if (!Number.isFinite(spread)) {
        throw new QuantError(
          "NUMERICAL_FAILURE",
          "OU simulation produced a non-finite spread; reduce the scale or horizon.",
          `path.${pathIndex}.step.${stepIndex}`,
        );
      }
      path.push(spread);
      if (Math.abs(spread - input.equilibrium) >= input.entryThreshold) {
        entered = true;
        const nextPosition = spread < input.equilibrium ? "long" : "short";
        if (pathIndex < sampleCount && position !== nextPosition) {
          sampledSignals.push({
            pathIndex,
            stepIndex,
            action: nextPosition === "long" ? "long-spread" : "short-spread",
          });
        }
        position = nextPosition;
      } else if (
        position !== null &&
        Math.abs(spread - input.equilibrium) <= input.exitThreshold
      ) {
        if (pathIndex < sampleCount) {
          sampledSignals.push({ pathIndex, stepIndex, action: "exit" });
        }
        position = null;
      }
      hitEquilibrium ||=
        (priorSpread - input.equilibrium) * (spread - input.equilibrium) <= 0;
    }
    entryHits += Number(entered);
    equilibriumHits += Number(hitEquilibrium);
    if (pathIndex < sampleCount) sampledSpreadPaths.push(path);
  }

  return envelope(input.contract, "trading-lab/ornstein-uhlenbeck-result@1", input.execution.seed, {
    contract: "trading-lab/ornstein-uhlenbeck-result@1",
    sampledSpreadPaths,
    halfLifeYears,
    conditionalStepMean,
    conditionalStepVariance: conditionalVariance,
    probabilityOfEntry: entryHits / input.execution.paths,
    probabilityOfEquilibriumHit: equilibriumHits / input.execution.paths,
    sampledSignals,
  });
}

export interface OuCalibrationInput {
  readonly contract: "trading-lab/ou-calibration@1";
  readonly spreads: readonly number[];
  readonly stepYears: number;
}

export interface OuCalibrationResult {
  readonly contract: "trading-lab/ou-calibration-result@1";
  readonly equilibrium: number;
  readonly meanReversion: number;
  readonly volatility: number;
  readonly halfLifeYears: number;
  readonly autoregressiveCoefficient: number;
  readonly stationary: boolean;
  readonly warnings: readonly string[];
}

export function fitOrnsteinUhlenbeck(
  input: OuCalibrationInput,
): OuCalibrationResult {
  if (input.contract !== "trading-lab/ou-calibration@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported OU calibration contract.");
  }
  assertIntegerInRange(input.spreads.length, 4, 100_000, "spreads.length");
  assertPositive(input.stepYears, "stepYears");
  input.spreads.forEach((spread, index) =>
    assertFinite(spread, `spreads.${index}`),
  );
  const lagged = input.spreads.slice(0, -1);
  const next = input.spreads.slice(1);
  const laggedMean = mean(lagged);
  const nextMean = mean(next);
  const scale = Math.max(
    lagged.reduce(
      (largest, value) => Math.max(largest, Math.abs(value - laggedMean)),
      0,
    ),
    next.reduce(
      (largest, value) => Math.max(largest, Math.abs(value - nextMean)),
      0,
    ),
  );
  const covariance = scale === 0 ? 0 : lagged.reduce(
    (total, value, index) =>
      total +
      ((value - laggedMean) / scale) *
        ((next[index] - nextMean) / scale),
    0,
  );
  const laggedSquares = scale === 0 ? 0 : lagged.reduce(
    (total, value) => total + ((value - laggedMean) / scale) ** 2,
    0,
  );
  const coefficient = laggedSquares === 0 ? 1 : covariance / laggedSquares;
  assertFinite(coefficient, "autoregressiveCoefficient");
  const intercept = nextMean - coefficient * laggedMean;
  assertFinite(intercept, "autoregressiveIntercept");
  const stationary = coefficient > 0 && coefficient < 1;
  const meanReversion = stationary
    ? -Math.log(coefficient) / input.stepYears
    : 0;
  const equilibrium = stationary ? intercept / (1 - coefficient) : laggedMean;
  assertFinite(meanReversion, "meanReversion");
  assertFinite(equilibrium, "equilibrium");
  const residuals = next.map(
    (value, index) => value - intercept - coefficient * lagged[index],
  );
  residuals.forEach((residual, index) =>
    assertFinite(residual, `residuals.${index}`),
  );
  const residualScale = residuals.reduce(
    (largest, residual) => Math.max(largest, Math.abs(residual)),
    0,
  );
  const residualVariance =
    residualScale === 0
      ? 0
      : sampleVariance(residuals.map((value) => value / residualScale)) *
        residualScale ** 2;
  assertFinite(residualVariance, "residualVariance");
  const volatility = stationary
    ? Math.sqrt(
        (residualVariance * 2 * meanReversion) /
          -Math.expm1(-2 * meanReversion * input.stepYears),
      )
    : Math.sqrt(residualVariance / input.stepYears);
  assertFinite(volatility, "volatility");
  const halfLifeYears = stationary
    ? Math.log(2) / meanReversion
    : Number.POSITIVE_INFINITY;
  if (stationary) assertFinite(halfLifeYears, "halfLifeYears");
  return {
    contract: "trading-lab/ou-calibration-result@1",
    equilibrium,
    meanReversion,
    volatility,
    halfLifeYears,
    autoregressiveCoefficient: coefficient,
    stationary,
    warnings: stationary
      ? []
      : ["The fitted AR(1) coefficient is outside (0, 1); an OU interpretation is not stationary."],
  };
}

export type OrderSide = "buy" | "sell";

export type OrderBookEvent =
  | {
      readonly kind: "limit";
      readonly id: string;
      readonly owner: string;
      readonly side: OrderSide;
      readonly price: number;
      readonly quantity: number;
    }
  | {
      readonly kind: "market";
      readonly id: string;
      readonly owner: string;
      readonly side: OrderSide;
      readonly quantity: number;
    }
  | {
      readonly kind: "cancel";
      readonly id: string;
      readonly owner: string;
      readonly orderId: string;
    };

export interface LedgerAccount {
  readonly owner: string;
  readonly cash: number;
  readonly inventory: number;
  /** Cumulative transaction costs charged to this account. */
  readonly feesPaid?: number;
}

export interface RestingOrder {
  readonly id: string;
  readonly owner: string;
  readonly side: OrderSide;
  readonly price: number;
  readonly remainingQuantity: number;
  readonly sequence: number;
}

export interface Trade {
  readonly eventId: string;
  readonly price: number;
  readonly quantity: number;
  readonly buyer: string;
  readonly seller: string;
  readonly maker: string;
  readonly taker: string;
  readonly makerOrderId: string;
  readonly makerFee: number;
  readonly takerFee: number;
  readonly totalFees: number;
}

export interface OrderBookFeeSchedule {
  /** Fraction of trade notional charged to the resting-order owner. */
  readonly makerRate?: number;
  /** Fraction of trade notional charged to the incoming-order owner. */
  readonly takerRate?: number;
  /** Fixed amount charged to the taker for each individual match. */
  readonly fixedPerTrade?: number;
  /** Ledger account that receives all fees. Defaults to `fee-collector`. */
  readonly collector?: string;
}

export interface OrderBookAccountingSnapshot {
  readonly eventIndex: number;
  readonly eventId: string;
  readonly accounts: readonly LedgerAccount[];
  readonly totalCash: number;
  readonly totalInventory: number;
  readonly cumulativeFeesCharged: number;
  readonly cashDifference: number;
  readonly inventoryDifference: number;
  readonly feeAccountingDifference: number;
  readonly cashConserved: boolean;
  readonly inventoryConserved: boolean;
  readonly feesReconciled: boolean;
}

export interface OrderBookSnapshot {
  readonly eventIndex: number;
  readonly bids: readonly { readonly price: number; readonly quantity: number }[];
  readonly asks: readonly { readonly price: number; readonly quantity: number }[];
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
}

export interface OrderBookInput {
  readonly contract: "trading-lab/limit-order-book@1";
  readonly events: readonly OrderBookEvent[];
  readonly initialAccounts?: readonly LedgerAccount[];
  readonly maxPriceLevels?: number;
  readonly fees?: OrderBookFeeSchedule;
}

export interface OrderBookResult {
  readonly contract: "trading-lab/limit-order-book-result@1";
  readonly restingOrders: readonly RestingOrder[];
  readonly trades: readonly Trade[];
  readonly snapshots: readonly OrderBookSnapshot[];
  readonly accountingSnapshots: readonly OrderBookAccountingSnapshot[];
  readonly accounts: readonly LedgerAccount[];
  readonly eventLog: readonly {
    readonly event: OrderBookEvent;
    readonly status: "accepted" | "partially-filled" | "filled" | "cancelled" | "rejected";
    readonly executedQuantity: number;
    readonly feesCharged: number;
    readonly message: string;
  }[];
  readonly conservation: {
    readonly cashDifference: number;
    readonly inventoryDifference: number;
    readonly executedBuyQuantity: number;
    readonly executedSellQuantity: number;
    readonly feesCharged: number;
    readonly feesPaidDifference: number;
  };
  readonly averageSlippage: number;
  readonly priceImpact: number;
}

interface MutableOrder {
  id: string;
  owner: string;
  side: OrderSide;
  price: number;
  remainingQuantity: number;
  sequence: number;
}

interface MutableAccount {
  owner: string;
  cash: number;
  inventory: number;
  feesPaid: number;
}

interface NormalizedFeeSchedule {
  makerRate: number;
  takerRate: number;
  fixedPerTrade: number;
  collector: string;
}

export function runLimitOrderBook(input: OrderBookInput): OrderBookResult {
  validateOrderBookInput(input);
  const fees = normalizeFeeSchedule(input.fees);
  const orders: MutableOrder[] = [];
  const accounts = new Map<string, MutableAccount>();
  for (const account of input.initialAccounts ?? []) {
    accounts.set(account.owner, {
      owner: account.owner,
      cash: account.cash,
      inventory: account.inventory,
      feesPaid: account.feesPaid ?? 0,
    });
  }
  if (fees.makerRate > 0 || fees.takerRate > 0 || fees.fixedPerTrade > 0) {
    ensureAccount(accounts, fees.collector);
  }
  const initialCash = [...accounts.values()].reduce((total, account) => total + account.cash, 0);
  const initialInventory = [...accounts.values()].reduce(
    (total, account) => total + account.inventory,
    0,
  );
  const initialFeesPaid = [...accounts.values()].reduce(
    (total, account) => total + account.feesPaid,
    0,
  );
  assertFinite(initialCash, "initialAccounts.totalCash");
  assertFinite(initialInventory, "initialAccounts.totalInventory");
  assertFinite(initialFeesPaid, "initialAccounts.totalFeesPaid");
  const trades: Trade[] = [];
  const snapshots: OrderBookSnapshot[] = [];
  const accountingSnapshots: OrderBookAccountingSnapshot[] = [];
  const eventLog: OrderBookResult["eventLog"][number][] = [];
  const referenceMidpoints: number[] = [];
  const slippages: number[] = [];

  input.events.forEach((event, eventIndex) => {
    ensureAccount(accounts, event.owner);
    const before = snapshotBook(orders, eventIndex - 1, input.maxPriceLevels ?? 20);
    const reference = midpoint(before);
    if (reference !== null) referenceMidpoints.push(reference);
    const outcome = processOrderBookEvent(
      event,
      eventIndex,
      orders,
      accounts,
      trades,
      fees,
    );
    const eventTrades = trades.slice(outcome.tradeStartIndex);
    if (reference !== null) {
      eventTrades.forEach((trade) => {
        const signed = event.kind !== "cancel" && event.side === "sell" ? -1 : 1;
        slippages.push(signed * (trade.price - reference));
      });
    }
    eventLog.push({
      event,
      status: outcome.status,
      executedQuantity: outcome.executedQuantity,
      feesCharged: eventTrades.reduce(
        (total, trade) => total + trade.totalFees,
        0,
      ),
      message: outcome.message,
    });
    snapshots.push(snapshotBook(orders, eventIndex, input.maxPriceLevels ?? 20));
    accountingSnapshots.push(
      snapshotAccounting(
        accounts,
        eventIndex,
        event.id,
        initialCash,
        initialInventory,
        initialFeesPaid,
        trades,
      ),
    );
  });

  const finalCash = [...accounts.values()].reduce((total, account) => total + account.cash, 0);
  const finalInventory = [...accounts.values()].reduce(
    (total, account) => total + account.inventory,
    0,
  );
  const firstTrade = trades[0]?.price ?? 0;
  const lastTrade = trades.at(-1)?.price ?? firstTrade;
  const feesCharged = trades.reduce(
    (total, trade) => total + trade.totalFees,
    0,
  );
  const finalFeesPaid = [...accounts.values()].reduce(
    (total, account) => total + account.feesPaid,
    0,
  );
  return {
    contract: "trading-lab/limit-order-book-result@1",
    restingOrders: sortOrders(orders).map((order) => ({ ...order })),
    trades,
    snapshots,
    accountingSnapshots,
    accounts: sortedAccounts(accounts),
    eventLog,
    conservation: {
      cashDifference: finalCash - initialCash,
      inventoryDifference: finalInventory - initialInventory,
      executedBuyQuantity: trades.reduce((total, trade) => total + trade.quantity, 0),
      executedSellQuantity: trades.reduce((total, trade) => total + trade.quantity, 0),
      feesCharged,
      feesPaidDifference: finalFeesPaid - initialFeesPaid - feesCharged,
    },
    averageSlippage:
      slippages.length === 0 ? 0 : slippages.reduce((total, value) => total + value, 0) / slippages.length,
    priceImpact: lastTrade - firstTrade,
  };
}

export interface AgentSpec {
  readonly id: string;
  readonly kind:
    | "fundamental"
    | "trend"
    | "market-maker"
    | "noise"
    | "risk-budget"
    /** @deprecated Use `risk-budget`; a one-asset market cannot form risk parity. */
    | "risk-parity";
  readonly orderSize: number;
  readonly fundamentalValue?: number;
  /** Maximum one-step marked-to-market volatility exposure in cash units. */
  readonly targetRiskBudget?: number;
  readonly riskLookback?: number;
  readonly maximumInventory?: number;
}

export interface AgentMarketInput {
  readonly contract: "trading-lab/agent-market@1";
  readonly initialPrice: number;
  readonly tickSize: number;
  readonly steps: number;
  readonly seed: number;
  readonly agents: readonly AgentSpec[];
  readonly fees?: OrderBookFeeSchedule;
}

export interface AgentDecision {
  readonly step: number;
  readonly agentId: string;
  readonly rationale: string;
  readonly events: readonly OrderBookEvent[];
  /** Inventory from settled fills before this decision, never from submissions. */
  readonly observedInventory: number;
  readonly estimatedVolatility?: number;
  readonly riskBudget?: number;
  readonly targetInventory?: number;
}

export interface AgentWealthSnapshot {
  readonly step: number;
  readonly markPrice: number;
  readonly accounts: readonly {
    readonly agentId: string;
    readonly cash: number;
    readonly inventory: number;
    readonly feesPaid: number;
    readonly grossMarkedWealth: number;
    readonly markedWealth: number;
  }[];
}

export interface AgentMarketResult {
  readonly contract: "trading-lab/agent-market-result@1";
  readonly orderBook: OrderBookResult;
  readonly decisions: readonly AgentDecision[];
  readonly priceSeries: readonly number[];
  readonly agentWealth: readonly {
    readonly agentId: string;
    readonly cash: number;
    readonly inventory: number;
    readonly feesPaid: number;
    /** Wealth before explicitly subtracting the recorded transaction costs. */
    readonly grossMarkedWealth: number;
    readonly markedWealth: number;
  }[];
  readonly wealthHistory: readonly AgentWealthSnapshot[];
  readonly scenarioNotForecast: true;
}

export function runAgentMarket(input: AgentMarketInput): AgentMarketResult {
  validateAgentMarketInput(input);
  const random = createSemanticRandom(input.seed, input.contract);
  const events: OrderBookEvent[] = [];
  const decisions: AgentDecision[] = [];
  const priceSeries = [input.initialPrice];
  let latestPrice = input.initialPrice;
  let sequence = 0;
  const settledInventory = new Map(input.agents.map((agent) => [agent.id, 0]));
  const wealthHistory: AgentWealthSnapshot[] = [];

  for (let step = 0; step < input.steps; step += 1) {
    for (const agent of input.agents) {
      const decision = decideAgentOrders(
        agent,
        step,
        latestPrice,
        priceSeries,
        input.tickSize,
        random,
        sequence,
        settledInventory.get(agent.id) ?? 0,
      );
      sequence += decision.events.length;
      events.push(...decision.events);
      decisions.push({
        step,
        agentId: agent.id,
        rationale: decision.rationale,
        events: decision.events,
        observedInventory: settledInventory.get(agent.id) ?? 0,
        ...(decision.estimatedVolatility === undefined
          ? {}
          : { estimatedVolatility: decision.estimatedVolatility }),
        ...(decision.riskBudget === undefined
          ? {}
          : { riskBudget: decision.riskBudget }),
        ...(decision.targetInventory === undefined
          ? {}
          : { targetInventory: decision.targetInventory }),
      });
    }
    const interim = runLimitOrderBook({
      contract: "trading-lab/limit-order-book@1",
      events,
      initialAccounts: input.agents.map((agent) => ({
        owner: agent.id,
        cash: 0,
        inventory: 0,
      })),
      fees: input.fees,
    });
    latestPrice = interim.trades.at(-1)?.price ?? latestPrice;
    for (const agent of input.agents) {
      settledInventory.set(
        agent.id,
        interim.accounts.find((account) => account.owner === agent.id)
          ?.inventory ?? 0,
      );
    }
    wealthHistory.push({
      step,
      markPrice: latestPrice,
      accounts: markAgentWealth(input.agents, interim.accounts, latestPrice),
    });
    priceSeries.push(latestPrice);
  }

  const orderBook = runLimitOrderBook({
    contract: "trading-lab/limit-order-book@1",
    events,
    initialAccounts: input.agents.map((agent) => ({
      owner: agent.id,
      cash: 0,
      inventory: 0,
    })),
    fees: input.fees,
  });
  const finalPrice = orderBook.trades.at(-1)?.price ?? input.initialPrice;
  return {
    contract: "trading-lab/agent-market-result@1",
    orderBook,
    decisions,
    priceSeries,
    agentWealth: markAgentWealth(input.agents, orderBook.accounts, finalPrice),
    wealthHistory,
    scenarioNotForecast: true,
  };
}

export interface AlmgrenChrissInput {
  readonly contract: "trading-lab/almgren-chriss@1";
  readonly shares: number;
  readonly horizon: number;
  readonly intervals: number;
  readonly volatilityPerSqrtTime: number;
  readonly temporaryImpact: number;
  readonly permanentImpact: number;
  readonly riskAversion: number;
}

export interface AlmgrenChrissResult {
  readonly contract: "trading-lab/almgren-chriss-result@1";
  readonly times: readonly number[];
  readonly sharesRemaining: readonly number[];
  readonly trades: readonly number[];
  readonly expectedTemporaryCost: number;
  readonly expectedPermanentCost: number;
  readonly expectedCost: number;
  readonly costVariance: number;
  readonly objective: number;
  readonly urgencyFrontier: readonly {
    readonly riskAversion: number;
    readonly expectedCost: number;
    readonly costVariance: number;
  }[];
}

export function runAlmgrenChriss(
  input: AlmgrenChrissInput,
): ModelEnvelope<AlmgrenChrissResult> {
  validateAlmgrenChrissInput(input);
  const schedule = buildLiquidationSchedule(input, input.riskAversion);
  const frontierRiskAversions = [0, 0.01, 0.05, 0.1, 0.5, 1].map(
    (multiplier) => multiplier / Math.max(1, input.shares),
  );
  const result: AlmgrenChrissResult = {
    contract: "trading-lab/almgren-chriss-result@1",
    ...schedule,
    urgencyFrontier: frontierRiskAversions.map((riskAversion) => {
      const point = buildLiquidationSchedule(input, riskAversion);
      return {
        riskAversion,
        expectedCost: point.expectedCost,
        costVariance: point.costVariance,
      };
    }),
  };
  return envelope(input.contract, result.contract, undefined, result);
}

function validateOuInput(input: OrnsteinUhlenbeckInput): void {
  if (input.contract !== "trading-lab/ornstein-uhlenbeck@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported OU contract.");
  }
  assertFinite(input.initialSpread, "initialSpread");
  assertFinite(input.equilibrium, "equilibrium");
  assertPositive(input.meanReversion, "meanReversion");
  assertNonNegative(input.volatility, "volatility");
  assertPositive(input.entryThreshold, "entryThreshold");
  assertNonNegative(input.exitThreshold, "exitThreshold");
  if (input.exitThreshold >= input.entryThreshold) {
    throw new QuantError("OUT_OF_RANGE", "Exit threshold must be below entry threshold.");
  }
  assertIntegerInRange(input.execution.paths, 1, 20_000, "execution.paths");
  assertIntegerInRange(input.execution.steps, 1, 10_000, "execution.steps");
  assertIntegerInRange(
    input.execution.seed,
    -2_147_483_648,
    2_147_483_647,
    "execution.seed",
  );
  assertPositive(input.execution.stepYears, "execution.stepYears");
  if (input.execution.samplePaths !== undefined) {
    assertIntegerInRange(
      input.execution.samplePaths,
      0,
      input.execution.paths,
      "execution.samplePaths",
    );
  }
  if (input.execution.paths * input.execution.steps > 2_000_000) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "OU simulation is capped at 2,000,000 path-steps.",
      "execution",
    );
  }
}

function validateOrderBookInput(input: OrderBookInput): void {
  if (input.contract !== "trading-lab/limit-order-book@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported order-book contract.");
  }
  assertIntegerInRange(input.events.length, 0, 10_000, "events.length");
  if (input.maxPriceLevels !== undefined) {
    assertIntegerInRange(input.maxPriceLevels, 1, 1_000, "maxPriceLevels");
  }
  if (input.initialAccounts !== undefined) {
    assertIntegerInRange(
      input.initialAccounts.length,
      0,
      10_000,
      "initialAccounts.length",
    );
  }
  const ids = new Set<string>();
  input.events.forEach((event, index) => {
    if (!event.id.trim() || ids.has(event.id)) {
      throw new QuantError("INVALID_INPUT", "Event IDs must be non-empty and unique.", `events.${index}.id`);
    }
    ids.add(event.id);
    if (!event.owner.trim()) {
      throw new QuantError("INVALID_INPUT", "Every event needs an owner.");
    }
    if (event.kind !== "cancel") {
      assertPositive(event.quantity, `events.${index}.quantity`);
    }
    if (event.kind === "limit") assertPositive(event.price, `events.${index}.price`);
  });
  const accountOwners = new Set<string>();
  for (const [index, account] of (input.initialAccounts ?? []).entries()) {
    if (!account.owner.trim() || accountOwners.has(account.owner)) {
      throw new QuantError(
        "INVALID_INPUT",
        "Initial-account owners must be non-empty and unique.",
        `initialAccounts.${index}.owner`,
      );
    }
    accountOwners.add(account.owner);
    assertFinite(account.cash, `initialAccounts.${index}.cash`);
    assertFinite(account.inventory, `initialAccounts.${index}.inventory`);
    if (account.feesPaid !== undefined) {
      assertNonNegative(account.feesPaid, `initialAccounts.${index}.feesPaid`);
    }
  }
  validateFeeSchedule(input.fees);
}

function validateFeeSchedule(schedule: OrderBookFeeSchedule | undefined): void {
  if (schedule === undefined) return;
  assertNonNegative(schedule.makerRate ?? 0, "fees.makerRate");
  assertNonNegative(schedule.takerRate ?? 0, "fees.takerRate");
  assertNonNegative(schedule.fixedPerTrade ?? 0, "fees.fixedPerTrade");
  if (schedule.collector !== undefined && !schedule.collector.trim()) {
    throw new QuantError(
      "INVALID_INPUT",
      "Fee collector must be a non-empty account name.",
      "fees.collector",
    );
  }
}

function ensureAccount(accounts: Map<string, MutableAccount>, owner: string): MutableAccount {
  let account = accounts.get(owner);
  if (!account) {
    account = { owner, cash: 0, inventory: 0, feesPaid: 0 };
    accounts.set(owner, account);
  }
  return account;
}

function normalizeFeeSchedule(
  schedule: OrderBookFeeSchedule | undefined,
): NormalizedFeeSchedule {
  return {
    makerRate: schedule?.makerRate ?? 0,
    takerRate: schedule?.takerRate ?? 0,
    fixedPerTrade: schedule?.fixedPerTrade ?? 0,
    collector: schedule?.collector ?? "fee-collector",
  };
}

function processOrderBookEvent(
  event: OrderBookEvent,
  sequence: number,
  orders: MutableOrder[],
  accounts: Map<string, MutableAccount>,
  trades: Trade[],
  fees: NormalizedFeeSchedule,
): {
  status: OrderBookResult["eventLog"][number]["status"];
  executedQuantity: number;
  message: string;
  tradeStartIndex: number;
} {
  const tradeStartIndex = trades.length;
  if (event.kind === "cancel") {
    const orderIndex = orders.findIndex(
      (order) => order.id === event.orderId && order.owner === event.owner,
    );
    if (orderIndex < 0) {
      return { status: "rejected", executedQuantity: 0, message: "Order not found or not owned by requester.", tradeStartIndex };
    }
    orders.splice(orderIndex, 1);
    return { status: "cancelled", executedQuantity: 0, message: "Resting order cancelled.", tradeStartIndex };
  }

  const incoming: MutableOrder = {
    id: event.id,
    owner: event.owner,
    side: event.side,
    price:
      event.kind === "market"
        ? event.side === "buy"
          ? Number.POSITIVE_INFINITY
          : 0
        : event.price,
    remainingQuantity: event.quantity,
    sequence,
  };
  matchIncoming(
    incoming,
    event.kind,
    orders,
    accounts,
    trades,
    event.id,
    fees,
  );
  const executedQuantity = event.quantity - incoming.remainingQuantity;
  if (event.kind === "limit" && incoming.remainingQuantity > 0) orders.push(incoming);
  const status =
    incoming.remainingQuantity === 0
      ? "filled"
      : executedQuantity > 0
        ? "partially-filled"
        : event.kind === "limit"
          ? "accepted"
          : "rejected";
  return {
    status,
    executedQuantity,
    message:
      status === "rejected"
        ? "No opposite liquidity was available."
        : status === "accepted"
          ? "Limit order rests on the book."
          : `${executedQuantity} units executed.`,
    tradeStartIndex,
  };
}

function matchIncoming(
  incoming: MutableOrder,
  kind: "limit" | "market",
  orders: MutableOrder[],
  accounts: Map<string, MutableAccount>,
  trades: Trade[],
  eventId: string,
  fees: NormalizedFeeSchedule,
): void {
  while (incoming.remainingQuantity > 0) {
    const candidates = orders
      .filter((order) => order.side !== incoming.side && crosses(incoming, order, kind))
      .sort(priceTimeComparator(incoming.side));
    const maker = candidates[0];
    if (!maker) return;
    const quantity = Math.min(incoming.remainingQuantity, maker.remainingQuantity);
    const buyer = incoming.side === "buy" ? incoming.owner : maker.owner;
    const seller = incoming.side === "sell" ? incoming.owner : maker.owner;
    const notional = maker.price * quantity;
    const makerFee = notional * fees.makerRate;
    const takerFee = notional * fees.takerRate + fees.fixedPerTrade;
    assertFinite(notional, `events.${eventId}.notional`);
    assertFinite(makerFee, `events.${eventId}.makerFee`);
    assertFinite(takerFee, `events.${eventId}.takerFee`);
    settleTrade(
      accounts,
      buyer,
      seller,
      maker.owner,
      incoming.owner,
      maker.price,
      quantity,
      makerFee,
      takerFee,
      fees.collector,
    );
    trades.push({
      eventId,
      price: maker.price,
      quantity,
      buyer,
      seller,
      maker: maker.owner,
      taker: incoming.owner,
      makerOrderId: maker.id,
      makerFee,
      takerFee,
      totalFees: makerFee + takerFee,
    });
    incoming.remainingQuantity -= quantity;
    maker.remainingQuantity -= quantity;
    if (maker.remainingQuantity === 0) {
      orders.splice(orders.indexOf(maker), 1);
    }
  }
}

function crosses(
  incoming: MutableOrder,
  resting: MutableOrder,
  kind: "limit" | "market",
): boolean {
  if (kind === "market") return true;
  return incoming.side === "buy"
    ? incoming.price >= resting.price
    : incoming.price <= resting.price;
}

function priceTimeComparator(incomingSide: OrderSide) {
  return (left: MutableOrder, right: MutableOrder): number => {
    if (left.price !== right.price) {
      return incomingSide === "buy" ? left.price - right.price : right.price - left.price;
    }
    return left.sequence - right.sequence;
  };
}

function settleTrade(
  accounts: Map<string, MutableAccount>,
  buyer: string,
  seller: string,
  maker: string,
  taker: string,
  price: number,
  quantity: number,
  makerFee: number,
  takerFee: number,
  feeCollector: string,
): void {
  const buyerAccount = ensureAccount(accounts, buyer);
  const sellerAccount = ensureAccount(accounts, seller);
  const makerAccount = ensureAccount(accounts, maker);
  const takerAccount = ensureAccount(accounts, taker);
  const cash = price * quantity;
  buyerAccount.cash -= cash;
  buyerAccount.inventory += quantity;
  sellerAccount.cash += cash;
  sellerAccount.inventory -= quantity;
  makerAccount.cash -= makerFee;
  makerAccount.feesPaid += makerFee;
  takerAccount.cash -= takerFee;
  takerAccount.feesPaid += takerFee;
  if (makerFee + takerFee > 0) {
    ensureAccount(accounts, feeCollector).cash += makerFee + takerFee;
  }
}

function sortedAccounts(
  accounts: ReadonlyMap<string, MutableAccount>,
): LedgerAccount[] {
  return [...accounts.values()]
    .map((account) => ({ ...account }))
    .sort((left, right) => left.owner.localeCompare(right.owner));
}

function snapshotAccounting(
  accounts: ReadonlyMap<string, MutableAccount>,
  eventIndex: number,
  eventId: string,
  initialCash: number,
  initialInventory: number,
  initialFeesPaid: number,
  trades: readonly Trade[],
): OrderBookAccountingSnapshot {
  const accountRows = sortedAccounts(accounts);
  const totalCash = accountRows.reduce(
    (total, account) => total + account.cash,
    0,
  );
  const totalInventory = accountRows.reduce(
    (total, account) => total + account.inventory,
    0,
  );
  const cumulativeFeesCharged = trades.reduce(
    (total, trade) => total + trade.totalFees,
    0,
  );
  const recordedFeesPaid = accountRows.reduce(
    (total, account) => total + (account.feesPaid ?? 0),
    0,
  );
  assertFinite(totalCash, `accounting.${eventIndex}.totalCash`);
  assertFinite(totalInventory, `accounting.${eventIndex}.totalInventory`);
  assertFinite(
    cumulativeFeesCharged,
    `accounting.${eventIndex}.cumulativeFeesCharged`,
  );
  assertFinite(recordedFeesPaid, `accounting.${eventIndex}.recordedFeesPaid`);
  const cashDifference = totalCash - initialCash;
  const inventoryDifference = totalInventory - initialInventory;
  const feeAccountingDifference =
    recordedFeesPaid - initialFeesPaid - cumulativeFeesCharged;
  const cashTolerance = 1e-10 * Math.max(1, Math.abs(initialCash));
  const inventoryTolerance = 1e-10 * Math.max(1, Math.abs(initialInventory));
  const feeTolerance = 1e-10 * Math.max(1, cumulativeFeesCharged);
  return {
    eventIndex,
    eventId,
    accounts: accountRows,
    totalCash,
    totalInventory,
    cumulativeFeesCharged,
    cashDifference,
    inventoryDifference,
    feeAccountingDifference,
    cashConserved: Math.abs(cashDifference) <= cashTolerance,
    inventoryConserved: Math.abs(inventoryDifference) <= inventoryTolerance,
    feesReconciled: Math.abs(feeAccountingDifference) <= feeTolerance,
  };
}

function sortOrders(orders: readonly MutableOrder[]): MutableOrder[] {
  return [...orders].sort((left, right) => {
    if (left.side !== right.side) return left.side === "buy" ? -1 : 1;
    if (left.price !== right.price) {
      return left.side === "buy" ? right.price - left.price : left.price - right.price;
    }
    return left.sequence - right.sequence;
  });
}

function snapshotBook(
  orders: readonly MutableOrder[],
  eventIndex: number,
  maxPriceLevels: number,
): OrderBookSnapshot {
  const aggregate = (side: OrderSide): { price: number; quantity: number }[] => {
    const levels = new Map<number, number>();
    for (const order of orders.filter((candidate) => candidate.side === side)) {
      levels.set(order.price, (levels.get(order.price) ?? 0) + order.remainingQuantity);
    }
    return [...levels.entries()]
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((left, right) =>
        side === "buy" ? right.price - left.price : left.price - right.price,
      )
      .slice(0, maxPriceLevels);
  };
  const bids = aggregate("buy");
  const asks = aggregate("sell");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    eventIndex,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid === null || bestAsk === null ? null : bestAsk - bestBid,
  };
}

function midpoint(snapshot: OrderBookSnapshot): number | null {
  return snapshot.bestBid === null || snapshot.bestAsk === null
    ? null
    : (snapshot.bestBid + snapshot.bestAsk) / 2;
}

function validateAgentMarketInput(input: AgentMarketInput): void {
  if (input.contract !== "trading-lab/agent-market@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported agent-market contract.");
  }
  assertPositive(input.initialPrice, "initialPrice");
  assertPositive(input.tickSize, "tickSize");
  assertIntegerInRange(input.steps, 1, 1_000, "steps");
  assertIntegerInRange(input.seed, -2_147_483_648, 2_147_483_647, "seed");
  assertIntegerInRange(input.agents.length, 1, 64, "agents.length");
  if (new Set(input.agents.map((agent) => agent.id)).size !== input.agents.length) {
    throw new QuantError("INVALID_INPUT", "Agent IDs must be non-empty and unique.");
  }
  const eventsPerStep = input.agents.reduce(
    (total, agent) => total + (agent.kind === "market-maker" ? 2 : 1),
    0,
  );
  const generatedEvents = eventsPerStep * input.steps;
  if (generatedEvents > 10_000) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "The scenario may generate at most 10,000 order-book events.",
      "steps",
    );
  }
  const replayEvents =
    (eventsPerStep * input.steps * (input.steps + 1)) / 2;
  if (replayEvents > 2_000_000) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "The scenario exceeds the 2,000,000-event replay work budget.",
      "steps",
    );
  }
  input.agents.forEach((agent, index) => {
    if (!agent.id.trim()) throw new QuantError("INVALID_INPUT", "Agent ID is required.");
    assertPositive(agent.orderSize, `agents.${index}.orderSize`);
    if (agent.fundamentalValue !== undefined) {
      assertPositive(agent.fundamentalValue, `agents.${index}.fundamentalValue`);
    }
    if (agent.targetRiskBudget !== undefined) {
      assertPositive(
        agent.targetRiskBudget,
        `agents.${index}.targetRiskBudget`,
      );
    }
    if (agent.riskLookback !== undefined) {
      assertIntegerInRange(
        agent.riskLookback,
        2,
        1_000,
        `agents.${index}.riskLookback`,
      );
    }
    if (agent.maximumInventory !== undefined) {
      assertPositive(
        agent.maximumInventory,
        `agents.${index}.maximumInventory`,
      );
    }
  });
  validateFeeSchedule(input.fees);
}

function decideAgentOrders(
  agent: AgentSpec,
  step: number,
  latestPrice: number,
  history: readonly number[],
  tickSize: number,
  random: ReturnType<typeof createSemanticRandom>,
  sequence: number,
  inventory: number,
): {
  rationale: string;
  events: OrderBookEvent[];
  estimatedVolatility?: number;
  riskBudget?: number;
  targetInventory?: number;
} {
  const id = (suffix: string) => `${agent.id}/${step}/${sequence}/${suffix}`;
  if (agent.kind === "market-maker") {
    return {
      rationale: "Quotes one tick around the latest trade to supply two-sided liquidity.",
      events: [
        { kind: "limit", id: id("bid"), owner: agent.id, side: "buy", price: Math.max(tickSize, latestPrice - tickSize), quantity: agent.orderSize },
        { kind: "limit", id: id("ask"), owner: agent.id, side: "sell", price: latestPrice + tickSize, quantity: agent.orderSize },
      ],
    };
  }
  let side: OrderSide;
  let rationale: string;
  if (agent.kind === "fundamental") {
    const fairValue = agent.fundamentalValue ?? latestPrice;
    side = latestPrice <= fairValue ? "buy" : "sell";
    rationale = `Trades toward the illustrative fundamental value ${fairValue}.`;
  } else if (agent.kind === "trend") {
    side = history.length < 2 || history.at(-1)! >= history.at(-2)! ? "buy" : "sell";
    rationale = "Follows the sign of the latest observed price change.";
  } else if (agent.kind === "risk-budget" || agent.kind === "risk-parity") {
    const estimatedVolatility = estimateRecentVolatility(
      history,
      agent.riskLookback ?? 20,
      tickSize / latestPrice,
    );
    const riskBudget =
      agent.targetRiskBudget ??
      agent.orderSize * latestPrice * estimatedVolatility;
    const riskPerUnit = latestPrice * estimatedVolatility;
    const inventoryLimit = Math.min(
      agent.maximumInventory ?? 10 * agent.orderSize,
      riskBudget / riskPerUnit,
    );
    const lastMove =
      history.length < 2 ? 0 : history.at(-1)! - history.at(-2)!;
    const direction =
      lastMove > 0
        ? 1
        : lastMove < 0
          ? -1
          : random.uniform("risk-budget-direction", step, agent.id) < 0.5
            ? 1
            : -1;
    const targetInventory = direction * inventoryLimit;
    const inventoryGap = targetInventory - inventory;
    if (Math.abs(inventoryGap) <= 1e-12) {
      return {
        rationale:
          "No order: settled inventory already meets the one-step volatility risk budget.",
        events: [],
        estimatedVolatility,
        riskBudget,
        targetInventory,
      };
    }
    side = inventoryGap > 0 ? "buy" : "sell";
    const quantity = Math.min(agent.orderSize, Math.abs(inventoryGap));
    rationale =
      agent.kind === "risk-parity"
        ? "Compatibility alias: sizes single-asset inventory to a cash risk budget; true risk parity needs multiple assets."
        : "Sizes settled inventory so estimated one-step marked-to-market volatility stays within its cash risk budget.";
    return {
      rationale,
      events: [
        {
          kind: "market",
          id: id("market"),
          owner: agent.id,
          side,
          quantity,
        },
      ],
      estimatedVolatility,
      riskBudget,
      targetInventory,
    };
  } else {
    side = random.uniform("agent", step, agent.id) < 0.5 ? "buy" : "sell";
    rationale = "Submits an explicitly uncalibrated noise order.";
  }
  return {
    rationale,
    events: [{ kind: "market", id: id("market"), owner: agent.id, side, quantity: agent.orderSize }],
  };
}

function estimateRecentVolatility(
  history: readonly number[],
  lookback: number,
  minimumVolatility: number,
): number {
  const start = Math.max(1, history.length - lookback);
  const returns: number[] = [];
  for (let index = start; index < history.length; index += 1) {
    const prior = history[index - 1];
    if (prior > 0) returns.push(history[index] / prior - 1);
  }
  if (returns.length < 2) return minimumVolatility;
  const average = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - average) ** 2, 0) /
    (returns.length - 1);
  return Math.max(minimumVolatility, Math.sqrt(variance));
}

function markAgentWealth(
  agents: readonly AgentSpec[],
  accounts: readonly LedgerAccount[],
  markPrice: number,
): AgentMarketResult["agentWealth"] {
  return agents.map((agent) => {
    const account = accounts.find((candidate) => candidate.owner === agent.id) ?? {
      cash: 0,
      inventory: 0,
      feesPaid: 0,
    };
    const feesPaid = account.feesPaid ?? 0;
    const markedWealth = account.cash + account.inventory * markPrice;
    return {
      agentId: agent.id,
      cash: account.cash,
      inventory: account.inventory,
      feesPaid,
      grossMarkedWealth: markedWealth + feesPaid,
      markedWealth,
    };
  });
}

function validateAlmgrenChrissInput(input: AlmgrenChrissInput): void {
  if (input.contract !== "trading-lab/almgren-chriss@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported Almgren-Chriss contract.");
  }
  assertPositive(input.shares, "shares");
  assertPositive(input.horizon, "horizon");
  assertIntegerInRange(input.intervals, 1, 10_000, "intervals");
  assertNonNegative(input.volatilityPerSqrtTime, "volatilityPerSqrtTime");
  assertPositive(input.temporaryImpact, "temporaryImpact");
  assertNonNegative(input.permanentImpact, "permanentImpact");
  assertNonNegative(input.riskAversion, "riskAversion");
}

function buildLiquidationSchedule(
  input: AlmgrenChrissInput,
  riskAversion: number,
): Omit<AlmgrenChrissResult, "contract" | "urgencyFrontier"> {
  const intervalLength = input.horizon / input.intervals;
  const kappaInterval = stableKappaInterval(
    riskAversion,
    input.volatilityPerSqrtTime,
    intervalLength,
    input.temporaryImpact,
  );
  const times = Array.from(
    { length: input.intervals + 1 },
    (_, index) => index * intervalLength,
  );
  const sharesRemaining = times.map((_, index) => {
    if (kappaInterval === 0) {
      return input.shares * (1 - index / input.intervals);
    }
    const ratio = stableHyperbolicLiquidationRatio(
      kappaInterval,
      input.intervals,
      index,
    );
    return input.shares * ratio;
  });
  sharesRemaining[0] = input.shares;
  sharesRemaining[sharesRemaining.length - 1] = 0;
  for (let index = 1; index < sharesRemaining.length; index += 1) {
    sharesRemaining[index] = Math.max(
      0,
      Math.min(sharesRemaining[index - 1], sharesRemaining[index]),
    );
  }
  const trades = sharesRemaining
    .slice(0, -1)
    .map((value, index) => value - sharesRemaining[index + 1]);
  const expectedTemporaryCost =
    (input.temporaryImpact / intervalLength) *
    trades.reduce((total, trade) => total + trade ** 2, 0);
  const expectedPermanentCost = input.permanentImpact * input.shares ** 2 / 2;
  const expectedCost = expectedTemporaryCost + expectedPermanentCost;
  const costVariance =
    input.volatilityPerSqrtTime ** 2 *
    intervalLength *
    sharesRemaining
      .slice(0, -1)
      .reduce((total, shares) => total + shares ** 2, 0);
  [
    expectedTemporaryCost,
    expectedPermanentCost,
    expectedCost,
    costVariance,
  ].forEach((value, index) =>
    assertFinite(value, `almgrenChriss.cost.${index}`),
  );
  const objective = expectedCost + riskAversion * costVariance;
  assertFinite(objective, "almgrenChriss.objective");
  return {
    times,
    sharesRemaining,
    trades,
    expectedTemporaryCost,
    expectedPermanentCost,
    expectedCost,
    costVariance,
    objective,
  };
}

/**
 * Returns kappa * interval without ever forming a potentially overflowing
 * product. acosh(1 + x) is evaluated with log1p for small x and its stable
 * asymptote for very large x.
 */
function stableKappaInterval(
  riskAversion: number,
  volatility: number,
  intervalLength: number,
  temporaryImpact: number,
): number {
  if (riskAversion === 0 || volatility === 0) return 0;
  const logX =
    Math.log(riskAversion) +
    2 * Math.log(volatility) +
    2 * Math.log(intervalLength) -
    Math.log(2) -
    Math.log(temporaryImpact);
  assertFinite(logX, "almgrenChriss.logUrgencyRatio");
  if (logX > 35) return Math.log(2) + logX;
  const x = Math.exp(logX);
  return Math.log1p(x + Math.sqrt(x * (x + 2)));
}

function stableHyperbolicLiquidationRatio(
  kappaInterval: number,
  intervals: number,
  elapsedIntervals: number,
): number {
  if (elapsedIntervals === 0) return 1;
  if (elapsedIntervals >= intervals) return 0;
  const remainingArgument = kappaInterval * (intervals - elapsedIntervals);
  const totalArgument = kappaInterval * intervals;
  const exponentialRatio = Math.exp(-kappaInterval * elapsedIntervals);
  const numeratorCorrection = -Math.expm1(-2 * remainingArgument);
  const denominatorCorrection = -Math.expm1(-2 * totalArgument);
  return exponentialRatio * (numeratorCorrection / denominatorCorrection);
}

function envelope<Result>(
  inputContract: string,
  resultContract: string,
  seed: number | undefined,
  result: Result,
  warnings: readonly ModelWarning[] = [],
): ModelEnvelope<Result> {
  return {
    result,
    warnings,
    provenance: {
      engineVersion: `${TRADING_LAB_VERSION}+${QUANT_CORE_VERSION}`,
      ...(seed === undefined ? {} : { seed }),
      inputContract,
      resultContract,
    },
  };
}
