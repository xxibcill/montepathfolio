import type { SimulationResult } from "../types/simulation";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "../lib/format";

interface MetricStripProps {
  result?: SimulationResult | null;
  isRunning?: boolean;
}

interface MetricDefinition {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "caution";
}

function buildMetrics(result: SimulationResult): MetricDefinition[] {
  const { metrics, inputs } = result;

  return [
    {
      label: "Chance of target",
      value: formatPercent(metrics.probabilityOfTarget, 1),
      detail: `Reaches ${formatCompactCurrency(inputs.targetValue)} in ${inputs.horizonYears} yr`,
      tone: "positive",
    },
    {
      label: "Median ending value",
      value: formatCompactCurrency(metrics.medianTerminalValue),
      detail: `Middle outcome: ${formatCurrency(metrics.medianTerminalValue)}`,
    },
    {
      label: "Median in today’s dollars",
      value: formatCompactCurrency(metrics.medianRealValue),
      detail: `${formatPercent(inputs.inflationRate, 1)} annual inflation`,
    },
    {
      label: "Chance of 30% drawdown",
      value: formatPercent(metrics.probabilityOfThirtyPercentDrawdown, 1),
      detail: "Falls 30% from a prior peak",
      tone: "caution",
    },
    {
      label: "Chance of a loss",
      value: formatPercent(metrics.probabilityOfLoss, 1),
      detail: "Ends below total contributions",
      tone: "caution",
    },
  ];
}

const emptyMetrics: MetricDefinition[] = [
  { label: "Chance of target", value: "—", detail: "Awaiting simulation" },
  { label: "Median ending value", value: "—", detail: "Awaiting simulation" },
  {
    label: "Median in today’s dollars",
    value: "—",
    detail: "Awaiting simulation",
  },
  {
    label: "Chance of 30% drawdown",
    value: "—",
    detail: "Awaiting simulation",
  },
  { label: "Chance of a loss", value: "—", detail: "Awaiting simulation" },
];

export function MetricStrip({ result, isRunning = false }: MetricStripProps) {
  const metrics = result ? buildMetrics(result) : emptyMetrics;

  return (
    <section
      className="metric-strip"
      aria-label="Simulation summary"
      aria-busy={isRunning}
    >
      <div className="metric-strip__heading">
        <p className="eyebrow">Outcome snapshot</p>
        <p className="metric-strip__status">
          {isRunning ? "Updating 1,000 paths…" : "Current simulation"}
        </p>
      </div>

      <dl className="metric-strip__list">
        {metrics.map((metric) => (
          <div
            className="metric-strip__item"
            data-tone={metric.tone}
            key={metric.label}
          >
            <dt>{metric.label}</dt>
            <dd className="metric-strip__value">{metric.value}</dd>
            <dd className="metric-strip__detail">{metric.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
