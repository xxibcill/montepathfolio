import { ArrowDownRight, ArrowUpRight, EqualApproximately } from "lucide-react";
import {
  changedFields,
  primaryChange,
  reasonForChange,
} from "../lib/comparison";
import { formatCompactCurrency } from "../lib/format";
import type { PortfolioProjectionResult } from "../labs/portfolio-projection-model";

interface ComparisonNoteProps {
  result: PortfolioProjectionResult;
  previousResult: PortfolioProjectionResult | null;
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
  const changes = changedFields(previousResult.inputs, result.inputs);
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
          {primaryChange(previousResult.inputs, result.inputs, changes)}{" "}
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
          {reasonForChange(previousResult.inputs, result.inputs, changes)}
        </p>
      </div>
    </aside>
  );
}
