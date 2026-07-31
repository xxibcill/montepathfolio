# Portfolio projection and market models

Implementation: [`portfolio-lab request@1`](../../src/lib/portfolio-lab/contracts.ts),
[`portfolio-lab request@2`](../../src/lib/portfolio-lab/advanced-contracts.ts),
[`request@2 runner`](../../src/lib/portfolio-lab/advanced-runner.ts),
[`market-models.ts`](../../src/lib/quant/market-models.ts), and shared
[`core.ts`](../../src/lib/quant/core.ts). Tests:
[`portfolio-lab`](../../src/lib/portfolio-lab/case-invariants.test.ts) and
[`market models`](../../src/lib/quant/market-models.test.ts), plus
[`request@2`](../../src/lib/portfolio-lab/advanced-runner.test.ts).

## Geometric Brownian motion portfolio baseline

- **Question answered.** Given constant annual drift, volatility, stock/bond
  correlation, contributions, allocation, and rebalancing, what wealth and
  drawdown distributions arise across simulated paths?
- **Equations.** For asset $i$ over step $\Delta t$,
  $G_i=\exp[(\mu_i-\tfrac12\sigma_i^2)\Delta t+\sigma_i\sqrt{\Delta t}Z_i]$.
  The bond shock is $Z_b=\rho Z_s+\sqrt{1-\rho^2}Z_\perp$. Drawdown is
  $D_t=\max(0,1-I_t/\max_{u\le t}I_u)$ on the cash-flow-neutral index $I$.
- **Units and conventions.** $\mu$ is the annual SDE drift in $dS/S$ (so
  $E[S_T]/S_0=e^{\mu T}$); $\sigma$ is annualized; `stepYears` is years. Time zero is opening
  wealth. Each step applies returns, adds the end-of-step contribution in target
  weights, optionally rebalances, then records wealth. Inflation is annual
  effective and percentiles use R-7 interpolation.
- **Implementation.** Two semantic Gaussian streams generate stocks and the
  independent part of bonds. Portfolio holdings and a separate unit NAV are
  advanced together; only the NAV is used for contribution-neutral drawdown.
  The primary case retains at most 160 evenly spaced sample paths while all paths
  feed distributions and metrics.
- **Validation gate.** Fixed seeds repeat exactly; increasing the horizon/path
  count preserves prefixes; case order and added comparisons do not change an
  existing case; contribution-only growth creates no drawdown; probabilities
  stay in $[0,1]$ and percentile ordering is preserved.
- **Worked intuition.** With $\mu=0.08$, $\sigma=0.20$, monthly $\Delta t=1/12$,
  and $Z=0$, one stock step grows by
  $\exp[(0.08-0.02)/12]\approx1.0050$: about 0.50%, not simply $0.08/12$,
  because log growth includes the $-\sigma^2/2$ correction.
- **Assumptions and limitations.** Parameters are constant, returns are
  lognormal, two assets are supported, and taxes, fees, liquidity, fat tails,
  parameter uncertainty, and calibration error are outside this baseline.
  `tailCapitalShortfall` is the mean capital-loss ratio in the lowest 5% of
  terminal wealth, not standard Expected Shortfall/CVaR.
- **Educational disclaimer.** This is an educational accumulation experiment,
  not a return forecast or investment recommendation.

## Hidden Markov regime portfolio baseline and ordered calibration

- **Question answered.** How can a latent bull, bear, or sideways state make the
  next step's drift, volatility, and stock/bond correlation change over time?
- **Equations.** $P(S_t=j\mid S_{t-1}=i)=P_{ij}$, followed by the same GBM
  emission equation using parameters $(\mu_{S_t},\sigma_{S_t},\rho_{S_t})$.
  The transparent fitter labels return terciles and estimates
  $\hat P_{ij}=(N_{ij}+1)/(\sum_jN_{ij}+3)$.
- **Units and conventions.** Transition rows and initial-state probabilities are
  one-step decimals summing to one and are not rescaled to another frequency.
  The state transitions before that step's return. Emission parameters retain
  the GBM annual conventions.
