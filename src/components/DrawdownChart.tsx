import { useEffect, useMemo, useRef } from "react";
import { useCanvasSize } from "../hooks/useCanvasSize";
import {
  appendSeriesPath,
  CHART_COLORS as COLORS,
  drawBandLegend,
  drawLineLegend,
  fillBand,
  formatProbability,
  strokeSeries,
} from "../lib/chart";
import type { SimulationResult } from "../types/simulation";

export interface DrawdownChartProps {
  result: SimulationResult;
  className?: string;
}

function formatDrawdown(value: number) {
  return `${Math.round(Math.abs(value) * 100)}%`;
}

export function DrawdownChart({
  result,
  className = "",
}: DrawdownChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { containerRef, width, height, dpr } = useCanvasSize({
    aspectRatio: 2.05,
    minHeight: 270,
    maxHeight: 390,
  });

  const summary = useMemo(() => {
    const recovery = result.metrics.averageRecoveryMonths;
    const unresolved =
      result.metrics.probabilityOfUnrecoveredDrawdown;
    const recoveryDescription =
      recovery === null
        ? unresolved > 0
          ? `No completed recovery time is available, and ${formatProbability(unresolved)} of paths finish below a prior peak.`
          : "No drawdown episodes occur in this sample."
        : `Completed drawdown episodes recover in ${Math.round(recovery)} months on average, and ${formatProbability(unresolved)} of paths finish below a prior peak.`;

    return `Cash-flow-neutral drawdown depth through time across the simulations. The median maximum drawdown is ${formatDrawdown(result.metrics.medianMaxDrawdown)}. ${formatProbability(result.metrics.probabilityOfThirtyPercentDrawdown)} of simulations experience a drawdown deeper than 30 percent. ${recoveryDescription}`;
  }, [result.metrics]);

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

    const source = result.drawdownPercentiles;
    const count = Math.min(
      result.months.length,
      source.p05.length,
      source.p10.length,
      source.p50.length,
      source.p90.length,
      source.p95.length,
    );

    if (count < 2) {
      context.fillStyle = COLORS.mutedInk;
      context.font =
        '500 13px "Instrument Sans Variable", "Avenir Next", sans-serif';
      context.textAlign = "center";
      context.fillText(
        "Run a simulation to reveal drawdown risk.",
        width / 2,
        height / 2,
      );
      return;
    }

    // Accept either positive drawdown magnitudes or conventional negative
    // drawdown series. Taking min/max after abs preserves percentile bounds.
    const outerLower = new Array<number>(count);
    const outerUpper = new Array<number>(count);
    const innerLower = new Array<number>(count);
    const innerUpper = new Array<number>(count);
    const median = new Array<number>(count);

    for (let index = 0; index < count; index += 1) {
      const p05 = Math.min(1, Math.abs(source.p05[index] ?? 0));
      const p10 = Math.min(1, Math.abs(source.p10[index] ?? 0));
      const p50 = Math.min(1, Math.abs(source.p50[index] ?? 0));
      const p90 = Math.min(1, Math.abs(source.p90[index] ?? 0));
      const p95 = Math.min(1, Math.abs(source.p95[index] ?? 0));
      outerLower[index] = Math.min(p05, p95);
      outerUpper[index] = Math.max(p05, p95);
      innerLower[index] = Math.min(p10, p90);
      innerUpper[index] = Math.max(p10, p90);
      median[index] = p50;
    }

    const compactLayout = width < 520;
    const margin = {
      top: compactLayout ? 64 : 46,
      right: compactLayout ? 14 : 22,
      bottom: 36,
      left: compactLayout ? 48 : 58,
    };
    const plotLeft = margin.left;
    const plotTop = margin.top;
    const plotRight = width - margin.right;
    const plotBottom = height - margin.bottom;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const largestDrawdown = Math.max(0.3, ...outerUpper);
    const yMaximum = Math.min(1, Math.ceil(largestDrawdown * 10) / 10);
    const xForIndex = (index: number) =>
      plotLeft + (index / (count - 1)) * plotWidth;
    const yForDrawdown = (value: number) =>
      plotTop + (Math.max(0, Math.min(yMaximum, value)) / yMaximum) * plotHeight;

    // Axes put zero at the top so the plotted marks visually fall from peak.
    const yTickCount = Math.max(3, Math.round(yMaximum * 10));
    context.font =
      '500 11px "Instrument Sans Variable", "Avenir Next", sans-serif';
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= yTickCount; tick += 1) {
      const drawdown = (yMaximum * tick) / yTickCount;
      const y = yForDrawdown(drawdown);
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.strokeStyle = tick === 0 ? COLORS.mutedInk : COLORS.grid;
      context.lineWidth = tick === 0 ? 1 : 0.75;
      context.stroke();
      context.fillStyle = COLORS.mutedInk;
      context.fillText(
        tick === 0 ? "0%" : `−${Math.round(drawdown * 100)}%`,
        plotLeft - 7,
        y,
      );
    }

    const xTickCount = compactLayout ? 3 : 5;
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let tick = 0; tick <= xTickCount; tick += 1) {
      const index = Math.round((tick / xTickCount) * (count - 1));
      const month = result.months[index] ?? index;
      const years = month / 12;
      const label =
        tick === 0
          ? "Now"
          : `${Number.isInteger(years) ? years : years.toFixed(1)}y`;
      context.fillStyle = COLORS.mutedInk;
      context.fillText(label, xForIndex(index), plotBottom + 10);
    }

    context.save();
    context.beginPath();
    context.rect(plotLeft, plotTop, plotWidth, plotHeight);
    context.clip();

    const pathLimit = compactLayout ? 90 : 160;
    const pathStep = Math.max(
      1,
      Math.ceil(result.sampleDrawdownPaths.length / pathLimit),
    );
    context.beginPath();
    for (
      let pathIndex = 0;
      pathIndex < result.sampleDrawdownPaths.length;
      pathIndex += pathStep
    ) {
      const path = result.sampleDrawdownPaths[pathIndex];
      if (!path) {
        continue;
      }
      const pathCount = Math.min(count, path.length);
      appendSeriesPath(context, {
        values: path,
        count: pathCount,
        xForIndex,
        yForValue: yForDrawdown,
      });
    }
    context.strokeStyle = COLORS.drawdownPath;
    context.lineWidth = 0.65;
    context.stroke();

    fillBand(context, {
      lower: outerLower,
      upper: outerUpper,
      count,
      xForIndex,
      yForValue: yForDrawdown,
      fillStyle: COLORS.outerBand,
    });
    fillBand(context, {
      lower: innerLower,
      upper: innerUpper,
      count,
      xForIndex,
      yForValue: yForDrawdown,
      fillStyle: COLORS.innerBand,
    });
    strokeSeries(context, {
      values: innerLower,
      count,
      xForIndex,
      yForValue: yForDrawdown,
      color: COLORS.percentileLine,
      width: 0.9,
      dash: [2, 4],
    });
    strokeSeries(context, {
      values: innerUpper,
      count,
      xForIndex,
      yForValue: yForDrawdown,
      color: COLORS.percentileLine,
      width: 0.9,
      dash: [2, 4],
    });
    strokeSeries(context, {
      values: median,
      count,
      xForIndex,
      yForValue: yForDrawdown,
      color: COLORS.forest,
      width: 2.35,
    });

    // Thirty percent is a decision threshold, not another percentile.
    const thresholdY = yForDrawdown(0.3);
    context.beginPath();
    context.moveTo(plotLeft, thresholdY);
    context.lineTo(plotRight, thresholdY);
    context.setLineDash([7, 5]);
    context.strokeStyle = COLORS.vermilion;
    context.lineWidth = 1.45;
    context.stroke();
    context.setLineDash([]);
    context.restore();

    const medianEndX = xForIndex(count - 1);
    const medianEndY = yForDrawdown(median[count - 1] ?? 0);
    context.beginPath();
    context.arc(medianEndX, medianEndY, 3.2, 0, Math.PI * 2);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = COLORS.forest;
    context.lineWidth = 2;
    context.stroke();

    // Legend repeats every encoding in a compact, wrapping layout.
    const legendY = 18;
    const secondLegendY = compactLayout ? 39 : legendY;
    context.font = `600 ${compactLayout ? 10 : 11}px "Instrument Sans Variable", "Avenir Next", sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";

    if (compactLayout) {
      drawBandLegend(context, {
        x: plotLeft,
        y: legendY,
        fill: COLORS.outerBand,
        label: "5–95%",
      });
      drawBandLegend(context, {
        x: plotLeft + 95,
        y: legendY,
        fill: COLORS.innerBand,
        label: "10–90%",
      });
      drawLineLegend(context, {
        x: plotLeft,
        y: secondLegendY,
        color: COLORS.forest,
        label: "Median",
      });
      drawLineLegend(context, {
        x: plotLeft + 95,
        y: secondLegendY,
        color: COLORS.vermilion,
        label: "30% line",
        dash: [6, 4],
      });
    } else {
      drawBandLegend(context, {
        x: plotLeft,
        y: legendY,
        fill: COLORS.outerBand,
        label: "5–95%",
      });
      drawBandLegend(context, {
        x: plotLeft + 100,
        y: legendY,
        fill: COLORS.innerBand,
        label: "10–90%",
      });
      drawLineLegend(context, {
        x: plotLeft + 208,
        y: legendY,
        color: COLORS.forest,
        label: "Median",
      });
      drawLineLegend(context, {
        x: plotLeft + 305,
        y: legendY,
        color: COLORS.vermilion,
        label: "30% line",
        dash: [6, 4],
      });
    }
  }, [dpr, height, result, width]);

  const recovery = result.metrics.averageRecoveryMonths;
  const unresolved = result.metrics.probabilityOfUnrecoveredDrawdown;
  const recoveryCaption =
    recovery === null
      ? unresolved > 0
        ? "no completed recoveries"
        : "no drawdown episodes"
      : `${Math.round(recovery)} months per completed recovery`;

  return (
    <figure className={`chart-figure drawdown-chart ${className}`.trim()}>
      <div
        ref={containerRef}
        className="chart-canvas-shell drawdown-chart__canvas-shell"
        style={{ width: "100%" }}
      >
        <canvas
          ref={canvasRef}
          className="chart-canvas drawdown-chart__canvas"
          role="img"
          aria-label={summary}
          style={{ display: "block", height, width: "100%" }}
        />
      </div>
      <figcaption className="chart-caption drawdown-chart__caption">
        <span className="chart-caption__metric">
          Median maximum drawdown{" "}
          {formatDrawdown(result.metrics.medianMaxDrawdown)}
        </span>
        <span className="chart-caption__detail">
          {formatProbability(
            result.metrics.probabilityOfThirtyPercentDrawdown,
          )}{" "}
          cross 30% · {recoveryCaption} · {formatProbability(unresolved)} end
          underwater
        </span>
      </figcaption>
    </figure>
  );
}
