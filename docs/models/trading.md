# Trading and market-microstructure models

Implementation: [`trading.ts`](../../src/lib/quant/trading.ts). Validation
examples: [`trading.test.ts`](../../src/lib/quant/trading.test.ts). These models
separate a stochastic spread, a deterministic event ledger, illustrative agent
rules, and an analytical execution-cost model; they are not one calibrated
market simulator.

## Ornstein-Uhlenbeck spread simulation and fitting

- **Question answered.** How quickly does a stationary spread revert toward an
  equilibrium, how often does it cross entry/exit thresholds, and what OU
  parameters correspond to a fitted AR(1) relation?
- **Equations.** $dX_t=\kappa(\theta-X_t)dt+\sigma dW_t$.
  Over $\Delta$, $E[X_{t+\Delta}|X_t]=\theta+(X_t-\theta)e^{-\kappa\Delta}$,
  $Var=\sigma^2(1-e^{-2\kappa\Delta})/(2\kappa)$, and half-life is
  $\log2/\kappa$. Fitting $X_{t+1}=a+bX_t+\epsilon_t$ gives
  $\kappa=-\log b/\Delta$ and $\theta=a/(1-b)$ when $0<b<1$.
- **Units and conventions.** Spread/equilibrium/thresholds share arbitrary spread
  units; volatility is spread units per square-root year; $\kappa$ is per year;
  `stepYears` and half-life are years. Entry uses absolute deviation from
  equilibrium; exit threshold must be smaller than entry threshold.
- **Implementation.** Simulation samples the exact Gaussian transition. A path
  enters long below equilibrium or short above it and exits inside the smaller
  band; equilibrium hit means consecutive points lie on opposite sides or on the
  equilibrium. OLS fitting estimates AR(1), converts stationary coefficients,
  and maps residual variance back to continuous OU volatility.
- **Validation gate.** Exact one-step moments and half-life agree with formulas;
  fixed seeds replay; a stationary synthetic series fits; AR coefficients
  outside `(0,1)` are explicitly labeled nonstationary; thresholds and bounded
  path/step inputs validate.
- **Worked intuition.** If $\kappa=\log2$ per year, half-life is one year. A
  spread 4 units above equilibrium has conditional mean only 2 units above it
  one year later, before adding the random shock.
- **Assumptions and limitations.** OU is Gaussian with constant parameters and
  can take any real value. Threshold signals ignore hedge ratios, costs,
  execution, overlapping positions, and P&L. The fitter checks only the AR(1)
  coefficient, not cointegration or a broader stationarity test.
- **Educational disclaimer.** OU thresholds and fitted half-life are teaching
  diagnostics, not pairs-trading signals or evidence of arbitrage.

## Deterministic limit-order-book engine

- **Question answered.** Given an ordered event list, which orders trade under
  price-time priority, what book/ledger state follows, and do cash, inventory,
  and executed quantity conserve?
- **Equations.** For trade price $p$ and quantity $q$, before fees the buyer
  changes by $(-pq,+q)$ and seller by $(+pq,-q)$. Optional maker and taker fees
  are notional rates, with an optional fixed taker fee per match; the fee
  collector receives exactly what both accounts pay. Spread is best ask minus
  best bid; signed slippage is `+(trade-mid)` for a buy aggressor and
  `-(trade-mid)` for a sell aggressor.
- **Units and conventions.** Price and cash share a currency; quantity/inventory
  share asset units. An incoming buy matches lowest ask first; an incoming sell
  matches highest bid first; equal prices use earlier event sequence. Trades
  execute at the resting maker's price.
- **Implementation.** Limit orders cross available liquidity then rest any
  remainder. Market orders consume available opposite orders and reject an
  unfilled remainder. Only an order's owner may cancel it. Every event produces
  a bounded aggregated ladder, replay record, and accounting snapshot. Accounts
  default to zero; settlement is double entry; and an enabled fee schedule
  records each side's cumulative costs and credits one explicit collector
  account.
- **Validation gate.** Fixed event replay gives identical state; price-time
  priority fixtures identify the correct maker; cancellations enforce ownership;
  every accounting snapshot reconciles cash, inventory, and collected fees;
  executed buy quantity equals executed sell quantity; fee inputs are
  nonnegative; event IDs are unique; and event count is bounded.
- **Worked intuition.** If asks are 5 units at 100 from A, then 4 units at 100
  from B, a market buy of 6 fills all 5 from A and 1 from B. Equal price did not
  make allocation random: A arrived first.
- **Assumptions and limitations.** The engine permits negative cash and inventory,
  so there are no credit, margin, locate, or position limits. Its optional fees
  are fixed inputs rather than a tiered exchange schedule. It has no hidden
  orders, amendments, latency, auctions, tick validation, or stochastic arrivals.
  `priceImpact` is last trade minus first trade and is not a causal impact
  estimate.
- **Educational disclaimer.** The replay engine explains matching/accounting;
  it is not an exchange, execution venue, or slippage forecast.

