# Portfolio Risk Sandbox

Portfolio Risk Sandbox is an interactive Monte Carlo planning tool for exploring how a stock-and-bond portfolio might evolve over time. It compares a constant-parameter model with a three-state Hidden Markov Model (HMM) that moves between persistent bull, bear, and sideways regimes. Change the portfolio assumptions and the app recalculates both sets of 1,000 monthly paths in a Web Worker, then shows the range of outcomes and explains how the latest scenario differs from the previous one.

This project describes uncertainty; it does not predict markets.

## MVP features

- Configure initial capital, monthly contributions, investment horizon, financial target, inflation, and stock/bond allocation.
- Set annual expected return and volatility for stocks and bonds.
- Edit stock–bond correlation and choose monthly, annual, or no rebalancing.
- Switch between Standard Monte Carlo and HMM Monte Carlo while retaining a side-by-side comparison.
- Inspect current bull, bear, and sideways probabilities and portfolio-level regime moments.
- Edit a row-normalized monthly transition matrix heatmap.
- Inspect an illustrative regime timeline and six representative simulated regime paths.
- Inspect a Canvas-rendered path chart with sampled paths, a median, 10th–90th and 5th–95th percentile bands, and the target.
- Explore a terminal-value histogram and drawdown chart.
- Review target probability, median ending value, inflation-adjusted median value, probability of ending below total contributions, median maximum drawdown, probability of a drawdown over 30%, average recovery time, and expected shortfall.
- Compare target probability, median ending value, maximum drawdown, expected shortfall, recovery time, and target shortfall across both models.
- Compare consecutive scenarios using the same random seed, with changes summarized in plain language.
- Keep scenario inputs in browser `localStorage`; no account or backend is required.

## Stack

- React 19 and TypeScript
- Vite
- Canvas 2D for charts
- Browser Web Worker for simulation
- Plain CSS with responsive layouts
- Vitest and ESLint

## Quick start

Install Node.js `^20.19.0` or `>=22.12.0` with npm, then:

```bash
npm ci
npm run dev
```

Open [http://localhost:4173](http://localhost:4173).

Create a production build with:

```bash
npm run build
```

## Model and method

Each asset follows geometric Brownian motion at monthly intervals. In the constant model, its annual return, volatility, and stock–bond correlation remain fixed:

$$
S_{t+\Delta t}
=
S_t \exp\left[
\left(\mu-\frac{\sigma^2}{2}\right)\Delta t
+\sigma\sqrt{\Delta t}\,Z
\right]
$$

Here, $\mu$ is the annual expected return, $\sigma$ is annual volatility, $\Delta t=1/12$, and $Z$ is a standard normal shock.

For the two-asset model, the bond shock is constructed from the stock shock and a second independent shock:

$$
Z_{\text{bond}}
=
\rho Z_{\text{stock}}
+\sqrt{1-\rho^2}\,\varepsilon
$$

This produces the selected stock–bond correlation $\rho$. Contributions are added after each monthly return and split by the target allocation. The portfolio is restored to that allocation on the selected rebalancing schedule.

### Hidden Markov regime engine

The HMM model uses three hidden states:

```text
             Next state
Current     Bull   Bear   Sideways
Bull        0.94   0.02   0.04
Bear        0.08   0.87   0.05
Sideways    0.12   0.05   0.83
```

The matrix is interpreted at the simulator’s monthly time step. A path samples its initial state from the current-state probabilities, then samples the next state before each monthly return. Each regime supplies a different expected-return vector and covariance structure through regime-specific stock return, stock volatility, bond return, bond volatility, and stock–bond correlation assumptions:

$$
\mathbf{r}_t \mid z_t=k
\sim \mathcal{N}(\boldsymbol{\mu}_k,\boldsymbol{\Sigma}_k)
$$

The bundled [`src/data/hmm-model.json`](src/data/hmm-model.json) is an illustrative training-service payload, not a live or historically fitted signal. It demonstrates the frontend contract for:

- State labels and regime-specific multi-asset assumptions
- Transition probabilities
- Current-state probabilities
- Optional historical timeline observations

A production Python service can train a three-state Gaussian HMM from weekly log returns and realized volatility, label the otherwise arbitrary state IDs by their learned return/volatility statistics, and export the same JSON shape.

Every UI run uses 1,000 paths. Gaussian asset shocks and HMM regime transitions use separate deterministic seeded streams. Standard and HMM paths share the same asset shocks, and corresponding paths keep the same shock prefix when the horizon changes, which makes model and scenario comparisons easier to interpret. The charts calculate monthly 5th, 10th, 50th, 90th, and 95th percentiles; up to 160 representative paths are retained for rendering.

Drawdown is measured on a parallel cash-flow-neutral portfolio index using the same asset shocks, allocation, and rebalancing schedule. Monthly deposits therefore increase the wealth paths without masking investment losses in the drawdown metrics.

## Assumptions and limitations

- Standard Monte Carlo holds expected returns, volatility, and correlation constant. HMM Monte Carlo changes them only when its hidden regime changes.
- Returns use Gaussian monthly shocks and lognormal prices. The model does not represent fat tails, within-regime autocorrelation, historical bootstrapping, or parameter-estimation error.
- The bundled current-state probabilities, transition matrix, and timeline are illustrative defaults. They are not live market estimates.
- The MVP supports only stock and bond proxies. It does not include withdrawals, taxes, fees, transaction costs, market-event modes, or dynamic allocation strategies.
- Contributions are non-negative and arrive monthly. The target and charted portfolio paths are nominal; inflation is used only to report the median ending value in today’s dollars.
- “Chance of a loss” means ending below total capital contributed, not necessarily below the initial balance.
- “Expected shortfall” means the average percentage loss versus contributed capital among the lowest 5% of terminal values; it is not a forecast of a specific loss.
- “Target shortfall” is an accumulation-plan failure proxy. Retirement withdrawals and retirement-failure modeling are not included.
- Average recovery time includes completed drawdown episodes; the interface reports separately how many paths remain below a prior peak at the horizon.
- Results depend on user-supplied assumptions and a finite simulated sample. They are educational illustrations, not forecasts, investment recommendations, or financial advice.

## Tests and checks

```bash
npm test
npm run lint
npm run build
```

Run the complete validation sequence:

```bash
npm run check
```

For test watch mode:

```bash
npm run test:watch
```

## Project structure

```text
src/
├── components/              Scenario controls and Canvas visualizations
├── data/
│   └── hmm-model.json       Illustrative HMM training-service payload
├── hooks/                   Worker lifecycle and responsive Canvas sizing
├── lib/
│   ├── defaults.ts          Default scenario and local-storage loading
│   ├── format.ts            Display formatting
│   ├── regimes.ts           Transition editing and regime portfolio moments
│   ├── simulation.ts        Monte Carlo engine and metrics
│   └── simulation.test.ts   Determinism, GBM, percentile, and risk tests
├── types/                   Simulation types
├── workers/                 Simulation Web Worker entry point
├── App.tsx                  Application layout and scenario comparison flow
├── main.tsx                 React entry point
└── styles.css               Responsive visual system
```
