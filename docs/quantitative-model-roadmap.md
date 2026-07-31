# Quantitative Simulation Laboratory Roadmap

Status: educational implementation complete — all seven release families have learner-facing model verticals; intentionally deferred production extensions remain out of scope

Last updated: 2026-07-31

Scope: architecture, implementation order, and evidence ledger; no model is implemented by this document

## 1. Goal

Evolve Portfolio Risk Sandbox from a two-model accumulation simulator into a set
of focused quantitative-finance laboratories. Each laboratory should make one
class of decisions understandable, expose the assumptions and limitations of its
models, and produce reproducible results suitable for fair comparisons.

The project should not become one screen with dozens of model toggles. Portfolio
projection, portfolio construction, derivatives, rates and credit, and market
microstructure have different inputs and outputs. They should be separate deep
modules and separate user workflows, with shared numerical kernels only where
reuse is real.

The guiding delivery rule is:

> Ship and validate each model on its own before allowing it into a combined
> pipeline.

## 2. Current baseline

The repository already contains more of the proposed foundation than the product
labels suggest.

| Capability | Current state | Roadmap treatment |
| --- | --- | --- |
| Geometric Brownian motion | Native portfolio-lab case with two-asset Gaussian diffusion | Preserve and validate rather than reimplement |
| Hidden Markov regimes | Native portfolio-lab case for bull, bear, and sideways Gaussian emissions | Preserve behind the portfolio-lab interface |
| Correlated stock and bond shocks | Implemented with two Gaussian streams | Generalize only when a multi-asset model needs it |
| Portfolio accounting | Contributions, stock/bond allocation, and rebalancing exist | Separate from market dynamics and later extend to withdrawals and policies |
| Risk summaries | Terminal values, drawdowns, recovery, target probability, and a tail capital-shortfall measure exist | Preserve, group by meaning, and correct terminology before adding VaR/CVaR |
| Reproducibility | Versioned semantic streams provide shared shocks, isolated roles, and stable horizon prefixes | Preserve these behaviors as interface invariants |
| Execution | Pure TypeScript runs in a browser Web Worker | Retain worker execution and add an in-process test adapter |

The deprecated compatibility `SimulationInputs` and `SimulationResult` types
must not be widened for future models. They still carry unused HMM configuration
for the GBM case, hard-code two comparison keys, and expose HMM-only data through
nullable or empty common fields. The production accumulation UI now builds an
explicit native GBM/HMM request and derives its chart view from the discriminated
result. The old adapter is quarantined without a production caller only to
preserve pre-existing local edits.

## 3. Architecture decision

### 3.1 Use workflow-specific deep modules

Create one deep module per coherent laboratory:

| Module | Owns |
| --- | --- |
| Portfolio Projection Lab | Market-path cases, contributions, rebalancing, retirement cash flows, wealth and drawdown summaries |
| Portfolio Construction Lab | Mean-variance, Black-Litterman, risk parity, Kelly, CAPM, and factor-based allocations |
| Risk Lab | Historical, parametric, and Monte Carlo VaR/CVaR, attribution, and backtesting |
| Derivatives Lab | Black-Scholes, binomial trees, Monte Carlo pricing, Greeks, strategies, and Heston |
| Rates and Credit Lab | Vasicek, CIR, Nelson-Siegel, bond valuation, hazard-rate credit, and Merton credit |
| Trading Lab | Ornstein-Uhlenbeck spreads, order books, agent markets, and optimal execution |

Do not introduce a universal experiment graph in the first implementation. A
graph would make arbitrary compositions possible, but it would also require a
graph compiler, typed ports, scheduling rules, and many invalid-combination
errors before the product has a real need for those features.

Do not create one public function per formula either. That would scatter
validation, randomness, resource limits, worker behavior, and result shaping
across callers.

### 3.2 Portfolio-lab interface

The first new seam should be a portfolio-lab runner whose interface is small and
structured-clone safe:

```ts
type MarketCase =
  | { id: string; label: string; model: GbmModelSpec }
  | { id: string; label: string; model: HmmModelSpec };

interface PortfolioLabRequest {
  contract: "portfolio-lab/request@1";
  plan: PortfolioPlan;
  primaryCaseId: string;
  cases: readonly MarketCase[];
  execution: {
    seed: number;
    paths: number;
    steps: number;
    stepYears: number;
  };
}

interface PortfolioLabRunner {
  run(request: PortfolioLabRequest): {
    result: Promise<PortfolioLabResult>;
    cancel(): void;
  };
}
```

Release 0 supports only the existing GBM and HMM specifications. Add
jump-diffusion and GARCH variants to a later contract version only when their
standalone model gates pass.

The result should contain:

- Full path, distribution, drawdown, and model diagnostics for the primary case.
- Lightweight summaries for every explicitly requested comparison case.
- Grouped metrics such as `wealth`, `goal`, `loss`, and `drawdown`.
- A discriminated diagnostics record, never HMM-specific fields on every result.
- Deterministic provenance: engine version, seed, time grid, and selected sample
  indexes.
- Structured error codes for invalid input, unsupported versions, resource
  limits, cancellation, worker failure, and numerical failure.

Provide two real adapters at the runner seam:

- A Web Worker adapter for production.
- An in-process adapter for tests, benchmarks, and non-worker execution.

The model specifications remain plain data. React, Canvas, `localStorage`,
wall-clock timestamps, file parsing, and remote model-training payloads stay
outside the quantitative module.

### 3.3 Separate calibration from simulation

Fitting and simulation are different workflows and should not be coupled.

