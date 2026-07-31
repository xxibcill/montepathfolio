import { ArrowDownRight, ArrowUpRight, EqualApproximately } from "lucide-react";
import { formatCompactCurrency } from "../lib/format";
import type { SimulationResult } from "../types/simulation";

type ChangeKey =
  | "initialCapital"
  | "monthlyContribution"
  | "horizonYears"
  | "stockAllocation"
  | "returnAssumptions"
  | "volatilityAssumptions"
  | "correlation"
  | "rebalanceFrequency"
  | "inflationRate"
  | "targetValue";

interface ComparisonNoteProps {
  result: SimulationResult;
  previousResult: SimulationResult | null;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}%`;
}

function signedPoints(value: number): string {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(Math.abs(points) < 10 ? 1 : 0)} pts`;
}

function changedFields(
  previous: SimulationResult,
  current: SimulationResult,
): ChangeKey[] {
  const before = previous.inputs;
  const after = current.inputs;
  const changes: ChangeKey[] = [];

  if (before.initialCapital !== after.initialCapital) {
    changes.push("initialCapital");
  }
  if (before.monthlyContribution !== after.monthlyContribution) {
    changes.push("monthlyContribution");
  }
  if (before.horizonYears !== after.horizonYears) {
    changes.push("horizonYears");
  }
  if (before.stockAllocation !== after.stockAllocation) {
    changes.push("stockAllocation");
  }
  if (
    before.stocks.expectedReturn !== after.stocks.expectedReturn ||
    before.bonds.expectedReturn !== after.bonds.expectedReturn
  ) {
    changes.push("returnAssumptions");
  }
  if (
    before.stocks.volatility !== after.stocks.volatility ||
    before.bonds.volatility !== after.bonds.volatility
  ) {
    changes.push("volatilityAssumptions");
  }
  if (before.correlation !== after.correlation) {
    changes.push("correlation");
  }
  if (before.rebalanceFrequency !== after.rebalanceFrequency) {
    changes.push("rebalanceFrequency");
  }
  if (before.inflationRate !== after.inflationRate) {
    changes.push("inflationRate");
  }
  if (before.targetValue !== after.targetValue) {
    changes.push("targetValue");
  }

  return changes;
}

function primaryChange(
  previous: SimulationResult,
  current: SimulationResult,
  changes: ChangeKey[],
): string {
  const before = previous.inputs;
  const after = current.inputs;

  if (changes.length > 1) return "Changing several assumptions";
  if (changes.length === 0) return "Refreshing this scenario";

  switch (changes[0]) {
    case "initialCapital":
      return `${after.initialCapital > before.initialCapital ? "Increasing" : "Reducing"} starting capital`;
    case "monthlyContribution":
      return after.monthlyContribution > before.monthlyContribution
        ? "Contributing more each month"
        : "Contributing less each month";
    case "horizonYears":
      return `${after.horizonYears > before.horizonYears ? "Extending" : "Shortening"} the horizon to ${after.horizonYears} years`;
    case "stockAllocation":
      return `${after.stockAllocation > before.stockAllocation ? "Increasing" : "Reducing"} stocks from ${Math.round(before.stockAllocation * 100)}% to ${Math.round(after.stockAllocation * 100)}%`;
    case "returnAssumptions":
      return "Changing the return assumptions";
    case "volatilityAssumptions":
      return "Changing the volatility assumptions";
    case "correlation":
      return `${after.correlation < before.correlation ? "Lowering" : "Raising"} stock–bond correlation`;
    case "rebalanceFrequency":
      return "Changing the rebalance schedule";
    case "inflationRate":
      return "Changing the inflation assumption";
    case "targetValue":
      return "Moving the financial target";
  }
}