- **Implementation.** Initial and transition uniforms use streams isolated from
  diffusion shocks. The baseline accepts supplied three-state parameters. The
  optional `fitOrderedRegimes` classroom calibration sorts observations into
  lower/middle/upper terciles, computes within-bin population moments, and adds a
  Laplace count of one to every transition cell; it is not EM. The learner
  chapter can instead fit the first monthly log-return column of a bounded local
  CSV and records its filename, sample window, and `user-imported` provenance in
  the snapshot.
- **Validation gate.** Transition distributions are valid, sampled state paths
  include time zero, occupancy is bounded and sums to one, fixed seeds replay,
  and the calibration snapshot records frequency, return convention, sample
  dates, fitting method, and provenance. Ordered three-state fitting requires at
  least five distinct returns and rejects tied data that collapse a tercile
  instead of allowing an empty-state numerical failure.
- **Worked intuition.** If a bear row is `(bull .10, bear .80, sideways .10)`, a
  transition uniform of `.73` stays in bear because cumulative probability
  reaches `.90` at that state; the bear emission then prices that step.
- **Assumptions and limitations.** States are observed only through supplied or
  tercile-classified labels. The simple fitter does not maximize HMM likelihood,
  infer filtered probabilities, handle multiple assets, or establish that
  regimes are economically real.
- **Educational disclaimer.** Regime labels are teaching devices, not market
  timing signals or predictions.

## Merton jump diffusion

- **Question answered.** How do rare discontinuous jumps change terminal prices
  and crash frequency relative to a shared-diffusion GBM baseline?
- **Equations.** $N_t\sim\text{Poisson}(\lambda\Delta t)$ and
  $Y_k\sim N(m_J,s_J^2)$. The log step is
  $(\mu-\tfrac12\sigma^2-\lambda\kappa)\Delta t+
  \sigma\sqrt{\Delta t}Z+\sum_{k=1}^{N_t}Y_k$, where
  $\kappa=e^{m_J+s_J^2/2}-1$.
- **Units and conventions.** SDE drift, diffusion volatility, and intensity are
  annual; intensity is expected jumps per year; jump parameters describe the
  log price multiplier. Prices are positive and `stepYears` controls scaling.
- **Implementation.** One or two assets use Cholesky-correlated diffusion.
  Arrival and size streams are distinct, event markers are retained only for
  sampled paths, and compensated drift preserves expected growth
  $e^{\mu T}$. A “crash” diagnostic means aggregate log jump below
  $\log(0.8)$ in any asset-step. All simulated paths feed positive terminal-loss
  95% VaR/CVaR, mean maximum drawdown, and jump-conditioned mean maximum
  drawdown diagnostics even though only bounded path and event detail is kept.
- **Validation gate.** Zero intensity reproduces GBM path-for-path; empirical
  annual counts recover $\lambda$ within a fixed tolerance; separate jump draws
  do not shift diffusion; compensated mean growth, terminal tail metrics, and
  drawdowns remain finite and ordered; no-jump runs report a null conditional
  drawdown; matrix and five-million asset-step resource limits are enforced.
- **Worked intuition.** If $m_J=\log(0.9)$ and $s_J=0$, one arrival multiplies
  price by 0.9. With $\lambda=0.5$, compensation adds about
  $-\lambda(0.9-1)=+0.05$ to pre-jump annual log drift so the lower jump outcomes
  do not silently lower the configured mean growth.
- **Assumptions and limitations.** Arrivals are Poisson, log jump sizes are
  Gaussian, jumps are independent by asset unless another model says otherwise,
  and the crash threshold is a diagnostic convention rather than a universal
  definition. Above intensity 30 the shared sampler uses Hörmann's exact
  transformed-rejection algorithm (PTRS), so it does not silently switch to a
  rounded normal approximation.
- **Educational disclaimer.** Simulated jumps illustrate tail mechanics; they
  are not estimates of a security's crash probability.

