# Risk and retirement models

Implementation: [`risk.ts`](../../src/lib/quant/risk.ts). Validation examples:
[`risk.test.ts`](../../src/lib/quant/risk.test.ts). This lab deliberately calls a
loss positive and keeps standard loss-tail CVaR separate from the portfolio
lab's capital-relative `tailCapitalShortfall`.

## Value at Risk and Conditional Value at Risk

- **Question answered.** At a chosen confidence and holding period, what loss
  threshold is exceeded only in the modeled tail, and what is the mean modeled
  loss at or beyond that threshold?
- **Equations.** Historical/Monte Carlo use
  $\operatorname{VaR}_c=\max(0,Q_c(L))$ and
  $\operatorname{CVaR}_c=\max(\operatorname{VaR}_c,
  \operatorname{mean}\{L_i:L_i\ge\operatorname{VaR}_c\})$.
  Normal mode uses $m_L=-\mu hV$, $s_L=\sigma\sqrt hV$,
  $\operatorname{VaR}=\max(0,m_L+z_cs_L)$, and
  $\operatorname{CVaR}=\max(\operatorname{VaR},m_L+s_L\phi(z_c)/(1-c))$.
- **Units and conventions.** Loss is a currency amount: positive is loss and
  negative is gain. Mean and volatility are arithmetic per-period returns;
  `holdingPeriods` is an integer; confidence is strictly between 50% and 100%.
  Empirical quantiles are R-7. Historical losses are scaled by $\sqrt h$.
- **Implementation.** Historical mode consumes supplied losses. Parametric mode
  evaluates the analytical normal tail. Monte Carlo mode simulates normally
  distributed returns with a semantic seed and converts $r$ to loss $-rV$.
  The finite-sample tail includes every observation equal to or above VaR.
- **Validation gate.** Hand-computed empirical fixtures agree; VaR is monotone
  in confidence for a fixed sample; CVaR never falls below VaR; normal results
  match the analytical formula; Monte Carlo repeats by seed; sample count and
  confidence/resource bounds are enforced.
- **Worked intuition.** For sorted losses `[1, 2, 4, 8]` at 75%, R-7 uses
  position $3\times.75=2.25$, so VaR is $4+.25(8-4)=5$. Only loss 8 is at or
  beyond 5, so CVaR is 8.
- **Assumptions and limitations.** Square-root-of-time scaling assumes stable,
  weakly dependent risk. Normal modes omit skew and fat tails. Historical mode
  treats a finite sample as relevant. Monte Carlo confidence here measures only
  the chosen normal model; none of the methods includes parameter uncertainty.
- **Educational disclaimer.** VaR/CVaR output is for learning risk definitions,
  not a loss guarantee, capital recommendation, or suitability assessment.

## Parametric attribution and rolling VaR backtesting

- **Question answered.** Which capital weights contribute to normal VaR, and did
  a rolling VaR estimate breach as often as its confidence level suggests?
- **Equations.** $\sigma_p=\sqrt{w^\top\Sigma w}$ and
  $\operatorname{VaR}=z_cV\sigma_p$. Marginal contribution is
  $M_i=z_cV(\Sigma w)_i/\sigma_p$; component contribution is $C_i=w_iM_i$,
  hence $\sum_iC_i=\operatorname{VaR}$. Coverage reports
  $LR=-2(\ell(p_0)-\ell(\hat p))$, where $p_0=1-c$.
- **Units and conventions.** Weights are finite and sum to one; covariance is
  per-period return covariance; portfolio value and VaR contributions are
  currency. A backtest breach is strictly `realizedLoss > valueAtRisk`.
- **Implementation.** Attribution multiplies the supplied covariance directly;
  it does not add mean loss. Each backtest point fits only the preceding
  `estimationWindow` returns, using either historical or sample-mean/sample-SD
  normal VaR, then tests the next return. The result exposes estimation indexes,
  optional test timestamps, and supplied data provenance so look-ahead and data
  identity are inspectable. The learner chapter can use the first simple-return
  column of a bounded local CSV; dates and `user-imported` provenance travel into
  every backtest result rather than being replaced by illustrative labels.