```text
Observed data
    -> validate and align
    -> fit parameters
    -> store parameter snapshot with provenance
    -> simulate from the immutable snapshot
    -> analyze results
```

A fitted snapshot must record:

- Model and schema version.
- Observation frequency and return convention.
- Sample start and end.
- Parameter estimates and fitting method.
- Optimizer convergence state and warnings.
- Data provenance without claiming that bundled examples are live estimates.

Historical data loading and any future remote training service belong behind
their own data/calibration seams. They do not enter the simulation interface.

### 3.4 Extract shared kernels only after two consumers exist

Likely shared numerical capabilities include:

- Counter-based or keyed pseudo-random streams.
- Normal, Student-\(t\), Poisson, lognormal, and categorical sampling.
- Descriptive statistics, quantiles, covariance, and correlation.
- Positive-semidefinite checks and matrix factorization.
- Root finding, constrained optimization, and numerical integration.
- Time grids, units, resource estimates, and typed failures.

Keep these capabilities inside the first owning module until a second module
needs them. Then extract a deep shared module with an interface tested by both
callers. Avoid a directory of one-line mathematical helpers.

## 4. Non-negotiable model conventions

These conventions must be documented in types, runtime validation, model notes,
and tests before expansion begins.

### Units and time

- Rates and volatilities are decimals, not percentages.
- Every rate states whether it is annualized, per-step, continuously compounded,
  or simply compounded.
- Every return series states whether it contains simple or log returns.
- Simulation time uses `stepYears`; UI labels may present days, months, or years.
- HMM transition matrices contain one-step probabilities calibrated to
  `stepYears`; the engine does not rescale a matrix from another frequency.
- Price, return, variance, yield, spread, loss, and probability series are
  distinct semantic types even if all are represented by numbers.
- Time index zero is the initial state and every result describes when cash
  flows, state transitions, returns, and rebalancing occur.

For the existing monthly portfolio workflow, preserve this ordering:

1. Start from opening holdings and model state.
2. Advance the market state for the month.
3. Apply asset returns.
4. Add the month-end contribution or withdrawal.
5. Rebalance if scheduled.
6. Record wealth and update the cash-flow-neutral drawdown index.

### Reproducibility and comparison

- The same versioned request and seed produce the same deterministic result.
- Results do not contain `Date.now()`; wall-clock telemetry lives in the runner.
- Increasing path count or horizon preserves existing path and time prefixes.
- Reordering cases cannot change their results.
- Adding a comparison case cannot change existing case results.
- Common shocks are addressed semantically by seed, comparison group, path,
  step, asset, and shock role.
- Diffusion, regime transition, volatility, jump arrival, jump size, default,
  and agent-order streams are isolated. An extra jump draw must not shift later
  diffusion shocks.
- Resource limits are validated before simulation; algorithms never silently
  change precision or quantile method.

### Error and warning policy

Reject a request when it contains impossible or non-finite inputs, an invalid
probability distribution, a non-positive-semidefinite correlation matrix, an
unsupported model combination, or an estimated resource use above the stated
limit.

Return warnings, while still allowing a run, for mathematically permitted but
important conditions such as:

- Nonstationary or near-nonstationary GARCH parameters.
- A violated CIR Feller condition.
- Vasicek scenarios that produce negative rates.
- Optimizers that reach a boundary or an ill-conditioned covariance matrix.
- Too few observations for a requested calibration or backtest.
- Monte Carlo confidence intervals too wide for the requested conclusion.

## 5. Safe composition rules

The long-term HMM/GARCH/jump/copula pipeline is a sanctioned composite model,
not a promise that every model can be connected to every other model.

Its update order is:

```text
HMM samples the latent regime
        -> regime selects drift and other documented parameters
GARCH updates conditional variance from the prior innovation
        -> copula produces cross-asset standardized innovations
Jump process samples arrivals and sizes
        -> price dynamics combine compensated drift, diffusion, and jumps
Portfolio engine applies holdings, cash flows, and rebalancing
        -> portfolio summaries calculate wealth, drawdown, and targets
        -> Risk Lab calculates VaR, CVaR, attribution, and backtests
```

Parameter ownership must be unambiguous:

- HMM owns latent-state transitions and the parameters explicitly selected by a
  state.
- GARCH owns conditional variance when it is active.
- A copula owns cross-sectional dependence of standardized innovations, not
  their marginal distributions.
- Jump diffusion owns jump intensity, size distribution, and drift
  compensation.
- Portfolio accounting owns cash flows and rebalancing, never market dynamics.

Initial composition limits:

- Do not combine Heston and GARCH; both own the variance process.
- Treat Student-\(t\) as an innovation distribution, not another price process.
- Treat Nelson-Siegel as a yield-curve representation; it needs an explicit
  factor-shock rule before it becomes a stochastic curve model.
- Keep diffusion dependence and jump/default dependence explicit and separate.
- Add a composite only after every member has passed its standalone model gate.

## 6. Delivery roadmap

### Release 0 — Preserve behavior and create the seams

Purpose: make future model additions local without changing the current user
experience.

Work:

1. Add interface-level characterization tests for the existing GBM and HMM
   behaviors:
   - deterministic repeats;
   - common shocks;
   - horizon and path-count prefix stability;
   - contribution-neutral drawdowns;
   - monthly event ordering;
   - percentile ordering and bounded probabilities;
   - stale worker-response handling.
2. Rename the internal `constant` model to `gbm`, retaining a persisted-scenario
   migration and the user-facing “Standard Monte Carlo” label.
3. Keep the current capital-relative tail measure named
   `tailCapitalShortfall` across native and compatibility contracts. Reserve
   “Expected Shortfall” for standard loss-tail CVaR.