## GARCH(1,1) and standardized Student-t innovations

- **Question answered.** How does recent squared surprise create volatility
  clustering, and how does heavier-tailed innovation noise affect returns?
- **Equations.** $h_t=\omega+\alpha\epsilon_{t-1}^2+\beta h_{t-1}$ and
  $r_t=\mu+\sqrt{h_t}z_t$. When $\alpha+\beta<1$,
  $\bar h=\omega/(1-\alpha-\beta)$. A Student-t draw is rescaled by
  $\sqrt{(\nu-2)/\nu}$ so $\operatorname{Var}(z)=1$ for $\nu>2$.
- **Units and conventions.** Returns, mean, variance, and GARCH parameters are
  per observation step, not annual. The cone annualizes as
  $\sqrt{h\times\text{periodsPerYear}}`, defaulting to 252.
- **Implementation.** Simulation uses supplied or unconditional initial
  variance, clamps round-off below zero, and stores only requested sample paths.
  Forecast variance iterates $E_t[h_{t+k}]=\omega+(\alpha+\beta)E_t[h_{t+k-1}]$.
  Calibration is a small bounded Gaussian quasi-likelihood grid over five
  $\alpha$ and six $\beta$ candidates, not a continuous optimizer. The learner
  chapter can fit the first monthly simple-return column from a bounded local CSV;
  simulation then uses that immutable fitted snapshot and displays its
  user-imported provenance. The standalone Student-t comparison has its own
  versioned `market-model/student-t-innovations@1` request/result boundary. It
  pairs each normal draw with the same Gaussian numerator, adds only the
  Student-t chi-square scale, and reports both empirical variances and two-sided
  tail frequencies.
- **Validation gate.** $\omega>0$, $\alpha,\beta\ge0$, and $\nu>2$ are enforced;
  unconditional initialization requires persistence below one; $\alpha=\beta=0$
  gives constant variance; fixed seeds repeat; nonstationarity returns a warning;
  fitted snapshots preserve dates and provenance.
- **Worked intuition.** With $\omega=.00001$, $\alpha=.10$, $\beta=.85$,
  $h_{t-1}=.0004$, and $\epsilon_{t-1}=.03$, the next variance is
  $.00001+.10(.03^2)+.85(.0004)=.00044$: a large surprise lifts tomorrow's
  conditional volatility.
- **Assumptions and limitations.** The mean is constant, the fitter searches a
  coarse grid and assumes Gaussian quasi-likelihood, and a stationary warning
  does not repair parameters. Student-t variance exists here, but skewness,
  leverage effects, and parameter-estimation uncertainty are omitted.
- **Educational disclaimer.** GARCH paths and fitted parameters are educational
  volatility scenarios, not forecasts or trading signals.

## Validated return data and historical bootstrap

- **Question answered.** What can be learned by resampling observed aligned
  return rows without imposing a parametric distribution?
- **Equations.** IID bootstrap draws source index
  $I_t=\lfloor U_t n\rfloor$. Moving-block bootstrap draws a start $I_b$ and
  emits $I_b,I_b+1,\ldots,I_b+L-1$ modulo $n$ until the horizon is filled.
- **Units and conventions.** The dataset explicitly labels simple versus log
  returns and daily/weekly/monthly/annual frequency. Timestamps are increasing,
  assets use intersection alignment, missing values are rejected, and draws are
  with replacement. A simple return may equal $-1$ (total loss) but can never be
  below $-1$; log returns remain finite real values.
- **Implementation.** CSV column one is time and remaining columns are assets.
  The engine validates unique asset IDs, rectangular finite rows, aligned dates,
  and provenance, then returns both sampled rows and their source indexes. Only
  32 paths are materialized by default; `samplePaths` can request a different
  count up to the requested path count. The learner chapter provides a local CSV
  template and sends the bounded attachment to the worker; the same validator
  rejects missing cells before IID or moving-block sampling.
- **Validation gate.** Every emitted row equals a source row; moving-block
  indexes remain consecutive modulo the sample; block size fits the dataset;
  paths/steps are each bounded at 10,000; provenance and replacement policy are
  explicit.
- **Worked intuition.** For source indexes `[0,1,2,3]`, block size 3, and sampled
  start 3, the first block is `[3,0,1]`: wraparound preserves adjacency rather
  than choosing three unrelated rows.
- **Assumptions and limitations.** IID sampling destroys serial dependence;
  moving blocks preserve only short local ordering and wrap end to start. The
  historical sample may be unrepresentative and is not automatically a future
  distribution. The current function returns sampled teaching paths, not
  terminal portfolio analytics.
- **Educational disclaimer.** Historical resampling is not a forecast and does
  not make past returns suitable for any investor.

## Gaussian and Student-t dependence experiments

- **Question answered.** How does a correlation matrix create joint innovations,
  and how can a shared random scale increase co-movement in the lower tail?
- **Equations.** Gaussian draws use $z=L\varepsilon$ where $LL^\top=R$.
  Student-t mode uses $x=L\varepsilon/\sqrt{Q/\nu}$, then rescales by
  $\sqrt{(\nu-2)/\nu}$, with $Q\sim\chi^2_\nu$ shared across dimensions.
- **Units and conventions.** Outputs are dimensionless standardized innovations.
  The diagnostic lower tail is the fraction of rows where every dimension lies
  below its own empirical 5th percentile. The result also maps each scaled
  innovation through its matching Gaussian or Student-t CDF to a uniform in
  `(0,1)`.
- **Implementation.** Cholesky validates dependence; normal and common-scale
  streams are semantic; empirical Pearson correlation and joint-tail frequency
  are reported. Student-t requires $\nu>2$ in both standalone and composite use
  so the configured standardized variance exists.
- **Validation gate.** Gaussian empirical correlations recover configured values
  within tolerance, Student-t samples show stronger joint lower-tail frequency
  in the fixed fixture, inputs are finite/PSD, and fixed seeds reproduce rows.
- **Worked intuition.** Two independent 5% tail events coincide about
  $.05^2=.0025$ of the time. A shared low $Q$ enlarges both Student-t coordinates
  together, so joint extreme observations become more common even when linear
  correlation is unchanged.
- **Assumptions and limitations.** Student-t uniforms undo the unit-variance
  scaling before applying the Student-t CDF. Copulas describe dependence only;
  economic marginal returns must be supplied separately.
- **Educational disclaimer.** Tail co-movement in synthetic innovations is not
  a measured portfolio default or loss probability.

## Sanctioned HMM → GARCH → copula → jump pipeline

- **Question answered.** What paths result when regimes own drift, GARCH owns
  marginal variance, a copula owns diffusion dependence, and jump diffusion owns
  discontinuities in a fixed update order?
- **Equations.** Each step samples $S_t$, updates
  $h_{i,t}=\omega_i+\alpha_i\epsilon_{i,t-1}^2+\beta_i h_{i,t-1}$,
  forms $z_t=L u_t$, samples $J_{i,t}$, then applies
  $\log(S_{i,t}/S_{i,t-1})=(\mu_{S_t,i}-\lambda_i\kappa_i)\Delta t
  -h_{i,t}/2+\sqrt{h_{i,t}}z_{i,t}+J_{i,t}$.
- **Units and conventions.** Regime drift and jump intensity are annual and use
  `stepYears`; GARCH variance and innovations are per simulation step. The exact
  update order is `hmm->garch->copula->jump->price`.
- **Implementation.** Feature switches can disable regimes, dynamic variance,
  dependence, or jumps. Each stochastic role has a separate semantic address.
  Sampled prices, regimes, variances, and jump events are bounded diagnostics;
  this kernel does not yet perform portfolio accounting.
- **Validation gate.** Dimensions and probability rows agree, prices are
  positive at input, correlation factorizes, Student-t uses $\nu>2$, resource
  limits pass, fixed seeds replay, diagnostics identify every component, and
  disabled components reduce to their documented simpler update.
- **Worked intuition.** Turning jumps off sets $J=0$ and compensation to zero;
  turning dependence off makes $L=I$. Those switches remove exactly one owner
  rather than quietly changing the remaining regime or GARCH draws.
- **Assumptions and limitations.** The code initializes variance from its
  unconditional value when stationary (otherwise `omega`), uses one regime for
  all assets, and gives assets independent jump arrivals. It is a sanctioned
  composite, not permission to combine arbitrary models; Heston and GARCH should
  not both own variance.
- **Educational disclaimer.** The composite is a controlled classroom scenario,
  not a calibrated market generator or investment forecast.

## Native portfolio composition in request@2

- **Question answered.** How do GBM, jump diffusion, GARCH, or the sanctioned
  composite change portfolio wealth, drawdown, goals, and loss tails when market
  mechanics and portfolio accounting remain separate but execute in one explicit
  request?
- **Equations.** Holdings first receive each asset's market growth. A fixed
  contribution is then allocated at target weights, a fixed withdrawal is
  removed pro rata without debt, and a scheduled rebalance restores target
  weights before wealth is recorded. Terminal economic loss is
  `initial + contributions − withdrawals − terminal wealth`; standard VaR is
  $\max(0,Q_c(L))$ under R-7 and CVaR averages observations at or above that
  threshold, never below VaR.
- **Units and conventions.** Request@2 rates, drifts, volatility/conditional
  variance, jump intensity, and `stepYears` are explicit annual quantities. GARCH
  variance is annualized in this contract, unlike the standalone GARCH lesson's
  per-observation-step convention. Event order is
  `market->contribution->withdrawal->rebalance->record`. The cash-flow-neutral
  index, not nominal wealth, owns drawdown. `tailCapitalShortfall` remains a
  capital-relative classroom metric and is not renamed CVaR.
- **Implementation.** The frozen request@1 union remains GBM/HMM-only. Native
  request@2 uses a new discriminated union for GBM, jump diffusion, GARCH, and
  composite cases, and simulates only named cases. It supports up to 16 aligned
  assets and eight cases, returns full primary-case distributions with at most
  160 sampled holding/path records, and returns lightweight comparison summaries.
  The composite update order extends to
  `hmm->garch->copula->jump->portfolio`; Risk Lab's validated VaR/CVaR definition
  is reused for terminal loss. Provenance records engine/random-stream versions,
  time grid, seed, requested cases, and selected path indexes.
- **Validation gate.** Zero jump intensity reproduces the paired GBM case
  path-for-path; `alpha=beta=0` with matching variance reproduces constant-
  volatility GBM; case reordering/addition preserves existing results; holdings
  add back to wealth after both cash-flow directions; composite diagnostics are
  tagged; standard CVaR is not below VaR; invalid matrices and contracts return
  structured problems; and five million case-asset path-steps are rejected
  before simulation.
- **Worked intuition.** With zero returns, opening capital 1,000, contribution
  100, withdrawal 40, and three steps, wealth records
  `[1000, 1060, 1120, 1180]`. Withdrawals total 120, so terminal economic loss is
  `1300 − 120 − 1180 = 0`; cash flow alone did not create either investment loss
  or drawdown.
- **Assumptions and limitations.** Contributions and withdrawals are fixed per
  step, rebalancing is frictionless, and taxes, fees, mortality, parameter
  uncertainty, optimization, and calibrated data services are absent. Request@2
  is a native educational portfolio runner, not an adapter that migrates the
  original accumulation React screen; that separate compatibility ticket remains
  open.
- **Educational disclaimer.** Integrated portfolio and risk metrics remain
  conditional classroom scenarios, not forecasts, plans, or recommendations.

## Further reading

See the bibliography for [portfolio and market models](references.md#portfolio-and-market-models)
and [shared numerical foundations](references.md#shared-numerical-foundations).
