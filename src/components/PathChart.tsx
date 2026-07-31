import { useEffect, useMemo, useRef } from "react";
import type { SimulationResult } from "../types/simulation";
import { useCanvasSize } from "../hooks/useCanvasSize";

type ValueMode = "nominal" | "real";

export interface PathChartProps {
  result: SimulationResult;
  targetValue?: number;
  valueMode?: ValueMode;
  className?: string;
}

const COLORS = {
  paper: "#fbf7ef",
  ink: "#29332d",
  mutedInk: "#68736b",
  grid: "#ded9ce",
  forest: "#376c4d",
  path: "rgba(45, 67, 54, 0.085)",
  outerBand: "rgba(55, 108, 77, 0.11)",
  innerBand: "rgba(55, 108, 77, 0.22)",
  vermilion: "#a94734",
};

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function niceCeiling(value: number, tickCount = 4) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const roughStep = value / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceFactor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceFactor * magnitude;

  return Math.ceil(value / step) * step;
}

function formatProbability(value: number) {
  const probability = Math.max(0, Math.min(1, value));
  return `${Math.round(probability * 100)}%`;
}

function drawSeries(
  context: CanvasRenderingContext2D,
  values: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForValue: (value: number, index: number) => number,
) {
  if (count === 0) {
    return;
  }

  context.moveTo(xForIndex(0), yForValue(values[0] ?? 0, 0));
  for (let index = 1; index < count; index += 1) {
    context.lineTo(
      xForIndex(index),
      yForValue(values[index] ?? 0, index),
    );
  }
}