4. Introduce versioned portfolio-lab request, result, warning, and error types.
5. Add specification tests proving case-order and case-addition invariance.
6. Return primary-case detail plus an array of explicit comparison summaries.
   Stop simulating unrequested models.
7. Replace sequential random consumption with semantic, isolated random streams.
8. Separate market-path generation, portfolio accounting, and analytics behind
   the portfolio-lab seam.
9. Provide worker and in-process runner adapters.
10. Keep the current UI running through a temporary conversion adapter; remove it
   once UI types have migrated.
11. Record a browser benchmark for the current 1,000-path, 25-year scenario and
    add explicit path/step/memory limits. Add progress or preview results only if
    measured long-running workflows need them.

Exit gate:

- The current charts and values remain behaviorally equivalent where semantics
  did not intentionally change.
- GBM and HMM are requested as named cases.
- No HMM-only field exists on a GBM result.
- Deterministic output has no timestamp.
- Existing non-simulation tests remain at their owning interfaces; portfolio
  simulation behavior and new case invariants pass through the portfolio-lab
  seam.
- The temporary compatibility adapter has a
  [removal ticket](legacy-portfolio-lab-adapter-removal.md) and no new caller.

### Release 1 — The next three model verticals

This release follows the recommended next-model order: jump diffusion, GARCH,
then mean-variance optimization.

#### 1A. Merton jump diffusion

First scope:

- One- and two-asset portfolio cases.
- Poisson jump counts per time step.
- Lognormal jump multipliers with compensated drift.
- Separate jump-arrival and jump-size streams.
- Event markers retained for sampled paths.
- GBM comparison using shared diffusion shocks.
- Tail-loss, crash-probability, and jump-conditioned drawdown summaries.

Model gate:

- Zero jump intensity reproduces GBM path for path under the same diffusion
  stream.
- Empirical jump counts and jump-size moments match configured values within
  fixed statistical tolerances.
- Compensated expected return matches the documented convention.
- Case ordering and extra jump draws do not change shared diffusion shocks.
- The path chart can mark jumps and the terminal distribution can compare tails.

#### 1B. GARCH(1,1)

Split delivery:

1. Simulate from supplied valid parameters and show conditional variance paths.
2. Forecast a volatility cone from the latest conditional variance.
3. Add the validated return-series dataset shape later reused by historical
   bootstrap and factor models.
4. Fit parameters from an imported, validated return series.
5. Add rolling VaR only after the Risk Lab owns standard VaR/CVaR definitions.

First scope:

- Gaussian innovations, then standardized Student-\(t\) innovations later.
- Positivity constraints and an explicit stationarity warning.
- Initial variance policy documented and visible.
- Calibration result includes convergence and sample provenance.
- GARCH Monte Carlo can be compared with constant-volatility GBM.

Model gate:

- `omega > 0`, `alpha >= 0`, and `beta >= 0` are enforced.
- Stationary configurations validate their unconditional variance.
- `alpha = beta = 0` produces constant conditional variance.
- Fixed-seed volatility and return paths are reproducible.
- Fitted parameters are never presented as live unless their data really are
  live.

#### 1C. Mean-variance optimization

Build this in the Portfolio Construction Lab rather than adding optimization
fields to the projection result.

First scope:

- \(N\)-asset expected returns and covariance input.
- Long-only, fully invested portfolios.
- Minimum-variance and maximum-Sharpe portfolios.
- Efficient-frontier points with weights and risk contributions.
- Optional risk-free rate for the capital-market line.
- Stable handling of nearly singular covariance matrices.

Defer short selling, leverage, turnover constraints, transaction costs, and
mixed-integer restrictions until the base solver is verified.

Model gate:

- Weights obey all constraints within numerical tolerance.
- Reported portfolio return and variance recompute from returned weights.
- Known two-asset fixtures and unconstrained analytical solutions agree.
- Frontier variance is monotone around the minimum-variance point.
- Maximum-Sharpe selection is reproducible and surfaces optimizer warnings.

Release 1 exit gate:

- All three verticals have a model note, versioned inputs, numerical validation,
  model-specific diagnostics, at least one comparison visual, and performance
  measurements.
- Jump and GARCH are independently selectable portfolio cases.
- Mean-variance output can seed a portfolio allocation, but does not silently
  change a running projection scenario.

### Release 2 — Portfolio risk and life-cycle planning

#### Historical bootstrap

- Import aligned historical return matrices.
- Begin with IID row resampling, then add moving-block bootstrap for serial
  dependence.
- Make sample dates, missing-data policy, block size, and replacement policy
  visible.
- Verify that sampled rows come from the source dataset and that block ordering
  is preserved.

#### VaR and CVaR

- Define loss as a positive quantity before calculating either metric.
- Support historical, parametric, and Monte Carlo VaR.
- Calculate CVaR as the average loss beyond the selected VaR threshold, with an
  explicit finite-sample convention.
- Support confidence levels, holding periods, portfolio value, and risk
  contribution.
- Add rolling breach charts and coverage statistics only when a time-indexed
  backtest dataset is present.

Validation:

- VaR is monotone with confidence for a fixed empirical loss sample.
- CVaR is not below VaR under the documented convention.
- Parametric normal fixtures agree with analytical values.
- Historical results agree with hand-calculated small samples.
- Backtests prevent look-ahead and label estimation and test windows.

#### Retirement and sequence of returns

- Add accumulation and withdrawal phases.
- Support contributions, retirement age, inflation, allocation, rebalancing,
  fixed-real withdrawals, percentage withdrawals, and one dynamic spending rule.
