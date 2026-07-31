# Portfolio Risk Sandbox

Portfolio Risk Sandbox is an interactive Monte Carlo planning tool for exploring how a stock-and-bond portfolio might evolve over time. Change the portfolio assumptions and the app recalculates 1,000 monthly paths in a Web Worker, then shows the range of outcomes and explains how the latest scenario differs from the previous one.

This project describes uncertainty; it does not predict markets.

## MVP features

- Configure initial capital, monthly contributions, investment horizon, financial target, inflation, and stock/bond allocation.
- Set annual expected return and volatility for stocks and bonds.
- Edit stock–bond correlation and choose monthly, annual, or no rebalancing.
- Inspect a Canvas-rendered path chart with sampled paths, a median, 10th–90th and 5th–95th percentile bands, and the target.
- Explore a terminal-value histogram and drawdown chart.
- Review target probability, median ending value, inflation-adjusted median value, probability of ending below total contributions, median maximum drawdown, probability of a drawdown over 30%, and average recovery time.
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

Each asset follows geometric Brownian motion at monthly intervals:

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

Every UI run uses 1,000 paths, each with its own deterministic seeded shock stream. Corresponding paths keep the same shock prefix when the horizon changes, which makes before-and-after scenario comparisons easier to interpret. The charts calculate monthly 5th, 10th, 50th, 90th, and 95th percentiles; up to 160 representative paths are retained for rendering.

Drawdown is measured on a parallel cash-flow-neutral portfolio index using the same asset shocks, allocation, and rebalancing schedule. Monthly deposits therefore increase the wealth paths without masking investment losses in the drawdown metrics.

## Assumptions and limitations

- Expected returns, volatility, correlation, and inflation remain constant for the full horizon.
- Returns use independent Gaussian monthly shocks and lognormal prices. The model does not represent fat tails, autocorrelation, changing market regimes, or historical bootstrapping.
- The MVP supports only stock and bond proxies. It does not include withdrawals, taxes, fees, transaction costs, market-event modes, or dynamic allocation strategies.
- Contributions are non-negative and arrive monthly. The target and charted portfolio paths are nominal; inflation is used only to report the median ending value in today’s dollars.
- “Chance of a loss” means ending below total capital contributed, not necessarily below the initial balance.
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
├── hooks/                   Worker lifecycle and responsive Canvas sizing
├── lib/
│   ├── defaults.ts          Default scenario and local-storage loading
│   ├── format.ts            Display formatting
│   ├── simulation.ts        Monte Carlo engine and metrics
│   └── simulation.test.ts   Determinism, GBM, percentile, and risk tests
├── types/                   Simulation types
├── workers/                 Simulation Web Worker entry point
├── App.tsx                  Application layout and scenario comparison flow
├── main.tsx                 React entry point
└── styles.css               Responsive visual system
```
