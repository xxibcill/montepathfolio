# Portfolio construction models

Implementation: [`construction.ts`](../../src/lib/quant/construction.ts).
Validation examples: [`construction.test.ts`](../../src/lib/quant/construction.test.ts).
Unless noted otherwise, expected returns, variances, covariances, and risk-free
rates all belong to the same caller-selected period and use arithmetic simple
returns.

## Long-only mean-variance optimization

- **Question answered.** Which fully invested nonnegative weights minimize
  variance, maximize Sharpe ratio, or minimize variance at a target expected
  return?
- **Equations.** $E[r_p]=w^\top\mu$,
  $\sigma_p^2=w^\top\Sigma w$, and
  $SR=(w^\top\mu-r_f)/\sqrt{w^\top\Sigma w}$, subject to
  $w_i\ge0$ and $\mathbf1^\top w=1$; frontier points also require
  $\mu^\top w=r^*$.
- **Units and conventions.** Inputs and outputs are per period; covariance is
  squared return units; weights are capital fractions. Risk contributions use
  $RC_i=w_i(\Sigma w)_i/\sigma_p$ and sum to volatility.
- **Implementation.** Minimum/frontier variance uses an active-set equality QP
  with KKT directions and explicit blocking/release of zero weights. Maximum
  Sharpe solves the nonnegative scaled tangency system by coordinate descent and
  normalizes allocations. Nearly singular covariance receives a disclosed tiny
  diagonal ridge for solving; reported risk uses the original matrix.
- **Validation gate.** Covariance is symmetric PSD; weights satisfy nonnegative
  and sum/target constraints within tolerance; returned return and variance
  recompute from weights; two-asset analytical fixtures agree; boundary and
  iteration warnings surface; the ridge is reported rather than hidden.
- **Worked intuition.** Two uncorrelated assets with equal expected return and
  volatilities 20% and 10% have minimum-variance weights proportional to inverse
  variance: `(0.2,0.8)`. The quieter asset gets four times the capital because
  its variance is one quarter as large.
- **Assumptions and limitations.** Means and covariance are treated as known and
  stable. Only long-only, fully invested portfolios are implemented; turnover,
  taxes, transaction costs, shorting, integer lots, leverage, and estimation
  error are excluded.
- **Educational disclaimer.** Optimized weights illustrate an objective under
  supplied assumptions; they are not recommended allocations.

## CAPM regression

- **Question answered.** How sensitive was each asset to the supplied market,
  what in-sample alpha remains, and what return does the sample security market
  line imply?
- **Equations.** $r_i-r_f=\alpha_i+\beta_i(r_m-r_f)+\epsilon_i$,
  $\beta_i=\operatorname{Cov}(r_i-r_f,r_m-r_f)/\operatorname{Var}(r_m-r_f)$,
  and $E_{SML}[r_i]=r_f+\beta_i(\bar r_m-r_f)$.
- **Units and conventions.** Returns and alpha are arithmetic per period; beta
  and $R^2$ are dimensionless; the risk-free rate is a constant per-period
  arithmetic return. Optional portfolio weights are long-only and sum to one.
- **Implementation.** Closed-form one-factor OLS computes beta, intercept,
  residual volatility, and $R^2$. Portfolio beta, alpha, expected SML return,
  and realized mean are weighted sums of asset estimates.
- **Validation gate.** At least three aligned observations are required; market
  excess-return variance must be positive; synthetic regression fixtures recover
  known alpha/beta; portfolio beta equals the weighted asset betas.
- **Worked intuition.** If $r_f=1\%$, the sample market mean is 5%, and
  $\beta=1.5$, CAPM's line gives $1\%+1.5(5\%-1\%)=7\%$ per period. A realized
  mean of 8% does not by itself make the extra 1% a forecastable alpha.
- **Assumptions and limitations.** CAPM is a single linear in-sample factor with
  constant beta and risk-free rate. It ignores omitted factors, nonlinearity,
  changing exposures, measurement error, and the distinction between statistical
  significance and economic relevance.
- **Educational disclaimer.** CAPM estimates are descriptive classroom output,
  not expected-return forecasts or security recommendations.

## Multi-factor regression and scenarios

- **Question answered.** Which supplied factors explain each asset's return,
  how much common/idiosyncratic risk results, what is the linear effect of a
  chosen factor shock, and how do exposures and attribution change through
  look-ahead-safe rolling windows?
- **Equations.** $r_i=a_i+b_i^\top f+\epsilon_i$ by OLS,
  $\hat\Sigma_r=B\Sigma_fB^\top+D_\epsilon$, and a scenario gives
  $\Delta r_i=b_i^\top\Delta f$. Portfolio exposure is $b_p=B^\top w$.
