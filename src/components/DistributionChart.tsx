import { useEffect, useMemo, useRef } from "react";
import { useCanvasSize } from "../hooks/useCanvasSize";
import {
  CHART_COLORS as COLORS,
  compactCurrency,
  formatProbability,
  fullCurrency,
  niceCeiling,
} from "../lib/chart";
import type { SimulationResult } from "../types/simulation";

export interface DistributionChartProps {
  result: SimulationResult;
  targetValue?: number;
  className?: string;
}

function quantile(sortedValues: number[], probability: number) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const interpolation = position - lowerIndex;
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;

  return lower + (upper - lower) * interpolation;
}

export function DistributionChart({
  result,
  targetValue,
  className = "",
}: DistributionChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { containerRef, width, height, dpr } = useCanvasSize({
    aspectRatio: 2.15,
    minHeight: 270,
    maxHeight: 380,
  });
  const target = targetValue ?? result.inputs.targetValue;
  const values = useMemo(
    () =>
      result.terminalValues
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right),
    [result.terminalValues],
  );
  const median = values.length
    ? quantile(values, 0.5)
    : result.metrics.medianTerminalValue;

  const summary = useMemo(() => {
    const fifth = quantile(values, 0.05);
    const ninetyFifth = quantile(values, 0.95);

    return `Histogram of ${values.length.toLocaleString()} simulated ending portfolio values. The median is ${fullCurrency.format(median)}. Ninety percent of outcomes fall between ${fullCurrency.format(fifth)} and ${fullCurrency.format(ninetyFifth)}. ${formatProbability(result.metrics.probabilityOfTarget)} reach the ${fullCurrency.format(target)} target, and ${formatProbability(result.metrics.probabilityOfLoss)} finish below the amount contributed.`;
  }, [
    median,
    result.metrics.probabilityOfLoss,
    result.metrics.probabilityOfTarget,
    target,
    values,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = COLORS.paper;
    context.fillRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";

    if (values.length === 0) {
      context.fillStyle = COLORS.mutedInk;
      context.font =
        '500 13px "Instrument Sans Variable", "Avenir Next", sans-serif';
      context.textAlign = "center";
      context.fillText(
        "Run a simulation to reveal the ending-value distribution.",
        width / 2,
        height / 2,
      );
      return;
    }

    const compactLayout = width < 520;
    const margin = {
      top: compactLayout ? 64 : 48,
      right: compactLayout ? 14 : 22,
      bottom: 40,
      left: compactLayout ? 42 : 52,
    };
    const plotLeft = margin.left;
    const plotTop = margin.top;
    const plotRight = width - margin.right;
    const plotBottom = height - margin.bottom;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);

    const percentile99 = quantile(values, 0.99);
    const naturalMaximum = Math.max(percentile99, median * 1.2, 1);
    const targetCanFit = target >= 0 && target <= naturalMaximum * 1.8;
    const xMaximum = niceCeiling(
      Math.max(naturalMaximum, targetCanFit ? target : 0) * 1.025,
      compactLayout ? 3 : 5,
    );
    const targetBeyondScale = target > xMaximum;
    const binLimit = compactLayout ? 18 : 32;
    const binCount = Math.max(
      1,
      Math.min(values.length, binLimit, Math.ceil(Math.sqrt(values.length))),
    );
    const bins = Array.from({ length: binCount }, () => 0);

    for (const value of values) {
      const normalized = Math.max(0, value / xMaximum);
      const binIndex = Math.min(
        binCount - 1,
        Math.floor(normalized * binCount),
      );
      bins[binIndex] += 1;
    }

    const largestBin = Math.max(...bins);
    const yMaximum = niceCeiling(largestBin, compactLayout ? 3 : 4);
    const xForValue = (value: number) =>
      plotLeft + (Math.max(0, value) / xMaximum) * plotWidth;
    const yForCount = (count: number) =>
      plotBottom - (count / yMaximum) * plotHeight;

    // Grid and axes.
    const yTickCount = compactLayout ? 3 : 4;
    context.font =
      '500 11px "Instrument Sans Variable", "Avenir Next", sans-serif';
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= yTickCount; tick += 1) {
      const count = Math.round((yMaximum * tick) / yTickCount);
      const y = yForCount(count);
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.strokeStyle = tick === 0 ? COLORS.mutedInk : COLORS.grid;
      context.lineWidth = tick === 0 ? 1 : 0.75;
      context.stroke();
      context.fillStyle = COLORS.mutedInk;
      context.fillText(count.toLocaleString(), plotLeft - 7, y);
    }

    const xTickCount = compactLayout ? 3 : 5;
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let tick = 0; tick <= xTickCount; tick += 1) {
      const value = (xMaximum * tick) / xTickCount;
      const x = xForValue(value);
      context.fillStyle = COLORS.mutedInk;
      context.fillText(compactCurrency.format(value), x, plotBottom + 10);
    }

    // Bars. Values beyond the 99th-percentile display scale accumulate in the
    // final outlined bar instead of stretching the useful body of the chart.
    const binWidth = plotWidth / binCount;
    const barGap = compactLayout ? 1 : 1.5;
    for (let index = 0; index < bins.length; index += 1) {
      const count = bins[index] ?? 0;
      const x = plotLeft + index * binWidth + barGap / 2;
      const y = yForCount(count);
      const barWidth = Math.max(0.5, binWidth - barGap);
      const barHeight = Math.max(0, plotBottom - y);

      context.fillStyle = COLORS.forestFill;
      context.fillRect(x, y, barWidth, barHeight);
      context.strokeStyle = COLORS.forestOutline;
      context.lineWidth = 0.6;
      context.strokeRect(x, y, barWidth, barHeight);
    }

    const drawVerticalMarker = (
      rawX: number,
      color: string,
      dash: number[],
      triangle: boolean,
    ) => {
      const x = Math.max(plotLeft, Math.min(plotRight, rawX));
      context.beginPath();
      context.moveTo(x, plotTop);
      context.lineTo(x, plotBottom);
      context.setLineDash(dash);
      context.strokeStyle = color;
      context.lineWidth = triangle ? 1.6 : 1.35;
      context.stroke();
      context.setLineDash([]);

      context.beginPath();
      if (triangle) {
        context.moveTo(x - 4, plotTop);
        context.lineTo(x + 4, plotTop);
        context.lineTo(x, plotTop + 7);
        context.closePath();
        context.fillStyle = color;
        context.fill();
      } else {
        context.arc(x, plotTop + 3.5, 3.5, 0, Math.PI * 2);
        context.fillStyle = COLORS.paper;
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.stroke();
      }
    };

    drawVerticalMarker(xForValue(median), COLORS.ink, [], false);
    drawVerticalMarker(
      targetBeyondScale ? plotRight : xForValue(target),
      COLORS.vermilion,
      [7, 5],
      true,
    );

    // Pattern-based legend. It wraps on narrow canvases.
    const legendY = 18;
    const secondLegendY = compactLayout ? 40 : legendY;
    context.font = `600 ${compactLayout ? 10 : 11}px "Instrument Sans Variable", "Avenir Next", sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";

    context.fillStyle = COLORS.forestFill;
    context.fillRect(plotLeft, legendY - 5, 18, 10);
    context.strokeStyle = COLORS.forestOutline;
    context.strokeRect(plotLeft, legendY - 5, 18, 10);
    context.fillStyle = COLORS.ink;
    context.fillText("Outcomes", plotLeft + 24, legendY);

    const medianLegendX = compactLayout ? plotLeft : plotLeft + 112;
    context.beginPath();
    context.moveTo(medianLegendX, secondLegendY);
    context.lineTo(medianLegendX + 20, secondLegendY);
    context.strokeStyle = COLORS.ink;
    context.lineWidth = 1.6;
    context.stroke();
    context.beginPath();
    context.arc(medianLegendX + 10, secondLegendY, 3, 0, Math.PI * 2);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = COLORS.ink;
    context.stroke();
    context.fillStyle = COLORS.ink;
    context.fillText("Median", medianLegendX + 26, secondLegendY);

    const targetLegendX = compactLayout ? plotLeft + 105 : plotLeft + 216;
    context.beginPath();
    context.moveTo(targetLegendX, secondLegendY);
    context.lineTo(targetLegendX + 20, secondLegendY);
    context.setLineDash([6, 4]);
    context.strokeStyle = COLORS.vermilion;
    context.lineWidth = 1.7;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = COLORS.ink;
    context.fillText(
      targetBeyondScale ? "Target →" : "Target",
      targetLegendX + 26,
      secondLegendY,
    );
  }, [dpr, height, median, target, values, width]);

  return (
    <figure
      className={`chart-figure distribution-chart ${className}`.trim()}
    >
      <div
        ref={containerRef}
        className="chart-canvas-shell distribution-chart__canvas-shell"
        style={{ width: "100%" }}
      >
        <canvas
          ref={canvasRef}
          className="chart-canvas distribution-chart__canvas"
          role="img"
          aria-label={summary}
          style={{ display: "block", height, width: "100%" }}
        />
      </div>
      <figcaption className="chart-caption distribution-chart__caption">
        <span className="chart-caption__metric">
          Median {fullCurrency.format(median)} ·{" "}
          {formatProbability(result.metrics.probabilityOfTarget)} reach target
        </span>
        <span className="chart-caption__detail">
          Each bar counts simulations ending in that value range; extreme
          outcomes collect in the final outlined bar.
        </span>
      </figcaption>
    </figure>
  );
}