- Track depletion probability, failure year, bequests, and real spending.
- Use the same asset-return path with reversed return order to teach sequence
  risk without changing the return set.

Validation:

- Zero-return deterministic cash-flow fixtures reconcile exactly.
- Withdrawals occur at the documented point in each period.
- Inflation changes real spending and values consistently.
- No path continues with negative holdings after depletion unless debt is an
  explicit feature.

Release 2 exit gate:

- “Expected Shortfall” means CVaR everywhere in the Risk Lab.
- Historical inputs show provenance and never masquerade as forecasts.
- Retirement output distinguishes failure probability from target probability.

### Release 3 — Regime, fat-tail, and dependency models

#### HMM calibration and provenance enhancement

- Build on the HMM already migrated behind the portfolio-lab case interface in
  Release 0.
- Keep the training-payload parser as an external adapter.
- Preserve labeled state mapping, transition validation, occupancy, and sampled
  regime paths.
- Add model-version and calibration-provenance fields.

#### Student-\(t\) innovations

- Standardize innovations so configured variance retains its documented
  interpretation.
- Require degrees of freedom compatible with the requested moments.
- Compare normal and Student-\(t\) terminal tails under shared uniforms where the
  transformation permits a meaningful paired comparison.

#### Gaussian and Student-\(t\) copulas

- Separate marginals from dependence.
- Validate correlation matrices and factorization.
- Show joint-return scatterplots, loss distributions, and tail co-movement.
- Add Gaussian first; add Student-\(t\) after Gaussian and marginal transforms
  are verified.

#### Sanctioned combined market pipeline

Add the HMM → GARCH → copula → jump-diffusion composite only after the standalone
models pass. Start with:

- HMM selecting drift.
- One GARCH variance process per asset.
- Copula-correlated standardized diffusion innovations.
- Global jump parameters, with independent asset jumps unless a separate jump
  dependence model is specified.

Release 3 exit gate:

- Every combined parameter has exactly one owner.
- Turning off regimes, dynamic variance, dependence, or jumps produces the
  corresponding simpler model within tolerance.
- Combined diagnostics show regime, variance, and jump events without requiring
  the common portfolio result to know their internal shapes.

### Release 4 — Derivatives laboratory

Implement in this order.

#### Black-Scholes

- European calls and puts with continuous dividend yield.
- Price and core Greeks.
- Payoff and profit/loss diagrams kept distinct from model value.
- Price and Greek surfaces over spot, volatility, and time.

Validation:

- Put-call parity.
- Intrinsic and no-arbitrage bounds.
- Known analytical fixtures.
- Finite-difference checks for analytical Greeks.

#### Cox-Ross-Rubinstein binomial tree

- European and American calls and puts.
- Expandable asset and option trees for bounded step counts.
- Backward induction, risk-neutral probabilities, and early-exercise regions.

Validation:

- One- and two-step hand calculations.
- American value is not below its European counterpart.
- European values converge toward Black-Scholes as steps increase.

#### Monte Carlo option pricing

- Begin with European pricing as a benchmark.
- Add Asian, barrier, basket, and lookback payoffs one at a time.
- Add antithetic variates first, control variates second.
- Defer quasi-Monte Carlo and importance sampling until each has a measured
  variance or convergence benefit.
- Report standard error and confidence interval with every estimate.

Validation:

- European confidence intervals cover the analytical benchmark at the documented
  frequency across deterministic seed fixtures.
- Path-dependent payoff rules have hand-calculated path tests.
- Variance-reduction modes do not change the estimand.

#### Heston stochastic volatility

- Simulate price and variance with correlated shocks.
- Use a documented positivity-preserving discretization.
- Show variance paths, clustering, leverage effect, and price distributions.
- Add Heston Monte Carlo option pricing before considering calibration or a
  semi-analytical implementation.

Validation:

- Nonnegative simulated variance under the chosen scheme.
- Long-run average variance and mean reversion match parameter expectations.
- Correlated shock samples match configured \(\rho\).
- A vanishing volatility-of-volatility case approaches deterministic variance.

#### Strategy builder

Compose validated option legs into covered calls, protective puts, straddles,
strangles, vertical spreads, and iron condors. Aggregate leg cash flows and
Greeks; do not create a separate pricing formula for each named strategy.

Release 4 exit gate:

- Analytical, tree, and Monte Carlo European prices can be compared on the same
  contract.
- Every stochastic price has a confidence interval.
- American exercise and path-dependent payoff semantics are explicit.

### Release 5 — Fixed income and credit

#### Vasicek

- Prefer exact transition sampling for the short rate.
- Show rate fans, negative-rate frequency, zero-coupon bond prices, duration, and
  convexity sensitivity.
- Verify conditional moments and analytical zero-coupon bond fixtures.

#### Cox-Ingersoll-Ross

- Use a documented nonnegative simulation method.
- Surface the Feller condition and its interpretation as a warning or
  constraint, not a hidden correction.
- Compare future-rate distributions and bond values with Vasicek.
- Verify positivity behavior, conditional moments, and zero-coupon prices.

#### Nelson-Siegel yield curves

- Fit level, slope, and curvature to a cross-section of maturities.
- Show observed versus fitted curves and parallel, steepening, flattening, and
  curvature shocks.
- Add stochastic factor dynamics only as a later, explicit model.
- Verify maturity-unit handling and recovery of synthetic factor fixtures.

#### Hazard-rate credit

- Start with constant and piecewise-constant hazards.
- Calculate survival, default timing, recovery, expected loss, and risky bond
  cash flows.
