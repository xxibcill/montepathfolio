# Montepathfolio — Quantitative Finance Laboratory

Montepathfolio is a browser-based learning environment for exploring the
mathematics behind portfolio simulation, risk, allocation,
derivatives, rates and credit, and market microstructure. It contains six
focused laboratories and 31 guided chapters. Each chapter starts with a
question, states its units and assumptions, runs a fixed-seed experiment, and
connects the output to equations, diagnostics, limitations, and a worked
intuition.

The project describes uncertainty and model mechanics; it does not predict
markets. Every preset and result is educational only—not investment, trading,
pricing, credit, retirement, tax, or suitability advice.

## Laboratories

| Laboratory | Chapters | Topics |
| --- | ---: | --- |
| Portfolio projection | 9 | Accumulation with GBM/HMM, jump diffusion, GARCH, historical bootstrap, retirement sequence risk, regime provenance, Student-t innovations, copulas, and the sanctioned composite market model |
| Risk | 2 | Historical/parametric/Monte Carlo VaR and CVaR, Euler attribution, and rolling coverage backtests |
| Portfolio construction | 6 | Mean-variance, CAPM, factor models, risk parity, Kelly, and Black-Litterman |
| Derivatives | 5 | Black-Scholes, Cox-Ross-Rubinstein trees, Monte Carlo payoffs, Heston, and option strategies |
| Rates & credit | 5 | Vasicek, CIR, Nelson-Siegel, hazard-rate credit, and Merton structural credit |
| Trading mechanics | 4 | Ornstein-Uhlenbeck spreads, a deterministic order book, agent scenarios, and Almgren-Chriss execution |
| **Total** | **31** | Six separate learning workflows sharing validated numerical kernels |

Open a laboratory from the index, change one assumption, and run the experiment.
The interface retains the prior run for a cause-and-effect comparison. Presets
are illustrative rather than historical or live. Scenario inputs are stored per
laboratory in browser `localStorage`, and compact inputs or result summaries can
be downloaded without an account or backend.

Five chapters—GARCH fitting, historical bootstrap, ordered-regime fitting, VaR
backtesting, and rolling factor analysis—also accept optional local CSV files.
Each chapter provides a template; attachments are capped at 2 MB, validated in
the worker, labeled `user-imported`, and never sent to a service. Saved scenarios
retain only the file name/contract reference, not the raw file contents.

The learner-facing equations, conventions, validation gates, examples, and
limitations live in the [quantitative model notes](docs/models/README.md). The
[references and further reading](docs/models/references.md) point to the classic
sources behind the models.

## Quick start

Use Node.js `^20.19.0` or `>=22.12.0` with npm:

```bash
npm ci
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Create a production build
with:

```bash
npm run build
```

## Architecture and reproducibility

The stack is React 19 with TypeScript, Vite, Canvas 2D, dedicated browser Web
Workers, plain responsive CSS, Vitest, and ESLint.

The application is intentionally split by workflow rather than built as one
universal model graph:

```text
React laboratory index and lazy chapter routes
        -> versioned, structured-clone-safe lesson request
        -> dedicated browser Web Worker
        -> workflow-specific quantitative engine
        -> bounded chart series, metrics, diagnostics, warnings, and provenance
