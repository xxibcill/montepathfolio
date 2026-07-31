# Removal ticket: legacy portfolio-lab adapter

Status: open

Introduced by: PR #5

Target: Release 0 portfolio-lab migration

## Removal trigger

Remove `src/lib/portfolio-lab/legacy-runner.ts` after both runner adapters execute
the native portfolio-lab engine and the UI no longer depends on legacy
`SimulationInputs` or `SimulationResult` records.

## Completion checklist

- The production Web Worker implements `PortfolioLabRunner`.
- The in-process runner uses the native portfolio-lab engine.
- Semantic random streams replace the legacy path streams.
- The UI consumes portfolio-lab request and result contracts directly.
- Case-order, case-addition, cancellation, validation, and resource-limit tests
  pass without the compatibility adapter.
- The adapter, its legacy conversion tests, and this ticket are deleted.