- Later add a documented dependence model for portfolio defaults.
- Verify \(S(T)=e^{-\lambda T}\) for the constant-hazard case and exact cash-flow
  fixtures.

#### Merton structural credit

- Model firm assets, debt threshold, equity as a call, risky debt, distance to
  default, and maturity default probability.
- Reuse the validated GBM and Black-Scholes kernels once both laboratories need
  them.
- Verify balance-sheet identities, option-value relationships, and limiting
  cases.

Release 5 exit gate:

- Short-rate, curve, and credit quantities use separate semantic types.
- Bond valuation states the pricing measure and discounting convention.
- Reduced-form and structural default probabilities are not presented as
  interchangeable.

### Release 6 — Portfolio intelligence

Implement the following on top of the validated covariance, optimization, and
risk modules.

#### CAPM

- Security market line, beta, alpha, expected versus realized return, and
  portfolio beta.
- Verify regression and line-equation fixtures.

#### Factor models

- Begin with supplied or imported factor returns.
- Estimate exposures, residual risk, return contribution, risk contribution, and
  scenario shocks.
- Add market, size, value, momentum, quality, rates, inflation, and commodities
  as data-defined factors rather than hard-coded formulas.
- Prevent look-ahead in rolling exposure analysis.

#### Risk parity

- Long-only equal-risk-contribution portfolios first.
- Compare capital weights with marginal and total risk contributions.
- Verify that contributions sum to total volatility and converge to the requested
  budget within tolerance.

#### Kelly criterion

- Begin with a continuous-return approximation and configurable fractional Kelly.
- Require leverage and allocation caps in the product interface.
- Show growth, drawdown, and ruin trade-offs for full, half, and quarter Kelly.
- Verify deterministic binary-bet fixtures and make approximation limits clear.

#### Black-Litterman

- Market-cap equilibrium prior, absolute and relative views, view confidence, and
  posterior returns.
- Show prior versus posterior returns, weights, and view contribution.
- Verify small published-style matrix fixtures and sensitivity to confidence.
- Reuse the mean-variance optimizer rather than embedding another allocator.

Release 6 exit gate:

- Every allocation reports capital weights, expected risk/return, and risk
  contributions under the same assumptions.
- Optimization warnings and constraints remain visible.
- Estimates, investor views, and model-implied quantities are labeled distinctly.

### Release 7 — Statistical arbitrage and market microstructure

#### Ornstein-Uhlenbeck spread model

- Simulate spreads, equilibrium, half-life, thresholds, target-hitting
  probability, and pairs-trading rules.
- Fit only to stationary spread candidates with diagnostics.
- Verify exact or documented discretization moments and half-life.

#### Limit-order-book engine

- Implement a deterministic event engine with limit orders, market orders, and
  cancellations.
- Enforce price-time priority and conservation of cash, inventory, and executed
  quantity.
- Produce a replayable event log, ladder snapshots, depth, spread, tape,
  slippage, and price-impact summaries.
- Keep bounded event counts and price levels in the first release.

#### Agent-based market

- Add fundamental, trend, market-making, noise, and risk-parity agents as
  strategies that submit orders to the validated book.
- Record agent cash, inventory, wealth, orders, and decisions.
- Treat results as scenario dynamics, not calibrated forecasts.
- Verify accounting conservation and deterministic replay before adding agent
  complexity.

#### Almgren-Chriss optimal execution

- Implement the analytical temporary/permanent-impact model first.
- Show shares remaining, expected cost, variance, and the urgency frontier.
- Later compare the schedule against execution in the order-book simulator.
- Verify endpoints, monotone liquidation, zero-risk and high-risk limits, and
  cost decomposition.

Release 7 exit gate:

- Event replay reproduces the same market state.
- Accounting identities hold after every event.
- Strategy wealth includes inventory mark-to-market and transaction costs.
- Optimal-execution assumptions are not confused with order-book calibration.

## 7. Complete model coverage and dependency index

| Model or capability | Status / release | Primary prerequisite |
| --- | --- | --- |
| Geometric Brownian motion | Existing; extract in Release 0 | Portfolio-lab seam |
| Hidden Markov regimes | Existing; consolidate in Releases 0 and 3 | Semantic RNG streams |
| Merton jump diffusion | Release 1 | Extracted GBM and Poisson draws |
| GARCH(1,1) | Release 1 | Return-series conventions and calibration snapshot |
| Mean-variance optimization | Release 1 | Matrix validation and constrained solver |
| Historical bootstrap | Release 2 | Validated historical return matrix |
| Value at Risk | Release 2 | Standard loss convention |
| Conditional Value at Risk | Release 2 | VaR and loss-tail convention |
| Retirement sequence model | Release 2 | Cash-flow and withdrawal policy |
| Student-\(t\) returns | Release 3 | Standardized innovation interface |
| Gaussian copula | Release 3 | Marginal transforms and correlation factorization |
| Student-\(t\) copula | Release 3 | Gaussian copula plus Student-\(t\) sampler |
| Black-Scholes | Release 4 | Normal CDF and contract conventions |
| Binomial option tree | Release 4 | Option contract module |
| Monte Carlo option pricing | Release 4 | GBM, payoff module, confidence intervals |
| Heston stochastic volatility | Release 4 | Variance scheme and correlated streams |
| Vasicek | Release 5 | Rate and discounting conventions |
| CIR | Release 5 | Nonnegative rate sampler |
| Nelson-Siegel | Release 5 | Yield-curve data and fitting |
| Hazard-rate credit | Release 5 | Cash-flow and survival conventions |
| Merton structural credit | Release 5 | GBM and Black-Scholes |
| CAPM | Release 6 | Return-series and regression conventions |
| Factor models | Release 6 | Aligned asset and factor returns |
| Risk parity | Release 6 | Covariance and optimizer |
| Kelly criterion | Release 6 | Return assumptions and allocation caps |
| Black-Litterman | Release 6 | Mean-variance optimizer and market weights |
| Ornstein-Uhlenbeck | Release 7 | Spread construction and stationarity diagnostics |
| Limit-order book | Release 7 | Event clock and accounting ledger |
| Agent-based market | Release 7 | Limit-order-book engine |
| Almgren-Chriss execution | Release 7 | Impact model; order book only for later comparison |

