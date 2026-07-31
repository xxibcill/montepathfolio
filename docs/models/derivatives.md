# Derivatives models

Implementation: [`derivatives.ts`](../../src/lib/quant/derivatives.ts).
Validation examples: [`derivatives.test.ts`](../../src/lib/quant/derivatives.test.ts).
One contract represents one unit of underlying. Rates and dividend yields are
continuously compounded annual decimals, volatility is annual, and time is years.

## Black-Scholes-Merton, Greeks, payoff diagrams, and surfaces

- **Question answered.** What is the model value and local sensitivity of a
  European call or put, and how are model value, expiry payoff, trade P&L, and a
  sensitivity surface different objects?
- **Equations.** $d_1=[\ln(S/K)+(r-q+\sigma^2/2)T]/(\sigma\sqrt T)$,
  $d_2=d_1-\sigma\sqrt T$, and
  $C=Se^{-qT}N(d_1)-Ke^{-rT}N(d_2)$;
  $P=Ke^{-rT}N(-d_2)-Se^{-qT}N(-d_1)$. Payoff is
  $\max(S_T-K,0)$ or $\max(K-S_T,0)$; long P&L is quantity times
  `(payoff - premium)`.
- **Units and conventions.** Price/payoff/P&L use the spot currency. Delta is
  value per one-unit spot move, gamma is delta per spot unit, theta is value
  change for one year of calendar time passing, and raw vega/rho are for a 1.00
  absolute volatility/rate move; per-1% forms divide by 100.
- **Implementation.** Analytical price and core Greeks use the shared normal CDF
  and PDF. Explicit branches handle expiry and zero-volatility forward limits.
  Payoff diagrams use observed premium and side separately from model value.
  Surfaces reevaluate the same kernel over spot → volatility → time and are
  capped at 50,000 cells. The learner chapter exposes the continuous dividend
  yield and lets the learner select a bounded 61-cell spot, volatility, or
  time-to-expiry slice rather than hiding those assumptions.
- **Validation gate.** Known call/put fixtures, dividend-adjusted put-call parity,
  intrinsic/no-arbitrage bounds, and finite-difference delta/gamma/vega/theta/rho
  checks pass; expiry and deterministic-forward cases remain finite; payoff and
  P&L are not mislabeled as price.
- **Worked intuition.** For $S=K=100$, $T=1$, $r=5\%$, $q=0$, and
  $\sigma=20\%$, the call is about 10.45. Its expiry payoff is still zero when
  $S_T\le100$ and its trade P&L also subtracts the premium—three different
  quantities despite sharing one option.
- **Assumptions and limitations.** Exercise is European; volatility, rates, and
  dividend yield are constant; markets are frictionless; log returns are
  Gaussian; and the underlying is continuously tradable. Analytical Greeks are
  local derivatives, not guaranteed hedge outcomes through jumps or discrete
  trading.
- **Educational disclaimer.** Values and Greeks demonstrate a pricing model;
  they are not market quotes, fair-value opinions, or trading advice.

## Cox-Ross-Rubinstein binomial tree

- **Question answered.** What option value follows from repeated risk-neutral
  up/down steps, and when is immediate American exercise worth more than
  continuation?
- **Equations.** With $\Delta t=T/n$,
  $u=e^{\sigma\sqrt{\Delta t}}$, $d=1/u$,
  $p=[e^{(r-q)\Delta t}-d]/(u-d)$, and
  $V=e^{-r\Delta t}[pV_u+(1-p)V_d]$. American nodes replace $V$ with
  $\max(V,\text{intrinsic})$.
- **Units and conventions.** Rates/volatility/time match Black-Scholes. A node's
  `upMoves` identifies $S u^{upMoves}d^{step-upMoves}$. Maturity payoff is not
  marked as early exercise. Root theta uses the middle two-step value change
  over $2\Delta t$.
- **Implementation.** Terminal payoff is rolled backward one layer at a time.
  The engine records continuation, intrinsic, chosen value, and exercise
  boundaries when node storage is requested. Steps are capped at 2,000 and
  stored nodes at 20,000; large trees can return only summary analytics. Result
  metadata states total, stored, and maximum node counts so omission is visible
  rather than inferred from an empty array.