function reasonForChange(
  previous: SimulationResult,
  current: SimulationResult,
  changes: ChangeKey[],
): string {
  const before = previous.inputs;
  const after = current.inputs;

  if (changes.length !== 1) {
    return "Return, volatility, allocation, contributions, and time interact across all 1,000 paths—not just the median one.";
  }

  switch (changes[0]) {
    case "initialCapital":
      return "Starting capital compounds from day one, so it affects every future path.";
    case "monthlyContribution":
      return "Contributions add capital in every market path, while the cash-flow-neutral drawdown measure stays comparable.";
    case "horizonYears":
      return "A different runway changes both the time available for compounding and the time exposed to uncertainty.";
    case "stockAllocation":
      return after.stockAllocation > before.stockAllocation
        ? "Stocks carry the higher return assumption here, but their wider swings also deepen some drawdowns."
        : "The larger bond cushion narrows shocks, while giving up some of the stock return assumption.";
    case "returnAssumptions":
      return "Return assumptions shift compounding across the full range without changing the sampled shocks.";
    case "volatilityAssumptions":
      return "Volatility widens or narrows the range and changes the depth of adverse paths.";
    case "correlation":
      return after.correlation < before.correlation
        ? "The assets offset one another more often when their shocks are less aligned."
        : "More synchronized asset moves reduce the portfolio’s diversification cushion.";
    case "rebalanceFrequency":
      return "Rebalancing controls how far the portfolio can drift from its selected risk mix.";
    case "inflationRate":
      return "Inflation changes purchasing power, not the nominal paths, so the real-value estimate moves independently.";
    case "targetValue":
      return "The portfolio paths are unchanged; only the hurdle they must clear has moved.";
  }
}

export function ComparisonNote({
  result,
  previousResult,
}: ComparisonNoteProps) {
  if (!previousResult) {
    return (
      <aside className="comparison-note comparison-note--intro">
        <div className="comparison-note__index" aria-hidden="true">
          01
        </div>
        <div>
          <p className="eyebrow">Decision note</p>
          <h2>One forecast is a guess. A range is a decision tool.</h2>
          <p>
            Adjust an assumption to compare this run with the next one. The
            simulator reuses the same random shocks, so the explanation isolates
            your change instead of rewarding a luckier sample.
          </p>
        </div>
      </aside>
    );
  }

  const previousMedian = previousResult.metrics.medianTerminalValue;
  const currentMedian = result.metrics.medianTerminalValue;
  const medianDelta =
    previousMedian > 0 ? currentMedian / previousMedian - 1 : null;
  const medianDirection = currentMedian - previousMedian;
  const drawdownDelta =
    result.metrics.probabilityOfThirtyPercentDrawdown -
    previousResult.metrics.probabilityOfThirtyPercentDrawdown;
  const targetDelta =
    result.metrics.probabilityOfTarget -
    previousResult.metrics.probabilityOfTarget;
  const changes = changedFields(previousResult, result);
  const onlyChange = changes.length === 1 ? changes[0] : null;
  const previousRealMedian = previousResult.metrics.medianRealValue;
  const currentRealMedian = result.metrics.medianRealValue;
  const realMedianDelta =
    previousRealMedian > 0
      ? currentRealMedian / previousRealMedian - 1
      : null;
  const Icon =
    medianDirection > Math.max(1, previousMedian * 0.003)
      ? ArrowUpRight
      : medianDirection < -Math.max(1, previousMedian * 0.003)
        ? ArrowDownRight
        : EqualApproximately;

  return (
    <aside className="comparison-note" aria-live="polite">
      <div className="comparison-note__index" aria-hidden="true">
        <Icon strokeWidth={1.75} />
      </div>
      <div>
        <p className="eyebrow">What changed</p>
        <h2>
          {primaryChange(previousResult, result, changes)}{" "}
          {onlyChange === "targetValue" ? (
            <>
              changed its reach probability{" "}
              <strong>{signedPoints(targetDelta)}</strong>.
            </>
          ) : onlyChange === "inflationRate" ? (
            realMedianDelta === null ? (
              <>
                moved today’s-dollar median from <strong>$0</strong> to{" "}
                <strong>{formatCompactCurrency(currentRealMedian)}</strong>.
              </>
            ) : (
              <>
                moved today’s-dollar median{" "}
                <strong>{signedPercent(realMedianDelta)}</strong>.
              </>
            )
          ) : medianDelta === null ? (
            <>
              moved the median from <strong>$0</strong> to{" "}
              <strong>{formatCompactCurrency(currentMedian)}</strong>.
            </>
          ) : (
            <>
              moved the median <strong>{signedPercent(medianDelta)}</strong>.
            </>
          )}
        </h2>
        <p>
          {onlyChange === "targetValue" ? (
            <>
              The simulated paths and nominal median are unchanged.{" "}
            </>
          ) : onlyChange === "inflationRate" ? (
            <>
              The nominal paths and target likelihood are unchanged.{" "}
            </>
          ) : (
            <>
              Target likelihood changed{" "}
              <strong>{signedPoints(targetDelta)}</strong> and the chance of a
              30% drawdown changed{" "}
              <strong>{signedPoints(drawdownDelta)}</strong>.{" "}
            </>
          )}
          {reasonForChange(previousResult, result, changes)}
        </p>
      </div>
    </aside>
  );
}
