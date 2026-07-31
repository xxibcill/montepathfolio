# Release 1 model-vertical browser benchmark

This benchmark records the roadmap's jump-diffusion, GARCH, and mean–variance
teaching workloads at the same Web Worker boundary used by their learner
chapters. It is reproducible evidence for the Release 1 performance gate, not a
claim that other machines will produce identical timings.

## Reproduce it

```bash
npm run benchmark:release1
```

For each model, the command starts a fresh lesson worker, validates its
versioned request, performs the calculation, and waits for the structured result
to return. Rendering and Vite startup are outside the timed boundary. Each model
receives one warm-up and three measured runs.

The classroom-interaction budget is 2,500 ms per fresh-worker round trip. The
harness reports failure when any measured maximum exceeds that deliberately
generous budget; the budget is a product responsiveness guardrail, not a
numerical-accuracy criterion.

## Recorded run — 2026-07-31

| Vertical and workload | Samples | Median | Maximum | Budget |
| --- | --- | ---: | ---: | ---: |
| Merton jump diffusion — paired 2,000-path jump/GBM cases × 120 monthly steps | 174.6, 176.4, 175.2 ms | 175.2 ms | 176.4 ms | 2,500 ms |
| GARCH(1,1) — 240-observation fit plus paired 40-path × 120-step forecasts | 24.9, 22.6, 23.2 ms | 23.2 ms | 24.9 ms | 2,500 ms |
| Mean–variance — two assets and 21 efficient-frontier points | 12.7, 13.0, 12.2 ms | 12.7 ms | 13.0 ms | 2,500 ms |

Environment:

- source: working tree based on commit `09222247fcff` with the roadmap changes
  uncommitted
- machine: Apple M5 Pro, 15 logical processors
- browser: Headless Google Chrome 150.0.0.0
- browser-reported device memory: 16 GiB
- timing boundary: worker creation through validated structured result receipt

All three recorded maxima met the interaction budget. Worker startup, browser
version, CPU, thermal state, and background work affect these measurements, so
the samples should be compared only with runs of the same documented harness.