- **Validation gate.** The risk-neutral probability must lie in `[0,1]`;
  one-step hand calculations agree; American value is at least European value;
  European prices converge toward Black-Scholes as steps grow; node count and
  input limits are enforced.
- **Worked intuition.** For one step with $S=K=100$, $u=1.1$, $d=1/1.1$,
  and $r=q=0$, $p=(1-d)/(u-d)\approx.4762$. Call payoffs are 10 and 0, so its
  value is $0.4762(10)\approx4.76$.
- **Assumptions and limitations.** CRR is a discrete approximation with constant
  parameters. Exercise boundaries can move with step count, node storage is
  deliberately bounded, and the model omits dividends other than a continuous
  yield, transaction costs, discrete hedging error, and volatility smiles.
- **Educational disclaimer.** Tree prices and exercise regions are learning
  outputs, not exercise recommendations or executable prices.

## Exact-GBM Monte Carlo option pricing

- **Question answered.** What is the discounted expected payoff, with sampling
  uncertainty, for European, Asian, discretely monitored barrier, lookback, or
  basket options?
- **Equations.** At monitoring dates,
  $S_{t+\Delta}=S_t\exp[(r-q-\sigma^2/2)\Delta+
  \sigma\sqrt\Delta Z]$. The estimate is
  $\hat V=n^{-1}\sum e^{-rT}g(path_i)$, with
  $SE=s/\sqrt n$ and 95% interval $\hat V\pm1.95996SE$.
  A control produces $Y^*=Y-\beta(X-E[X])$ with
  $\beta=\operatorname{Cov}(Y,X)/\operatorname{Var}(X)$.
- **Units and conventions.** Risk-neutral drift uses continuous annual rates;
  payoffs and estimates are currency. The simulated path includes $S_0$;
  Asian/lookback specifications choose whether it is monitored. Barriers always
  inspect $S_0$ and all simulated dates. Antithetic pair averages are one
  independent observation for standard error.
- **Implementation.** Single assets use exact GBM transitions at each monitoring
  date; baskets use Cholesky-correlated transitions for 2–20 assets. Arithmetic
  or geometric Asian, in/out up/down barrier with maturity rebate, fixed/floating
  lookback, and weighted basket payoff rules are separately inspectable. Optional
  antithetic shocks and a discounted underlying/average control leave the
  estimand unchanged. Work is capped at ten million asset-steps. A dedicated
  comparison request creates one immutable European option contract, prices it
  analytically, with a European CRR tree, and by Monte Carlo, then reports both
  deviations from Black-Scholes and whether the analytical value lies inside the
  Monte Carlo 95% interval.
- **Validation gate.** Hand-authored paths reproduce every payoff rule; fixed
  seeds replay; European confidence intervals cover the analytical benchmark in
  deterministic fixtures; control use reduces error in its fixture without
  changing expectation; the three-method comparison cannot drift to different
  strikes/rates/maturities; every estimate reports finite SE/interval;
  correlation is PSD and antithetic path count is even.
- **Worked intuition.** For an arithmetic Asian call path `[100, 110, 90]` with
  `includeInitial=false` and strike 95, the monitored average is
  $(110+90)/2=100$, so payoff is 5 before discounting. A vanilla call would use
  only terminal 90 and pay zero.
- **Assumptions and limitations.** Confidence intervals measure Monte Carlo noise,
  not model or calibration uncertainty. Discrete barrier monitoring misses
  between-step crossings; exact GBM steps do not make the payoff discretization
  exact. The control is estimated in-sample and quasi-Monte Carlo/importance
  sampling are not implemented.
- **Educational disclaimer.** Monte Carlo estimates are model demonstrations,
  not tradable valuations or evidence of profit.

## Heston stochastic volatility Monte Carlo

- **Question answered.** How does random mean-reverting variance, correlated with
  price shocks, alter a European option price and produce volatility clustering
  and leverage-effect scenarios?
