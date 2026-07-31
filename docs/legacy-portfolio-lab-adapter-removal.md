# Migration record: legacy portfolio-lab adapter

Status: production migration complete — deprecated test-only files quarantined

Introduced by: PR #5

Target: Release 0 portfolio-lab migration

## Removal trigger

The production trigger has fired: the accumulation route now uses
`PortfolioLabRunner`, and the UI no longer depends on legacy `SimulationInputs`
or `SimulationResult` records. The old `src/lib/simulation.ts` file and its tests
remain quarantined only to preserve pre-existing local edits; they have no
production caller and are not bundled into the application path.

## Current implementation audit — 2026-07-31

The native seam is implemented:

- [`contracts.ts`](../src/lib/portfolio-lab/contracts.ts) defines versioned GBM
  and HMM cases, grouped results, tagged diagnostics, provenance, warnings, and
  structured problems.
- [`in-process-runner.ts`](../src/lib/portfolio-lab/in-process-runner.ts) is the
  test and benchmark adapter.
- [`worker-runner.ts`](../src/lib/portfolio-lab/worker-runner.ts) and
  [`portfolio-lab.worker.ts`](../src/workers/portfolio-lab.worker.ts) implement
  the structured-clone-safe Web Worker runner and cancellation protocol.
- Native seam tests cover case order, case addition, deterministic execution,
  validation, cancellation, and resource limits.

The removal trigger has fired. The accumulation route renders
[`PortfolioProjectionLab.tsx`](../src/labs/PortfolioProjectionLab.tsx), whose
[`useSimulation.ts`](../src/hooks/useSimulation.ts) hook constructs explicit GBM
and HMM request@1 cases through
[`portfolio-projection-model.ts`](../src/labs/portfolio-projection-model.ts) and
executes them through the native worker runner. The dead
`simulation.worker.ts` was removed.

The route, controls, defaults, comparison copy, and chart selectors use the
learner-facing [`PortfolioProjectionInputs`](../src/types/portfolio-projection.ts)
and native result-derived presentation model. The field names in the persisted
scenario remain compatible, so existing local scenarios retain the “Standard
Monte Carlo” label and `tailCapitalShortfall` terminology.

The 30 advanced chapter routes use their own lesson-worker protocol and do not
widen or add callers to the accumulation compatibility types. Their existence
does not count as migration of the original accumulation route.

Likewise, native [`portfolio-lab/request@2`](../src/lib/portfolio-lab/advanced-contracts.ts)
adds jump, GARCH, composite, generalized accounting, and standard VaR/CVaR
without changing request@1. That is the intended versioning boundary; neither
native request version widens the quarantined compatibility types.

## Completion checklist

- [x] A browser Web Worker adapter implements `PortfolioLabRunner`.
- [x] The in-process runner uses the native portfolio-lab engine.
- [x] Native market cases use versioned semantic random streams.
- [x] Case-order, case-addition, cancellation, validation, and resource-limit
  behavior is tested at the native seam without the compatibility adapter.
- [x] The accumulation UI constructs `PortfolioLabRequest` values and consumes
  `PortfolioLabResult` values directly.
- [x] Persisted accumulation scenarios have been migrated without losing the
  user-facing “Standard Monte Carlo” label or the `tailCapitalShortfall`
  terminology.
- [x] The original charts have native selectors/adapters for discriminated GBM
  and HMM diagnostics rather than legacy common nullable fields.
- [x] `useSimulation.ts` no longer calls `runSimulation`, and the legacy
  `simulation.worker.ts` is deleted.
- [x] No production module imports `runSimulation`, `SimulationInputs`, or
  `SimulationResult`; focused tests cover the native request and stale-run path.
- [ ] Delete the quarantined adapter, types, and conversion-only tests only after
  their pre-existing local edits have been intentionally reviewed or archived.

## Quarantine guardrail

Do not add jump diffusion, GARCH, retirement, derivatives, or any other new
model to `SimulationInputs` or `SimulationResult`. New work belongs in a native,
versioned workflow contract. The quarantined adapter receives no production
callers and must not become the next universal model interface.