## 8. Verification strategy

Tests should cross the same module interfaces used by callers. Private numerical
details may change without rewriting behavior tests.

Every model requires five verification layers:

1. **Deterministic fixtures** — zero-volatility, zero-jump, one-step, or
   hand-calculated cases.
2. **Analytical or limiting benchmarks** — GBM moments, Black-Scholes parity,
   binomial convergence, GARCH unconditional variance, Vasicek/CIR bond prices,
   hazard survival, or known optimizer solutions.
3. **Statistical properties** — fixed-seed empirical moments, correlations,
   event frequencies, coverage, and tail behavior with predeclared tolerances.
4. **Invariants** — finite outputs, probability bounds, matrix validity,
   accounting conservation, constraint satisfaction, and time/path prefix
   stability.
5. **Integration behavior** — worker serialization, cancellation, stale-result
   suppression, resource preflight, chart-safe result size, and persisted-schema
   migration.

Use fixed seeds and sufficiently wide statistical tolerances to avoid flaky
tests. Do not approve a model because a chart “looks right.” Do not use broad
snapshot tests as substitutes for mathematical assertions.

Each release runs:

```bash
npm run lint
npm test
npm run build
```

Add browser performance checks once model execution, transfer size, or rendering
becomes a measured bottleneck. Consider WebAssembly, worker pools, or GPU
execution only after profiling demonstrates that pure TypeScript and typed arrays
cannot meet an explicit budget.

## 9. User-experience plan

The application shell should become a laboratory index with lazy-loaded
workspaces rather than an ever-growing control rail.

Every laboratory should follow the same learning loop:

```text
Choose a model or comparison
        -> edit assumptions with units and bounds
        -> inspect paths, distributions, or structures
        -> read decision metrics and uncertainty
        -> inspect diagnostics and model limitations
        -> save or compare a versioned scenario
```

Common UI requirements:

- A short “What this model answers” statement.
- A visible assumptions and limitations card.
- Parameter presets labeled illustrative, not historical or live.
- A baseline comparison whenever one is mathematically meaningful.
- Model-specific diagnostics without leaking those fields into unrelated labs.
- Downloadable scenario inputs and compact result summaries before raw path
  export.
- Accessible non-animated alternatives for animated trees, order flow, and
  time-decay views.
- No implication of prediction, suitability, or investment advice.

## 10. Data and persistence plan

Version persisted scenarios independently for each laboratory. A saved scenario
contains normalized inputs, engine/model versions, and optional fitted-parameter
snapshot references. It should not automatically persist large raw path matrices.

Introduce a validated dataset shape before historical bootstrap, fitting, factor
models, or backtesting:

- Asset/factor identifiers.
- Observation timestamps and frequency.
- Price or return convention.
- Missing-value and alignment policy.
- Currency and adjustment metadata where relevant.
- Source/provenance label.

Start with local bundled examples and user-imported files. Add live or remote data
only when the project has explicit licensing, caching, stale-data, and failure
policies.

## 11. Definition of done for a model

A model is not complete until all of the following are true:

- It has a versioned, discriminated input and result contract.
- Parameter names include units and return/compounding conventions.
- Runtime validation covers admissibility, numerical safety, and resource limits.
- The stochastic implementation is deterministic for a fixed version and seed.
- At least one analytical, limiting, or hand-calculated benchmark passes.
- Statistical tests use fixed seeds and documented tolerances.
- The model has tagged diagnostics and structured failures.
- The UI includes its primary visual, comparison, assumptions, and limitations.
- The worker transfers a bounded result rather than every simulated value by
  default.
- A model note records equations, discretization or solver choice, calibration
  method, references, and known limitations.
- The full lint, test, and build sequence passes.

## 12. First implementation backlog

When implementation begins, create work in this order:

1. **Portfolio-lab characterization**
   - Add missing current-behavior event-order and worker-staleness tests.
2. **Portfolio-lab contracts**
   - Add versioned case-based requests, primary detail, comparison summaries,
     diagnostics, warnings, and typed problems.
3. **Portfolio-lab case invariants**
   - Add case-order and case-addition specification tests against the new
     contract.
4. **Random-stream migration**
   - Add semantic diffusion and HMM-transition streams while preserving the
     tested comparison behavior.
5. **GBM/HMM migration**
   - Move current models behind the new seam and remove unconditional dual-model
     execution.
6. **Metric terminology migration** — complete
   - The current measure is named `tailCapitalShortfall` throughout the engine,
     compatibility contract, and UI. “Expected Shortfall” remains reserved for
     standard loss-tail CVaR.
7. **Jump-diffusion vertical**
   - Kernel, limiting tests, portfolio case, jump diagnostics, tail comparison,
     and model note.
8. **GARCH vertical**
   - Supplied-parameter simulation, volatility cone, fitting snapshot, comparison,
     and model note.
9. **Mean-variance vertical**
   - Construction-lab seam, covariance validation, long-only solver, frontier,
     weights, contributions, and model note.