- **Equations.** $dv=\kappa(\theta-v^+)dt+\xi\sqrt{v^+}dW_v$ and
  $d\log S=(r-q-v^+/2)dt+\sqrt{v^+}dW_s$, where
  $v^+=\max(v,0)$ and $\operatorname{Corr}(dW_s,dW_v)=\rho$.
  $E[v_T]=\theta+(v_0-\theta)e^{-\kappa T}$ when $\kappa>0$.
- **Units and conventions.** Variance is annualized squared volatility;
  $\kappa$ is per year, $\theta$ and $v_0$ are annual variance, $\xi$ is
  volatility of variance, and $\rho$ is dimensionless. The payoff is discounted
  at the continuous risk-free rate.
- **Implementation.** Projected full-truncation Euler uses $v^+$ in coefficients,
  then projects a negative proposed next variance to zero and counts that event.
  Price uses a log-Euler step. Semantic correlated shocks and optional
  antithetic pairs feed a European payoff mean and 95% confidence interval.
  Diagnostics compare sampled and expected terminal variance and observed shock
  correlation. The learner view keeps spot and variance on separate axes, shows
  retained terminal-price quantiles, and plots return against variance change so
  the configured leverage relationship is visible instead of flattened by a
  mixed-scale chart.
- **Validation gate.** Stored variances are nonnegative; fixed seeds replay;
  observed shock correlation tracks $\rho$; long-run variance diagnostics match
  expectation within tolerance; $\xi\to0$ with constant variance approaches
  Black-Scholes; Feller violation and projection frequency are visible warnings.
- **Worked intuition.** If $v_0=\theta=.04$ and $\xi=0$, variance remains .04,
  so volatility is 20% and Heston reduces to constant-variance GBM. Raising
  $\xi$ makes variance paths disperse; a negative $\rho$ tends to pair price
  drops with variance increases.
- **Assumptions and limitations.** Euler time-step bias remains even though
  negative variance is projected. The Feller condition
  $2\kappa\theta\ge\xi^2$ is a diagnostic, not forced calibration. Only European
  Monte Carlo pricing is present; no Heston calibration or semi-analytical price
  is implemented.
- **Educational disclaimer.** Heston paths illustrate stochastic variance, not
  a calibrated volatility surface or trading recommendation.

## Composable option strategies

- **Question answered.** What current value, entry cash flow, expiry payoff/P&L,
  and aggregate Greeks result from combining signed option and underlying legs?
- **Equations.** For any metric $M$,
  $M_{strategy}=\sum_j s_j q_j M_j$, where $s_j=+1$ for long and $-1$ for short.
  Expiry P&L is aggregate payoff minus net initial cost.
- **Units and conventions.** Positive initial cost is a debit and negative is a
  credit. An underlying unit has delta 1 and other option Greeks zero in this
  static snapshot. Supplied premiums/entry prices drive P&L; otherwise current
  model values/spot are used.
- **Implementation.** Covered calls, protective puts, straddles, strangles,
  bull/bear verticals, and iron condors are constructors for ordinary legs, not
  new pricing formulas. Each option leg reuses the Black-Scholes kernel, and up
  to 32 validated legs are summed for model value, cash cost, Greeks, and an
  expiry diagram.
- **Validation gate.** Named constructors produce the expected long/short legs
  and strictly ordered strikes; hand-computed expiry payoffs agree; aggregate
  model values, entry flows, and every Greek equal signed leg sums; arbitrary
  spot diagrams remain finite.
- **Worked intuition.** A covered call with one share and a short call struck at
  110 has expiry payoff $S_T-\max(S_T-110,0)$. At $S_T=130$ that is
  $130-20=110$: upside beyond 110 is exchanged for the call premium received at
  entry.
- **Assumptions and limitations.** Aggregation is static. Financing, stock-leg
  dividends, transaction costs, bid/ask spreads, assignment, margin, taxes, and
  early exercise are excluded; option legs inherit Black-Scholes assumptions.
- **Educational disclaimer.** Strategy diagrams explain payoff composition, not
  trade recommendations, maximum-loss guarantees, or executable economics.

## Further reading

See the bibliography for [derivatives](references.md#derivatives) and
[shared numerical foundations](references.md#shared-numerical-foundations).