- **Units and conventions.** Asset/factor rows are aligned arithmetic returns per
  period. Independently validated datasets must share a frequency and simple-
  return convention; alignment uses exact timestamp intersection and records
  dropped source rows. Exposures are return-per-factor-return; scenario shocks
  and return changes are per-period decimals. Residual cross-covariances are set
  to zero.
- **Implementation.** The normal equations solve an intercept plus supplied
  factors for each asset. Residual sample variance uses regression degrees of
  freedom. Static output decomposes mean, factor variance, volatility
  contribution, idiosyncratic variance, and an optional named scenario for
  assets and portfolio. The dataset adapter selects asset/factor columns, aligns
  exact timestamps, and carries both provenance records. Rolling analysis fits
  only the preceding estimation window, attributes the subsequent test window,
  records both timestamp/index ranges, and reports asset and optional portfolio
  return/risk attribution for each bounded window. For local learning data, one
  combined CSV uses `asset:` and `factor:` column prefixes; the worker splits it
  into separately provenance-labelled datasets, selects the first asset and first
  two factors for the readable chapter comparison, then applies the same
  timestamp-intersection adapter.
- **Validation gate.** Observation rows align, IDs are unique, selected columns
  resolve, at least `factorCount + 2` estimation observations exist,
  collinear/near-collinear factors fail explicitly, synthetic exposures and
  scenario contributions are recovered, every rolling estimation end is before
  its test start, out-of-sample return attribution reconciles, provenance is
  retained, window count is bounded, and small samples warn.
- **Worked intuition.** An asset with market exposure 1.2 and rates exposure
  -0.4 changes by $1.2(-2\%)+(-.4)(1\%)=-2.8\%$ under a -2% market shock and
  +1% rates-factor shock in the linear scenario.
- **Assumptions and limitations.** Each OLS exposure is fixed within its fit
  window; residuals are assumed mutually uncorrelated in modeled covariance.
  Rolling windows prevent mechanical look-ahead but do not remove selection,
  revision, or survivorship bias in supplied data. Robust errors, nonlinear
  factors, economic factor definitions, and source-specific adjustment logic are
  not supplied by the engine.
- **Educational disclaimer.** Factor decompositions and shocks are explanatory
  scenarios, not predictions or hedging advice.

## Risk-budgeting / risk-parity allocation

- **Question answered.** Which long-only weights make each asset's share of
  portfolio volatility match a positive requested risk budget?
- **Equations.** $RC_i=w_i(\Sigma w)_i/\sigma_p$ and the target is
  $RC_i/\sigma_p=b_i$ with $\sum b_i=1$. Coordinate updates solve
  $\Sigma_{ii}x_i^2+(\sum_{j\ne i}\Sigma_{ij}x_j)x_i-b_i=0$ for the positive
  root, then normalize weights.
- **Units and conventions.** Covariance is per period; capital weights and
  normalized budgets are dimensionless; contributions are in volatility units.
  Budgets must be strictly positive and are normalized by the engine.
- **Implementation.** Equal budgets are the default. Positive coordinate descent
  iterates until maximum budget error meets tolerance, using the same disclosed
  covariance ridge policy as mean-variance when needed.
- **Validation gate.** Each budgeted asset has positive variance; covariance is
  PSD; volatility contributions add to total volatility; achieved budgets match
  requested budgets within solver tolerance; inverse-volatility and unequal
  two-asset fixtures agree.
- **Worked intuition.** For two uncorrelated assets with volatilities 20% and
  10%, equal-risk capital weights are inverse-volatility `(1/3,2/3)`: each then
  contributes the same amount of volatility even though capital differs.
- **Assumptions and limitations.** Equal risk is not equal expected return or
  equal loss. Covariance is assumed stable, weights are nonnegative, and the
  model omits leverage targets, turnover, transaction costs, tail dependence,
  and estimation uncertainty.
- **Educational disclaimer.** Risk parity is an allocation lesson, not a claim
  that equal modeled contributions are safe or appropriate.

## Continuous and binary Kelly criterion

- **Question answered.** What capped nonnegative exposure approximately maximizes
  long-run log growth, how do fractional Kelly choices trade growth for loss and
  initial-capital barrier risk, and what is the exact fraction for a simple
  binary bet?