This sequence delivers visible modeling value early while establishing seams
that the remaining roadmap can reuse without turning the current simulator into
a monolith.

## 13. Implementation ledger — 2026-07-31

This ledger records repository evidence without rewriting the roadmap's target
state. “Standalone implemented” means a versioned TypeScript API, runtime
validation, focused tests, a model note, and a learner chapter exist. It does
**not** mean that every release-level exit gate, cross-model handoff, planned
visual, imported-data workflow, or production calibration is complete.

### 13.1 Learning application and shared foundation

| Capability | Evidence | Status and boundary |
| --- | --- | --- |
| Six lazy laboratories and 31 chapters | [`catalog.ts`](../src/labs/catalog.ts), [`routes.ts`](../src/labs/routes.ts), and [`App.tsx`](../src/App.tsx) | Implemented. Portfolio projection has nine chapters including the preserved accumulation simulator; Risk has two; Construction six; Derivatives five; Rates & Credit five; and Trading four. |
| Shared numerical foundation | [`core.ts`](../src/lib/quant/core.ts) and [`core.test.ts`](../src/lib/quant/core.test.ts) | Implemented for the current consumers: validation, moments and R-7 quantiles, matrix operations/factorization, distributions, root finding, optimization helpers, and versioned semantic random streams. It is not a general-purpose scientific-computing library. |
| Advanced chapter worker | [`lesson-worker-protocol.ts`](../src/labs/lesson-worker-protocol.ts), [`lesson.worker.ts`](../src/workers/lesson.worker.ts), and [`useLessonWorker.ts`](../src/hooks/useLessonWorker.ts) | Implemented with structured failures, cancellation by worker termination, stale-response suppression, and bounded lesson results. |
| Bounded local CSV import | [`DatasetImport.tsx`](../src/components/DatasetImport.tsx), [`imported-datasets.ts`](../src/labs/imported-datasets.ts), [`imported-datasets.test.ts`](../src/labs/imported-datasets.test.ts), and [`lesson-worker-protocol.test.ts`](../src/labs/lesson-worker-protocol.test.ts) | Implemented for GARCH calibration, historical bootstrap, ordered-regime fitting, VaR backtesting, and factor analysis. Files are capped at 2 MB, parsed in the worker, labeled `user-imported`, and represented in saved scenarios by filename/contract reference rather than raw contents. |
| Learner documentation | [Model notes](models/README.md) and [references](models/references.md) | Implemented for all six laboratories. Notes state equations, units, implementation choices, gates, intuition, assumptions, limitations, and educational disclaimers. |
| Scenario persistence and export | [`QuantLabWorkspace.tsx`](../src/labs/QuantLabWorkspace.tsx) | Implemented per laboratory for normalized inputs and compact summaries. Large raw path matrices are not persisted by default. |

### 13.2 Release evidence and remaining gates