```

- [`src/labs/catalog.ts`](src/labs/catalog.ts) defines the six laboratories,
  chapter learning material, input units, bounds, and illustrative presets.
- The laboratory-family workers in [`src/workers`](src/workers) run advanced
  chapter calculations off the interface thread without loading unrelated model engines. Their protocol returns structured
  failures, validates bounded optional data attachments, and the React hook
  handles cancellation and stale responses.
- [`src/lib/quant`](src/lib/quant) owns the standalone market, risk,
  construction, derivatives, rates/credit, and trading engines. Shared matrix,
  statistics, distribution, validation, and semantic-randomness kernels live in
  [`core.ts`](src/lib/quant/core.ts).
- [`src/lib/portfolio-lab`](src/lib/portfolio-lab) owns two native versioned
  seams. Frozen request@1 preserves GBM/HMM behavior with in-process and Web
  Worker runners. Request@2 adds explicit GBM, jump-diffusion, GARCH, and
  sanctioned-composite cases with generalized holdings, contributions,
  withdrawals, rebalancing, grouped portfolio metrics, and terminal-loss
  VaR/CVaR.
- [`src/labs/PortfolioProjectionLab.tsx`](src/labs/PortfolioProjectionLab.tsx)
  preserves the original accumulation teaching workflow while constructing
  explicit native GBM/HMM requests. Its learner-facing persisted input and chart
  view models are separate from the deprecated simulation compatibility types;
  the migration evidence is recorded in the
  [legacy-adapter removal record](docs/legacy-portfolio-lab-adapter-removal.md).

Stochastic engines use versioned semantic random addresses rather than relying
on one sequential stream. A draw is keyed by roles such as seed, model, path,
step, asset, and shock type. This makes fixed-version/fixed-seed runs
reproducible, keeps unrelated random roles isolated, and supports fair paired
comparisons. It does not make an illustrative scenario probable. See
[semantic random streams](docs/semantic-random-streams.md).

Rates and volatilities are decimal values (`0.05` means 5%). Model contracts
state time and return conventions, validate dimensions and resource limits, and
return bounded samples rather than every simulated value by default. Calibration
snapshots and historical datasets carry provenance and must not be described as
live unless the source actually is live.

## Tests, checks, and benchmark

Run the full validation sequence:

```bash
npm run check
```

Or run each stage separately:

```bash
npm run lint
npm run typecheck:benchmarks
npm test
npm run build
npm run test:routes
```

`npm run check` covers lint, application and benchmark type-checking, tests, and
the production build. The separate route smoke command launches Chrome to crawl
every chapter and verify navigation, focus, contrast, and touch-target contracts.

Test watch mode is available through `npm run test:watch`. The tests emphasize
hand-calculated fixtures, analytical and limiting cases, fixed-seed statistical
properties, matrix and accounting invariants, resource validation, worker
serialization, bounded CSV parsing/provenance, cancellation, and stale-response
handling.

Run the reproducible browser-worker benchmark with:

```bash
npm run benchmark:portfolio
npm run benchmark:release1
```

The benchmark measures a 1,000-path, 25-year, two-case GBM/HMM worker round trip.
The [recorded baseline](docs/benchmarks/portfolio-lab-baseline.md) is descriptive
machine-specific evidence, not a latency guarantee. The separate
[Release 1 benchmark](docs/benchmarks/release-1-model-verticals.md) measures jump
diffusion, GARCH, and mean–variance through the production lesson-worker boundary
against a deliberately generous classroom-interaction budget.

## Scope and limitations

- All built-in data, HMM state probabilities, transition matrices, parameters,
  and presets are transparent classroom examples. They are not live estimates.
- A model result is conditional on its inputs and simplifying assumptions. It
  does not include parameter uncertainty merely because it uses Monte Carlo.
- The original accumulation chapter compares constant-parameter GBM with a
  three-state Gaussian HMM. Its capital-relative `tailCapitalShortfall` measure
  is deliberately distinct from standard loss-tail CVaR in the Risk Lab.
- Historical resampling and calibration record source provenance but do not turn
  the past into a forecast.
- Pricing, credit, trading, and retirement chapters omit many real-world
  frictions and institutional constraints. Each model note lists the exact
  omissions for that implementation.
- No output is a recommendation, forecast, quoted market price, risk limit,
  credit assessment, or safe-withdrawal promise.

## Documentation and project map

- [Implementation roadmap and status ledger](docs/quantitative-model-roadmap.md)
- [Quantitative model notes](docs/models/README.md)
- [References and further reading](docs/models/references.md)
- [Portfolio benchmark record](docs/benchmarks/portfolio-lab-baseline.md)
- [Legacy-adapter migration record](docs/legacy-portfolio-lab-adapter-removal.md)

```text
src/
├── components/          Shared controls and accessible Canvas visualizations
├── data/                Illustrative HMM payload
├── hooks/               Worker lifecycle, theme, and Canvas sizing
├── labs/                Index, routes, 31-chapter catalog, runners, workspaces
├── lib/
│   ├── portfolio-lab/   Native v1/v2 contracts, portfolio engines, adapters
│   ├── quant/           Shared core plus six workflow-specific model modules
│   └── simulation.ts    Deprecated, test-only compatibility code; no app caller
├── types/               Learner workflow contracts plus quarantined legacy types
└── workers/             Lesson and native portfolio workers
```

The [quantitative model roadmap](docs/quantitative-model-roadmap.md) remains the
source of truth for model gates and unfinished integration work. A chapter or
kernel being present does not by itself close every release-level exit gate.