- **Equations.** Continuous mode maximizes the second-order approximation
  $g(w)=w^\top\mu-\tfrac12w^\top\Sigma w$; fractional Kelly replaces $\mu$ by
  $f\mu$ before solving. For a binary bet,
  $f^*=[p b-(1-p)\ell]/(\ell b)$ and
  $E[\log G]=p\log(1+fb)+(1-p)\log(1-f\ell)$. With log-growth drift $g$,
  variance $v$, barrier distance $a=-\log(1-d)$, and horizon $H$, the reported
  Brownian first-passage approximation is
  $\Phi((-gH-a)/\sqrt{vH})+e^{-2ga/v}\Phi((gH-a)/\sqrt{vH})$.
- **Units and conventions.** $\mu$ is arithmetic excess return and $\Sigma$ is
  covariance for one period. Allocations can sum above one when the required
  total cap permits leverage; `cashWeight = 1 - totalAllocation`. Fractions and
  initial-wealth barriers are decimals, and the drawdown horizon is in the same
  return periods. “Drawdown” here means crossing below initial capital by the
  threshold, not falling from a later running peak.
- **Implementation.** Projected gradient descent clips each asset at `[0, cap]`
  and uses threshold bisection when the total cap binds. Results always compare
  full, half, and quarter Kelly. Reported one-period loss uses a normal CDF; the
  finite-horizon initial-capital drawdown and infinite-horizon floor probabilities
  use Brownian first-passage approximations. The binary helper evaluates the
  exact log-growth formula with solvency and stake caps.
- **Validation gate.** Covariance is PSD, Kelly fraction lies in `[0,1]`, caps
  are explicit and respected, leverage is bounded at 10, deterministic continuous
  fixtures and the classic binary-bet formula agree, both barrier probabilities
  remain in `[0,1]`, and binding/nonconvergence warnings remain visible.
- **Worked intuition.** A 60%-win even-money bet has
  $f^*=(.6-.4)=.20$. Half Kelly stakes 10%; it gives up some modeled growth to
  reduce the damage from estimation error and losing streaks.
- **Assumptions and limitations.** Continuous Kelly is only a second-order
  approximation with stable means/covariance. Normal loss and Brownian ruin
  and initial-capital drawdown formulas can be poor for jumps or fat tails;
  neither drawdown metric is peak-to-trough, and “infinite horizon” is a model
  abstraction. Full Kelly is extremely sensitive to estimation error.
- **Educational disclaimer.** Kelly fractions are mathematical demonstrations,
  not leverage, betting, or investment recommendations.

## Black-Litterman views and posterior allocation

- **Question answered.** How can market-cap equilibrium returns and confidence-
  weighted absolute or relative views be combined before reusing the long-only
  allocator?
- **Equations.** The excess-return prior is $\pi=\delta\Sigma w_m$. With pick
  matrix $P$, view values $q$, and
  $\Omega_{kk}=(P\tau\Sigma P^\top)_{kk}(1-c_k)/c_k$, the posterior mean is
  $\mu_{BL}=\pi+\tau\Sigma P^\top(P\tau\Sigma P^\top+\Omega)^{-1}(q-P\pi)$.
- **Units and conventions.** Covariance, equilibrium returns, view values, and
  risk-free rate share one period. Market weights are nonnegative and sum to
  one. Absolute views are converted to excess returns; relative views already
  cancel cash. Confidence is in `(0,1]`.
- **Implementation.** Absolute rows put `1` on one asset; relative rows put `+1`
  and `-1`. The engine reports each view's innovation and additive asset-return
  contribution, posterior mean covariance, and predictive covariance
  $\Sigma+\Sigma_{\mu\mid q}$. It reuses mean-variance maximum-Sharpe allocation
  for prior and posterior and regularizes only a singular view system as warned.
- **Validation gate.** Market and view identifiers resolve, matrices align/are
  PSD, small matrix fixtures satisfy equilibrium and posterior identities,
  higher confidence moves the posterior farther toward a view, and allocations
  pass the same constraints as mean-variance.
- **Worked intuition.** If the prior says A minus B is 1% but a relative view says
  3%, the innovation is 2%. Low confidence gives that 2% a small gain; confidence
  near one gives it a much larger gain, while covariance spreads the adjustment
  across related assets.
- **Assumptions and limitations.** Market weights need not be truly efficient;
  $\delta$, $\tau$, confidence, covariance, and views are subjective/model inputs.
  View errors are diagonal, so view-error correlation is omitted, and posterior
  weights inherit all long-only mean-variance limitations.
- **Educational disclaimer.** Black-Litterman output organizes assumptions; it
  does not validate investor views or recommend a portfolio.

## Further reading

See the bibliography for [portfolio construction](references.md#portfolio-construction)
and [shared numerical foundations](references.md#shared-numerical-foundations).
