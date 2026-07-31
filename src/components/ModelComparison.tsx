import {
  formatCompactCurrency,
  formatPercent,
} from "../lib/format";
import { comparisonDirection } from "../lib/model-comparison";
import type {
  PortfolioProjectionResult,
  ProjectionMetrics,
} from "../labs/portfolio-projection-model";
import type { PortfolioProjectionModel } from "../types/portfolio-projection";

interface ModelComparisonProps {
  result: PortfolioProjectionResult;
}

interface ComparisonRow {
  label: string;
  note: string;
  format: (metrics: ProjectionMetrics) => string;
  delta: (
    hmm: ProjectionMetrics,
    constant: ProjectionMetrics,
  ) => number | null;
  formatDelta: (value: number | null) => string;
  lowerIsBetter?: boolean;
}

function signedPoints(value: number): string {
  const points = value * 100;
  const roundedPoints = Number(points.toFixed(1));
  const sign = roundedPoints > 0 ? "+" : roundedPoints < 0 ? "−" : "";
  return `${sign}${Math.abs(roundedPoints).toFixed(1)} pts`;
}

function signedCurrency(value: number): string {
  const formatted = formatCompactCurrency(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

function signedMonths(value: number | null): string {
  if (value === null) return "—";
  const roundedMonths = Math.round(value);
  const sign = roundedMonths > 0 ? "+" : roundedMonths < 0 ? "−" : "";
  return `${sign}${Math.abs(roundedMonths)} mo`;
}

const rows: ComparisonRow[] = [
  {
    label: "Chance of target",
    note: "Share of paths reaching the nominal target",
    format: (metrics) => formatPercent(metrics.probabilityOfTarget, 1),
    delta: (hmm, constant) =>
      hmm.probabilityOfTarget - constant.probabilityOfTarget,
    formatDelta: (value) => signedPoints(value ?? 0),
  },
  {
    label: "Median ending value",
    note: "Middle ending value across 1,000 paths",
    format: (metrics) => formatCompactCurrency(metrics.medianTerminalValue),
    delta: (hmm, constant) =>
      hmm.medianTerminalValue - constant.medianTerminalValue,
    formatDelta: (value) => signedCurrency(value ?? 0),
  },
  {
    label: "Maximum drawdown",
    note: "Median of each path’s deepest peak-to-trough fall",
    format: (metrics) => formatPercent(metrics.medianMaxDrawdown, 1),
    delta: (hmm, constant) =>
      hmm.medianMaxDrawdown - constant.medianMaxDrawdown,
    formatDelta: (value) => signedPoints(value ?? 0),
    lowerIsBetter: true,
  },
  {
    label: "Tail capital shortfall",
    note: "Average loss versus contributions in the worst 5% of endings",
    format: (metrics) => formatPercent(metrics.tailCapitalShortfall, 1),
    delta: (hmm, constant) =>
      hmm.tailCapitalShortfall - constant.tailCapitalShortfall,
    formatDelta: (value) => signedPoints(value ?? 0),
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
      hmm.averageRecoveryMonths === null ||
      constant.averageRecoveryMonths === null
        ? null
        : hmm.averageRecoveryMonths - constant.averageRecoveryMonths,
    formatDelta: signedMonths,
    lowerIsBetter: true,
  },
  {
    label: "Target shortfall",
    note: "Average percentage gap among paths that finish below the target",
    format: (metrics) => formatPercent(metrics.averageTargetShortfall, 1),
    delta: (hmm, constant) =>
      hmm.averageTargetShortfall - constant.averageTargetShortfall,
    formatDelta: (value) => signedPoints(value ?? 0),
    lowerIsBetter: true,
  },
];

const MODEL_LABELS: Record<PortfolioProjectionModel, string> = {
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
                    data-direction={comparisonDirection(
                      deltaValue,
                      row.lowerIsBetter,
                    )}
                  >
                    {row.formatDelta(deltaValue)}
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
