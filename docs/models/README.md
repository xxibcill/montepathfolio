# Quantitative model notes

These notes turn the [quantitative laboratory roadmap](../quantitative-model-roadmap.md)
into a learner-facing companion to the implemented TypeScript. They describe what
the code does now, including numerical conventions and simplifying choices; they
do not silently replace an implementation detail with a more advanced textbook
method.

Use the [references and further reading](references.md) to continue from a
worked lesson into classic papers and books. The notes and tests—not a citation
alone—define the exact convention implemented by this repository.

## Laboratory index

| Note | Implemented capabilities |
| --- | --- |
| [Portfolio and market models](portfolio-market.md) | Portfolio GBM/HMM baseline, ordered regimes, jump diffusion, GARCH, Student-t innovations, historical bootstrap, copulas, the sanctioned composite pipeline, and native request@2 portfolio/risk integration |
| [Risk and retirement](risk-retirement.md) | Historical/normal/Monte Carlo VaR and CVaR, attribution, rolling backtests, withdrawals, depletion, and sequence risk |
| [Portfolio construction](construction.md) | Mean-variance, CAPM, factor models, risk parity, continuous and binary Kelly, and Black-Litterman |
| [Derivatives](derivatives.md) | Black-Scholes and Greeks, payoff diagrams and surfaces, CRR trees, Monte Carlo payoffs, Heston, and option strategies |
| [Rates and credit](rates-credit.md) | Vasicek, CIR, Nelson-Siegel, constant/piecewise hazard credit, risky bonds, and Merton structural credit |
| [Trading and market microstructure](trading.md) | Ornstein-Uhlenbeck spreads, a price-time-priority order book, agent scenarios, and Almgren-Chriss execution |

## Shared numerical foundation

The laboratories use the inspectable kernels in
[`core.ts`](../../src/lib/quant/core.ts): finite/range checks, R-7 linear
quantiles, sample and population moments, matrix algebra, Cholesky validation,
normal distribution approximations, and semantic pseudo-random streams.

- Rates and volatilities are decimals: `0.05` means 5%, not 5.
- A field ending in `PerPeriod` belongs to the caller's chosen period. A field
  containing `Annual` is annualized. Time fields ending in `Years` are in years.
- Simple and log returns are not interchangeable. Each note identifies the
  convention used by its model.
- R-7 quantiles use position $(n-1)p$ and linearly interpolate between adjacent
  sorted observations.
- Cholesky factorization both validates positive-semidefinite covariance or
  correlation input and produces correlated Gaussian shocks. Singular matrices
  are accepted by the tolerant factorization; construction solvers may add a
  disclosed tiny diagonal ridge.
- Semantic randomness addresses each draw by seed, model namespace, path, step,
  asset, and role. A fixed version and seed are reproducible, and adding an
  unrelated draw does not shift an existing stream. This is deterministic
  pseudo-randomness, not evidence that the scenario is likely.
- Stochastic APIs return an engine version, input/result contracts, seed when
  relevant, and warnings. A warning preserves a mathematically permitted run; a
  `QuantError` rejects invalid dimensions, domains, matrices, or resource use.
- GARCH, bootstrap, ordered-regime, VaR-backtest, and factor chapters can replace
  their bundled examples with a local CSV of at most 2 MB. Templates state the
  accepted columns; missing cells are rejected; parsing occurs in the lesson
  worker; provenance is labeled `user-imported`; and saved scenarios retain only
  a filename/contract reference, not raw file contents.

## A productive way to study

For each section, first compute the small worked intuition by hand. Then run the
linked implementation with a zero-volatility, one-step, or two-asset input. Only
after the limiting case makes sense should you add random paths or more assets.
The “validation gate” is the behavior the repository tests before treating that
model as usable; a visually plausible chart is not a gate.

All examples and model output in this directory are for education only. They are
not investment, trading, pricing, credit, tax, retirement, or suitability advice.