- **Validation gate.** Component contributions add back to VaR, estimation end
  is always `testIndex - 1`, expected breaches equal test count times $1-c$,
  inputs align, and fewer than 250 test observations produce a precision
  warning.
- **Worked intuition.** With $V=100$, $c=95\%$, weights `(0.5,0.5)`, and
  independent variances `(0.04,0.01)`, $\sigma_p=\sqrt{.0125}=.1118$ and VaR is
  about 18.39. Component VaR is about 14.71 and 3.68, which sums to 18.39: equal
  capital is not equal risk.
- **Assumptions and limitations.** Attribution is Euler attribution for a
  zero-mean normal VaR and requires a finite, symmetric, positive-semidefinite
  covariance matrix. The Kupiec likelihood-ratio implementation uses its finite
  limiting value in the all-breach and no-breach boundary cases. Backtesting
  diagnoses the supplied history; it does not prove a model.
- **Educational disclaimer.** Attribution and backtest results are diagnostics,
  not regulatory capital, risk limits, or investment advice.

## Retirement cash flows and sequence of returns

- **Question answered.** Given accumulation contributions, inflation, a
  withdrawal rule, and simple-return paths, how often is wealth depleted and how
  much spending and bequest remain? How can return order change the answer?
- **Equations.** Each period applies $W_t^-=W_{t-1}(1+r_t)$, then contributes
  $C/f$ during accumulation or spends
  $s_t=\min(W_t^-,A_t/f)$ in retirement, leaving
  $W_t=\max(0,W_t^- - s_t)$. Fixed-real uses
  $A_t=A_0(1+\pi)^{t/f}$; percentage uses $A_t=qW_t^-$.
- **Units and conventions.** Returns are simple and cannot be below -100%.
  Contributions and withdrawal amounts are annual currency amounts divided by
  `periodsPerYear`; inflation is an annual effective decimal. Aggregate paths use
  `return->cash-flow->record`; multi-asset paths use
  `return->cash-flow->rebalance->record`. Every path includes opening wealth at
  index zero.
- **Implementation.** Fixed-real, percentage-of-current-wealth, and guardrail
  policies are supported. Guardrails inflate the prior annual withdrawal one
  period, then cut or raise it when withdrawal/wealth crosses the upper/lower
  rate. Callers may supply aggregate portfolio returns or path → period → asset
  returns with nonnegative target weights and periodic/never rebalancing.
  Contributions enter at target weights; withdrawals reduce every holding
  proportionally; scheduled rebalancing then restores target weights. Spending
  is capped at wealth, holdings never become negative, and first zero wealth
  records failure. All paths feed summary metrics while returned path detail is
  bounded. Sequence comparison reverses only retirement returns and preserves
  the exact return multiset.
- **Validation gate.** Zero-return ledgers reconcile exactly; every path covers
  the full horizon; asset dimensions and fully invested target weights align;
  withdrawals occur after returns and scheduled rebalancing occurs after cash
  flow; inflation is applied consistently; ending holdings add to bequest;
  wealth remains nonnegative after depletion; reversing returns changes only
  order, not observations; and failure probability is distinct from a target
  probability.
- **Worked intuition.** Start retirement with $100$, zero inflation and returns,
  and fixed-real annual spending $12$ with 12 periods per year. The model spends
  $1$ after each monthly return and ends the first year at $88$ exactly.
- **Assumptions and limitations.** Taxes, fees, Social Security, mortality,
  account location, required distributions, spending floors, and
  asset-specific target bands are absent. Rebalancing is frictionless and either
  never or on one periodic schedule. Percentage withdrawals are recomputed each
  period and then divided by frequency. Reversed paths isolate sequence
  mechanics but are not equally plausible forecasts. The comparison first
  bounds the supplied path to the requested horizon, then reverses only its
  retirement-period suffix.
- **Educational disclaimer.** Retirement results are educational cash-flow
  scenarios, not financial planning, tax advice, or a safe-withdrawal promise.

## Further reading

See the bibliography for [risk and retirement](references.md#risk-and-retirement)
and [shared numerical foundations](references.md#shared-numerical-foundations).