| Roadmap release | Implemented evidence | Release-level status |
| --- | --- | --- |
| Release 0 — portfolio seam | Native contracts, market/accounting/analytics separation, in-process runner, browser-worker runner, semantic streams, case invariants, structured problems, and resource preflight live in [`src/lib/portfolio-lab`](../src/lib/portfolio-lab). The browser baseline is recorded in [`portfolio-lab-baseline.md`](benchmarks/portfolio-lab-baseline.md). | **Implemented.** The original accumulation route now constructs explicit native GBM/HMM cases through [`portfolio-projection-model.ts`](../src/labs/portfolio-projection-model.ts), executes the worker runner, and consumes a native-result presentation model. Persisted field names remain compatible. The old worker is deleted; the deprecated adapter/types have no production caller and remain quarantined only to preserve pre-existing local edits, as recorded in the [migration record](legacy-portfolio-lab-adapter-removal.md). |
| Release 1 — jump, GARCH, mean-variance | Jump diffusion, GARCH simulation/calibration, and the standalone versioned Student-t innovation comparison are in [`market-models.ts`](../src/lib/quant/market-models.ts); the GARCH chapter can fit a bounded user-imported return series. Mean-variance/frontier allocation is in [`construction.ts`](../src/lib/quant/construction.ts). Native [`advanced-contracts.ts`](../src/lib/portfolio-lab/advanced-contracts.ts) and [`advanced-runner.ts`](../src/lib/portfolio-lab/advanced-runner.ts) expose GBM, jump, and GARCH as explicitly requested portfolio cases without mutating request@1. Focused evidence is in [`market-models.test.ts`](../src/lib/quant/market-models.test.ts), [`construction.test.ts`](../src/lib/quant/construction.test.ts), and [`advanced-runner.test.ts`](../src/lib/portfolio-lab/advanced-runner.test.ts). | **Implemented.** Request@2 adds generalized holdings/accounting, grouped metrics, discriminated diagnostics, structured problems, resource preflight, and standard terminal-loss VaR/CVaR. The [Release 1 browser-worker record](benchmarks/release-1-model-verticals.md) measures jump diffusion, GARCH, and mean–variance against an explicit interaction budget. Mean-variance has an explicit user-triggered projection handoff rather than silently mutating a scenario. |
| Release 2 — bootstrap, risk, retirement | IID/moving-block bootstrap and validated return datasets are in [`market-models.ts`](../src/lib/quant/market-models.ts). VaR/CVaR, attribution, rolling backtests, retirement cash flows, three withdrawal rules, allocation/rebalancing, and return-order reversal are in [`risk.ts`](../src/lib/quant/risk.ts) and [`risk.test.ts`](../src/lib/quant/risk.test.ts). Bootstrap and backtest chapters accept time-ordered local CSVs with explicit user-imported provenance. | **Standalone verticals and bounded local-import flow implemented.** Templates make the accepted shape visible; missing cells are rejected rather than silently imputed, and results remain educational and supplied-data dependent. Interactive column mapping and alternative missing-data policies are not implied. |
| Release 3 — regimes, fat tails, dependence, composite | Student-t innovations, Gaussian and Student-t copulas, correlation validation, and the ordered HMM → GARCH → copula → jump kernel are in [`market-models.ts`](../src/lib/quant/market-models.ts), with limiting-switch tests and bounded diagnostics. The ordered-regime chapter accepts a user-imported monthly log-return series and records its snapshot provenance. Request@2 in [`advanced-runner.ts`](../src/lib/portfolio-lab/advanced-runner.ts) continues the sanctioned order through portfolio accounting and standard terminal economic-loss VaR/CVaR. The illustrative HMM payload adapter remains in [`hmm-model.ts`](../src/lib/hmm-model.ts). | **Standalone and sanctioned end-to-end native composition implemented.** Tagged composite diagnostics remain separate from common portfolio results, all simpler cases are explicit, and request@1 stays frozen. HMM output is illustrative or explicitly user-imported; no bundled value is presented as live. |
| Release 4 — derivatives | Black-Scholes prices/Greeks/surfaces, CRR European/American trees, Monte Carlo European/Asian/barrier/basket/lookback pricing with confidence intervals and variance reduction, Heston simulation/pricing, and composable named strategies are in [`derivatives.ts`](../src/lib/quant/derivatives.ts) and [`derivatives.test.ts`](../src/lib/quant/derivatives.test.ts). | **Implemented.** Black-Scholes exposes dividend yield and bounded spot/volatility/time surface slices. Heston separates spot, variance, terminal-distribution, and leverage-effect views. The UI intentionally bounds stored tree/surface detail, while calibration and semi-analytical Heston pricing remain explicitly out of scope. |
| Release 5 — rates and credit | Exact-transition Vasicek, nonnegative CIR, model comparison, Nelson-Siegel fitting and named shocks, constant/piecewise hazard credit and risky bonds, and Merton structural credit are in [`rates-credit.ts`](../src/lib/quant/rates-credit.ts) and [`rates-credit.test.ts`](../src/lib/quant/rates-credit.test.ts). | **Model vertical implemented.** Short-rate, curve, reduced-form, and structural-credit results remain separate. Inputs are illustrative parameters rather than a live curve or issuer calibration. |
| Release 6 — portfolio intelligence | CAPM, aligned and rolling factor regressions, factor return/risk attribution and shocks, equal-risk-contribution allocation, bounded fractional Kelly, and Black-Litterman posterior allocation are in [`construction.ts`](../src/lib/quant/construction.ts) and its tests. The factor chapter can split a combined local CSV's `asset:` and `factor:` columns into separately provenance-labelled datasets before timestamp alignment. | **Model vertical and bounded local factor import implemented.** Factors are data-defined, but no bundled or imported identifier is asserted to be a live market factor. Estimates, investor views, and model-implied quantities are labeled separately. |
| Release 7 — trading and microstructure | Exact-transition OU simulation and OLS fit, deterministic price-time-priority event replay, per-event accounting snapshots, optional maker/taker fees, bounded ladders, illustrative single-asset risk-budget and other agent rules, fee-inclusive wealth history, and numerically stable analytical Almgren-Chriss schedules are in [`trading.ts`](../src/lib/quant/trading.ts) and [`trading.test.ts`](../src/lib/quant/trading.test.ts). | **Standalone verticals implemented; venue coupling deferred.** The roadmap itself places order-book execution comparison after the analytical Almgren-Chriss model. The book and agents are stylized deterministic scenarios, not a calibrated venue or evidence of a profitable strategy; the deprecated `risk-parity` agent name is only a compatibility alias because a one-asset book cannot form a true risk-parity allocation. |

### 13.3 Verification evidence

The repository's focused tests follow the five verification layers in section 8:
small deterministic fixtures, analytical or limiting cases, fixed-seed
statistical checks, invariants, and worker/integration behavior. The commands
remain:

```bash
npm run lint
npm test
npm run build
```

`npm run check` runs all three. `npm run benchmark:portfolio` records the native
GBM/HMM production worker boundary; `npm run benchmark:release1` records the
jump, GARCH, and mean–variance lesson-worker workloads and their interaction
budgets. A model or chapter should be described as complete only after the
current working tree passes those checks; this ledger names evidence locations
but is not a substitute for running them.

### 13.4 Explicitly deferred extensions and quarantine cleanup

1. Delete the quarantined legacy adapter/types/tests only after their pre-existing
   local edits have been intentionally reviewed or archived. They have no
   production caller and do not block the native accumulation workflow; see the
   [migration record](legacy-portfolio-lab-adapter-removal.md).
2. Extend the learner-facing request@2 comparison beyond its current
   composite-versus-GBM experiment when direct jump-versus-GBM or
   GARCH-versus-constant portfolio-accounting lessons are needed. Keep request@1
   frozen; new model kinds require another contract version and standalone gates.
3. Extend the bounded template-based CSV flow with interactive column mapping or
   alternative missing-data/alignment policies only if a real learning workflow
   needs them; the current import intentionally rejects missing cells and keeps
   raw file content out of persistence.
4. Add further model-specific browser performance records only when a workload
   justifies its own budget. The GBM/HMM and Release 1 records must not be
   generalized to every laboratory.
5. Treat live data, remote calibration, tax/suitability logic, exchange-grade
   matching, and production pricing/risk controls as new scoped projects, not as
   implied capabilities of this educational implementation.