## Agent-based market scenario

- **Question answered.** What deterministic order flow and marked wealth emerge
  when simple fundamental, trend, market-making, noise, and single-asset
  risk-budget rules submit orders to the validated book?
- **Equations.** Net marked wealth is
  $cash+inventory\times P_{final}$; gross marked wealth adds recorded fees back
  only to make their effect visible. The risk-budget rule estimates recent
  one-step volatility $\hat\sigma$ and bounds target inventory by
  $B/(P\hat\sigma)$ and a configured maximum, where $B$ is a cash risk budget.
  This is not multi-asset equal-risk-contribution allocation.
- **Units and conventions.** Price/tick/fundamental value share currency per unit;
  `orderSize` is quantity; steps are event rounds, not physical time. Every rule
  emits ordinary order-book events and uses the same double-entry ledger.
- **Implementation.** Semantic random sides make noise and zero-move directions
  reproducible. Each round replays the complete event list to obtain settled
  inventory and the latest trade before the next decision. The result includes
  per-decision observed inventory and risk diagnostics, a per-round wealth
  history, the final book/accounts, gross and fee-inclusive marked wealth, and
  `scenarioNotForecast: true`. The old `risk-parity` name is accepted only as a
  deprecated compatibility alias for `risk-budget`.
- **Validation gate.** Agent IDs are unique, values, risk budgets, lookbacks,
  inventory caps, fees, and step bounds validate; fixed seeds replay
  decisions/book exactly; risk decisions use settled fills rather than submitted
  hints; every strategy routes through the order-book engine; and every wealth
  snapshot retains the ledger's accounting identities.
- **Worked intuition.** At last price 100 and tick 1, a market maker posts bid 99
  and ask 101. A fundamental agent with value 105 submits a market buy, which can
  lift 101 if that quote is the best available ask.
- **Assumptions and limitations.** Rules are intentionally stylized and
  uncalibrated. A one-asset volatility budget is not covariance-based portfolio
  risk parity, and a short recent price history is a fragile volatility estimate.
  Agents have unlimited financing/shorting, no strategic learning or latency,
  and may submit market orders when no liquidity exists.
- **Educational disclaimer.** Agent results are synthetic scenario dynamics,
  not behavioral evidence, a market forecast, or a trading strategy.

## Almgren-Chriss optimal liquidation

- **Question answered.** How should a fixed position be liquidated across a
  horizon when temporary impact penalizes fast trading and risk aversion
  penalizes price uncertainty while shares remain?
- **Equations.** With interval $\tau=T/N$,
  $\kappa=\operatorname{acosh}[1+\lambda\sigma^2\tau^2/(2\eta)]/\tau$ and
  $x(t)=X\sinh[\kappa(T-t)]/\sinh(\kappa T)$; when $\kappa=0$ the schedule is
  linear. Temporary cost is $(\eta/\tau)\sum n_k^2$, permanent cost is
  $\gamma X^2/2$, variance is $\sigma^2\tau\sum x_k^2$, and objective is
  $E[C]+\lambda Var(C)$.
- **Units and conventions.** Shares/trades use quantity; horizon and volatility's
  square-root time use one consistent caller-selected time unit; temporary and
  permanent impact must use compatible price/quantity units; risk aversion is the
  matching inverse cost-variance unit. Trades are positive liquidation amounts.
- **Implementation.** The analytical hyperbolic-sine inventory trajectory is
  sampled at `intervals + 1` endpoints and the final value is forced to zero.
  A log-domain urgency calculation and exponentially scaled sinh ratio avoid
  overflow in high-risk inputs. Costs are decomposed exactly. An urgency frontier
  reruns the same formula at six illustrative risk aversions scaled by position
  size.
- **Validation gate.** Opening inventory equals requested shares, final inventory
  is zero, holdings decrease monotonically, trades sum to shares, temporary plus
  permanent cost equals total expected cost, objective reconciles, zero risk
  aversion or zero volatility produces a linear schedule, and a fixed extreme-
  urgency fixture remains finite and front-loads liquidation.
- **Worked intuition.** Liquidating 100 shares over four equal intervals with
  zero risk aversion leaves `[100, 75, 50, 25, 0]` and trades 25 each time.
  Increasing risk aversion front-loads trades to reduce the variance accumulated
  while inventory is still held.
- **Assumptions and limitations.** Impact is deterministic, linear/permanent and
  quadratic/temporary under fixed parameters; volatility and liquidity are
  constant; there are no spread, fees, drift, volume constraints, random fills,
  or order-book dynamics. The urgency frontier's values are illustrative rather
  than calibrated.
- **Educational disclaimer.** The schedule is an optimal-execution lesson under
  stylized assumptions, not an instruction to trade or an impact estimate.

## Further reading

See the bibliography for [trading and microstructure](references.md#trading-and-microstructure)
and [shared numerical foundations](references.md#shared-numerical-foundations).