function fillBand(
  context: CanvasRenderingContext2D,
  lower: number[],
  upper: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForValue: (value: number, index: number) => number,
  fillStyle: string,
) {
  if (count === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(xForIndex(0), yForValue(upper[0] ?? 0, 0));

  for (let index = 1; index < count; index += 1) {
    context.lineTo(
      xForIndex(index),
      yForValue(upper[index] ?? 0, index),
    );
  }

  for (let index = count - 1; index >= 0; index -= 1) {
    context.lineTo(
      xForIndex(index),
      yForValue(lower[index] ?? 0, index),
    );
  }

  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
}

function strokeSeries(
  context: CanvasRenderingContext2D,
  values: number[],
  count: number,
  xForIndex: (index: number) => number,
  yForValue: (value: number, index: number) => number,
  color: string,
  width: number,
  dash: number[] = [],
) {
  context.beginPath();
  drawSeries(context, values, count, xForIndex, yForValue);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
}

export function PathChart({
  result,
  targetValue,
  valueMode = "nominal",
  className = "",
}: PathChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { containerRef, width, height, dpr } = useCanvasSize({
    aspectRatio: 1.95,
    minHeight: 280,
    maxHeight: 440,
  });
  const target = targetValue ?? result.inputs.targetValue;

  const summary = useMemo(() => {
    const finalIndex = Math.max(0, result.pathPercentiles.p50.length - 1);
    const years = result.inputs.horizonYears;
    const inflationDivisor =
      valueMode === "real"
        ? (1 + result.inputs.inflationRate) ** years
        : 1;
    const median =
      (result.pathPercentiles.p50[finalIndex] ?? 0) / inflationDivisor;
    const lower =
      (result.pathPercentiles.p05[finalIndex] ?? 0) / inflationDivisor;
    const upper =
      (result.pathPercentiles.p95[finalIndex] ?? 0) / inflationDivisor;
    const simulationCount =
      result.terminalValues.length || result.inputs.pathCount;

    return `${simulationCount.toLocaleString()} simulated portfolio paths over ${years} years. The median ending value is ${fullCurrency.format(median)}${valueMode === "real" ? " in today's dollars" : ""}. Ninety percent of outcomes finish between ${fullCurrency.format(lower)} and ${fullCurrency.format(upper)}. ${formatProbability(result.metrics.probabilityOfTarget)} reach the ${fullCurrency.format(target)} target.`;
  }, [result, target, valueMode]);

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

    const series = result.pathPercentiles;
    const count = Math.min(
      result.months.length,
      series.p05.length,
      series.p10.length,
      series.p50.length,
      series.p90.length,
      series.p95.length,
    );

    if (count < 2) {
      context.fillStyle = COLORS.mutedInk;
      context.font =
        '500 13px "Instrument Sans Variable", "Avenir Next", sans-serif';
      context.textAlign = "center";
      context.fillText(
        "Run a simulation to reveal the range of outcomes.",
        width / 2,
        height / 2,
      );
      return;
    }

    const compactLayout = width < 520;
    const margin = {
      top: compactLayout ? 64 : 46,
      right: compactLayout ? 14 : 22,
      bottom: 36,
      left: compactLayout ? 50 : 64,
    };
    const plotLeft = margin.left;
    const plotTop = margin.top;
    const plotRight = width - margin.right;
    const plotBottom = height - margin.bottom;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const inflationRate = Math.max(-0.99, result.inputs.inflationRate);
    const adjustValue = (value: number, index: number) => {
      if (valueMode === "nominal") {
        return value;
      }

      const month = result.months[index] ?? index;
      return value / (1 + inflationRate) ** (month / 12);
    };

    let observedMaximum = 0;
    for (let index = 0; index < count; index += 1) {
      observedMaximum = Math.max(
        observedMaximum,
        adjustValue(series.p95[index] ?? 0, index),
      );
    }
    const targetCanFit =
      Number.isFinite(target) &&
      target >= 0 &&
      target <= Math.max(1, observedMaximum) * 1.8;
    const yMaximum = niceCeiling(
      Math.max(observedMaximum, targetCanFit ? target : 0, 1) * 1.04,
    );
    const targetBeyondScale = target > yMaximum;
    const xForIndex = (index: number) =>
      plotLeft + (index / (count - 1)) * plotWidth;
    const yForValue = (value: number, index: number) =>
      plotBottom -
      (Math.max(0, adjustValue(value, index)) / yMaximum) * plotHeight;

    // Axes and grid.
    const yTickCount = compactLayout ? 3 : 4;
    context.font =
      '500 11px "Instrument Sans Variable", "Avenir Next", sans-serif';
    context.textBaseline = "middle";
    context.textAlign = "right";
    for (let tick = 0; tick <= yTickCount; tick += 1) {
      const value = (yMaximum * tick) / yTickCount;
      const y = plotBottom - (tick / yTickCount) * plotHeight;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.strokeStyle = tick === 0 ? COLORS.mutedInk : COLORS.grid;
      context.lineWidth = tick === 0 ? 1 : 0.75;
      context.stroke();
      context.fillStyle = COLORS.mutedInk;
      context.fillText(compactCurrency.format(value), plotLeft - 8, y);
    }

    const xTickCount = compactLayout ? 3 : 5;
    context.textBaseline = "top";
    context.textAlign = "center";
    for (let tick = 0; tick <= xTickCount; tick += 1) {
      const index = Math.round((tick / xTickCount) * (count - 1));
      const x = xForIndex(index);
      const month = result.months[index] ?? index;
      const years = month / 12;
      const label =
        tick === 0
          ? "Now"
          : `${Number.isInteger(years) ? years : years.toFixed(1)}y`;
      context.fillStyle = COLORS.mutedInk;
      context.fillText(label, x, plotBottom + 10);
    }

    context.save();
    context.beginPath();
    context.rect(plotLeft, plotTop, plotWidth, plotHeight);
    context.clip();

    // Individual paths give a sense of density; percentile bands remain primary.
    const pathLimit = compactLayout ? 140 : 260;
    const pathStep = Math.max(
      1,
      Math.ceil(result.samplePaths.length / pathLimit),
    );
    context.beginPath();
    for (
      let pathIndex = 0;
      pathIndex < result.samplePaths.length;
      pathIndex += pathStep
    ) {
      const path = result.samplePaths[pathIndex];
      if (!path) {
        continue;
      }
      const pathCount = Math.min(count, path.length);
      drawSeries(context, path, pathCount, xForIndex, yForValue);
    }
    context.strokeStyle = COLORS.path;
    context.lineWidth = 0.65;
    context.stroke();

    fillBand(
      context,
      series.p05,
      series.p95,
      count,
      xForIndex,
      yForValue,
      COLORS.outerBand,
    );
    fillBand(
      context,
      series.p10,
      series.p90,
      count,
      xForIndex,
      yForValue,
      COLORS.innerBand,
    );

    // Dotted decile boundaries remain identifiable in monochrome.
    strokeSeries(
      context,
      series.p10,
      count,
      xForIndex,
      yForValue,
      "rgba(41, 51, 45, 0.48)",
      0.9,
      [2, 4],
    );
    strokeSeries(
      context,
      series.p90,
      count,
      xForIndex,
      yForValue,
      "rgba(41, 51, 45, 0.48)",
      0.9,
      [2, 4],
    );
    strokeSeries(
      context,
      series.p50,
      count,
      xForIndex,
      yForValue,
      COLORS.forest,
      2.4,
    );

    if (Number.isFinite(target) && target >= 0) {
      const targetY = targetBeyondScale
        ? plotTop
        : Math.max(
            plotTop,
            Math.min(plotBottom, plotBottom - (target / yMaximum) * plotHeight),
          );
      context.beginPath();
      context.moveTo(plotLeft, targetY);
      context.lineTo(plotRight, targetY);
      context.setLineDash([7, 5]);
      context.strokeStyle = COLORS.vermilion;
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }

    context.restore();

    // End-point marker and target annotation make the line encodings explicit.
    const medianEndX = xForIndex(count - 1);
    const medianEndY = yForValue(series.p50[count - 1] ?? 0, count - 1);
    context.beginPath();
    context.arc(medianEndX, medianEndY, 3.2, 0, Math.PI * 2);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = COLORS.forest;
    context.lineWidth = 2;
    context.stroke();

    if (Number.isFinite(target) && target >= 0) {
      const rawTargetY = targetBeyondScale
        ? plotTop
        : plotBottom - (target / yMaximum) * plotHeight;
      const targetY = Math.max(plotTop + 10, Math.min(plotBottom - 8, rawTargetY));
      const targetLabel = `Target ${compactCurrency.format(target)}${targetBeyondScale ? " ↑" : ""}`;
      context.font =
        '650 10px "Instrument Sans Variable", "Avenir Next", sans-serif';
      const labelWidth = context.measureText(targetLabel).width + 10;
      const labelX = plotRight - labelWidth;
      const labelY = rawTargetY <= plotTop + 12 ? targetY + 4 : targetY - 17;
      context.fillStyle = COLORS.paper;
      context.fillRect(labelX, labelY, labelWidth, 15);
      context.fillStyle = COLORS.vermilion;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(targetLabel, plotRight - 4, labelY + 7.5);
    }

    // Legend uses fill density, solid/dotted strokes, and a dash pattern.
    const legendY = 18;
    const secondLegendY = compactLayout ? 39 : legendY;
    const itemFont = compactLayout ? 10 : 11;
    context.font = `600 ${itemFont}px "Instrument Sans Variable", "Avenir Next", sans-serif`;
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
        targetBeyondScale ? "Target ↑" : "Target",
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
        targetBeyondScale ? "Target ↑" : "Target",
        [6, 4],
      );
    }
  }, [dpr, height, result, target, valueMode, width]);

  return (
    <figure className={`chart-figure path-chart ${className}`.trim()}>
      <div
        ref={containerRef}
        className="chart-canvas-shell path-chart__canvas-shell"
        style={{ width: "100%" }}
      >
        <canvas
          ref={canvasRef}
          className="chart-canvas path-chart__canvas"
          role="img"
          aria-label={summary}
          style={{ display: "block", height, width: "100%" }}
        />
      </div>
      <figcaption className="chart-caption path-chart__caption">
        <span className="chart-caption__metric">
          {valueMode === "real"
            ? "Inflation-adjusted portfolio value"
            : "Nominal portfolio value"}
        </span>
        <span className="chart-caption__detail">
          Each faint line is one possible path; bands show the 5th–95th and
          10th–90th percentile ranges.
        </span>
      </figcaption>
    </figure>
  );
}
