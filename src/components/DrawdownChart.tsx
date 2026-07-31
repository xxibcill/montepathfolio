import { useEffect, useMemo, useRef } from "react";
import type { SimulationResult } from "../types/simulation";
import { useCanvasSize } from "../hooks/useCanvasSize";

export interface DrawdownChartProps {
  result: SimulationResult;
  className?: string;
}

const COLORS = {
  paper: "#fbf7ef",
  ink: "#29332d",
  mutedInk: "#68736b",
  grid: "#ded9ce",
  forest: "#376c4d",
  path: "rgba(45, 67, 54, 0.075)",
  outerBand: "rgba(55, 108, 77, 0.11)",
  innerBand: "rgba(55, 108, 77, 0.22)",
  vermilion: "#a94734",
};

function formatProbability(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatDrawdown(value: number) {
  return `${Math.round(Math.abs(value) * 100)}%`;
}

function drawSeries(
  context: CanvasRenderingContext2D,
  values: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForDrawdown: (value: number) => number,
) {
  if (count === 0) {
    return;
  }

  context.moveTo(xForIndex(0), yForDrawdown(values[0] ?? 0));
  for (let index = 1; index < count; index += 1) {
    context.lineTo(
      xForIndex(index),
      yForDrawdown(values[index] ?? 0),
    );
  }
}

function strokeSeries(
  context: CanvasRenderingContext2D,
  values: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForDrawdown: (value: number) => number,
  color: string,
  width: number,
  dash: number[] = [],
) {
  context.beginPath();
  drawSeries(context, values, count, xForIndex, yForDrawdown);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
}

function fillBand(
  context: CanvasRenderingContext2D,
  lower: number[],
  upper: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForDrawdown: (value: number) => number,
  fillStyle: string,
) {
  if (count === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(xForIndex(0), yForDrawdown(lower[0] ?? 0));
  for (let index = 1; index < count; index += 1) {
    context.lineTo(
      xForIndex(index),
      yForDrawdown(lower[index] ?? 0),
    );
  }

  for (let index = count - 1; index >= 0; index -= 1) {
    context.lineTo(
      xForIndex(index),
      yForDrawdown(upper[index] ?? 0),
    );
  }

  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
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
      drawSeries(context, path, pathCount, xForIndex, yForDrawdown);
    }
    context.strokeStyle = COLORS.path;
    context.lineWidth = 0.65;
    context.stroke();

    fillBand(
      context,
      outerLower,
      outerUpper,
      count,
      xForIndex,
      yForDrawdown,
      COLORS.outerBand,
    );
    fillBand(
      context,
      innerLower,
      innerUpper,
      count,
      xForIndex,
      yForDrawdown,
      COLORS.innerBand,
    );
    strokeSeries(
      context,
      innerLower,
      count,
      xForIndex,
      yForDrawdown,
      "rgba(41, 51, 45, 0.48)",
      0.9,
      [2, 4],
    );
    strokeSeries(
      context,
      innerUpper,
      count,
      xForIndex,
      yForDrawdown,
      "rgba(41, 51, 45, 0.48)",
      0.9,
      [2, 4],
    );
    strokeSeries(
      context,
      median,
      count,
      xForIndex,
      yForDrawdown,
      COLORS.forest,
      2.35,
    );

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

    const drawBandLegend = (
      x: number,
      y: number,
      fill: string,
      label: string,
    ) => {
      context.fillStyle = fill;
      context.fillRect(x, y - 5, 18, 10);
      context.strokeStyle = "rgba(41, 51, 45, 0.42)";
      context.lineWidth = 0.8;
      context.strokeRect(x, y - 5, 18, 10);
      context.fillStyle = COLORS.ink;
      context.fillText(label, x + 24, y);
    };
    const drawLineLegend = (
      x: number,
      y: number,
      color: string,
      label: string,
      dash: number[] = [],
    ) => {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 20, y);
      context.setLineDash(dash);
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = COLORS.ink;
      context.fillText(label, x + 26, y);
    };

    if (compactLayout) {
      drawBandLegend(plotLeft, legendY, COLORS.outerBand, "5–95%");
      drawBandLegend(plotLeft + 95, legendY, COLORS.innerBand, "10–90%");
      drawLineLegend(plotLeft, secondLegendY, COLORS.forest, "Median");
      drawLineLegend(
        plotLeft + 95,
        secondLegendY,
        COLORS.vermilion,
        "30% line",
        [6, 4],
      );
    } else {
      drawBandLegend(plotLeft, legendY, COLORS.outerBand, "5–95%");
      drawBandLegend(plotLeft + 100, legendY, COLORS.innerBand, "10–90%");
      drawLineLegend(plotLeft + 208, legendY, COLORS.forest, "Median");
      drawLineLegend(
        plotLeft + 305,
        legendY,
        COLORS.vermilion,
        "30% line",
        [6, 4],
      );
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
