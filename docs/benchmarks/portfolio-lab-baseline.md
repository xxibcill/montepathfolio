# Portfolio Lab baseline browser benchmark

This benchmark records the roadmap's current default portfolio workload. It is
descriptive evidence, not a performance guarantee or a test threshold.

## Reproduce it

```bash
npm run benchmark:portfolio
```

The command starts a temporary local Vite server and a fresh headless Chrome
profile. Set `PORTFOLIO_BENCHMARK_BROWSER` to a Chrome or Chromium executable
when it is not installed in a standard location.

The timed boundary begins immediately before creating the production Web Worker
and ends when the structured portfolio result reaches the browser page. It
includes validation, worker startup, two-case simulation, analytics, and result
transfer. Vite startup and chart rendering are outside the boundary.

Scenario:

- 1,000 paths per case, 25 years, 300 monthly steps
- both GBM and three-state HMM cases (600,000 total path-steps)
- seeded default assumptions (`8291`), 70/30 stocks/bonds, annual rebalancing
- one untimed warm-up followed by three measured runs

## Recorded run — 2026-07-31

| Sample | Duration |
| --- | ---: |
| 1 | 792.4 ms |
| 2 | 743.8 ms |
| 3 | 739.1 ms |
| **Median** | **743.8 ms** |

Environment:

- source: working tree based on commit `09222247fcff` (roadmap implementation
  changes were not yet committed)
- machine: Apple M5 Pro, 24 GiB physical memory, 15 logical processors
- OS: Darwin 25.5.0 arm64
- browser: Headless Google Chrome 150.0.7871.188
- harness runtime: Node.js 22.23.1, npm 10.9.8

On this machine, the measured worker round-trip was below one second in all
three samples. This should not be generalized to other devices: CPU power,
browser version, thermal state, and background activity all affect the result.
The harness intentionally fails only when execution itself fails or times out;
it does not enforce a latency target.
