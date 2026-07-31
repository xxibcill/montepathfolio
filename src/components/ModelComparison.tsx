import {
  formatCompactCurrency,
  formatPercent,
} from "../lib/format";
import type {
  SimulationMetrics,
  SimulationModel,
  SimulationResult,
} from "../types/simulation";

interface ModelComparisonProps {
  result: SimulationResult;
}

interface ComparisonRow {
  label: string;
  note: string;
  format: (metrics: SimulationMetrics) => string;
  delta: (
    hmm: SimulationMetrics,
    constant: SimulationMetrics,
  ) => string;
  lowerIsBetter?: boolean;
}

function signedPoints(value: number): string {
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`;
}

function signedCurrency(value: number): string {
  const formatted = formatCompactCurrency(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

function signedMonths(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${Math.round(value)} mo`;
}

const rows: ComparisonRow[] = [
  {
    label: "Chance of target",
    note: "Share of paths reaching the nominal target",
    format: (metrics) => formatPercent(metrics.probabilityOfTarget, 1),
    delta: (hmm, constant) =>
      signedPoints(hmm.probabilityOfTarget - constant.probabilityOfTarget),
  },
  {
    label: "Median ending value",
    note: "Middle ending value across 1,000 paths",
    format: (metrics) => formatCompactCurrency(metrics.medianTerminalValue),
    delta: (hmm, constant) =>
      signedCurrency(hmm.medianTerminalValue - constant.medianTerminalValue),
  },
  {
    label: "Maximum drawdown",
    note: "Median of each path’s deepest peak-to-trough fall",
    format: (metrics) => formatPercent(metrics.medianMaxDrawdown, 1),
    delta: (hmm, constant) =>
      signedPoints(hmm.medianMaxDrawdown - constant.medianMaxDrawdown),
    lowerIsBetter: true,
  },
  {
    label: "Expected shortfall",
    note: "Average loss versus contributions in the worst 5% of endings",
    format: (metrics) => formatPercent(metrics.expectedShortfall, 1),
    delta: (hmm, constant) =>
      signedPoints(hmm.expectedShortfall - constant.expectedShortfall),
    lowerIsBetter: true,
  },
  {
    label: "Recovery time",
    note: "Average completed peak-recovery episode",
    format: (metrics) =>
      metrics.averageRecoveryMonths === null
        ? "—"
        : `${Math.round(metrics.averageRecoveryMonths)} mo`,
    delta: (hmm, constant) =>
      signedMonths(
        hmm.averageRecoveryMonths === null ||
          constant.averageRecoveryMonths === null
          ? null
          : hmm.averageRecoveryMonths - constant.averageRecoveryMonths,
      ),
    lowerIsBetter: true,
  },
  {
    label: "Target shortfall",
    note: "Accumulation-plan failure; retirement withdrawals are not modeled",
    format: (metrics) => formatPercent(1 - metrics.probabilityOfTarget, 1),
    delta: (hmm, constant) =>
      signedPoints(
        (1 - hmm.probabilityOfTarget) -
          (1 - constant.probabilityOfTarget),
      ),
    lowerIsBetter: true,
  },
];

const MODEL_LABELS: Record<SimulationModel, string> = {
  constant: "Standard Monte Carlo",
  hmm: "HMM Monte Carlo",
};

export function ModelComparison({ result }: ModelComparisonProps) {
  const constant = result.comparisonMetrics.constant;
  const hmm = result.comparisonMetrics.hmm;

  return (
    <section className="model-comparison" aria-labelledby="model-comparison-title">
      <div className="model-comparison__heading">
        <div>
          <p className="eyebrow">Same portfolio · same shock streams</p>
          <h2 id="model-comparison-title">What changes when markets have memory?</h2>
        </div>
        <p>
          Standard Monte Carlo holds inputs fixed. HMM Monte Carlo lets
          persistent regimes change returns, volatility, and asset correlation.
        </p>
      </div>

      <div className="model-comparison__scroll">
        <table>
          <caption>
            Comparison of constant-parameter and hidden-Markov-model Monte Carlo
            outcomes
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {(["constant", "hmm"] as const).map((model) => (
                <th
                  scope="col"
                  data-selected={result.inputs.model === model}
                  key={model}
                >
                  {MODEL_LABELS[model]}
                  {result.inputs.model === model ? <small>Selected</small> : null}
                </th>
              ))}
              <th scope="col">HMM effect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const deltaValue = row.delta(hmm, constant);
              return (
                <tr key={row.label}>
                  <th scope="row">
                    {row.label}
                    <small>{row.note}</small>
                  </th>
                  <td>{row.format(constant)}</td>
                  <td>{row.format(hmm)}</td>
                  <td
                    data-direction={
                      deltaValue.startsWith("+")
                        ? row.lowerIsBetter
                          ? "adverse"
                          : "favorable"
                        : deltaValue.startsWith("−")
                          ? row.lowerIsBetter
                            ? "favorable"
                            : "adverse"
                          : "neutral"
                    }
                  >
                    {deltaValue}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
