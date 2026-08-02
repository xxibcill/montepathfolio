import { useEffect, useMemo, useRef } from "react";
import { useCanvasSize } from "../hooks/useCanvasSize";
import { useThemeRevision } from "../hooks/useTheme";
import {
  appendSeriesPath,
  CHART_COLORS as COLORS,
  compactCurrency,
  drawBandLegend,
  drawLineLegend,
  fillBand,
  formatProbability,
  fullCurrency,
  niceCeiling,
  strokeSeries,
} from "../lib/chart";
import { REPRESENTATIVE_REGIME_PATH_COUNT } from "../lib/regimes";
import type { PortfolioProjectionResult } from "../labs/portfolio-projection-model";

type ValueMode = "nominal" | "real";

const REPRESENTATIVE_PATH_DASHES = [
  [],
  [8, 3],
  [2, 3],
  [10, 3, 2, 3],
  [1, 2],
  [6, 2, 1, 2],
] as const;

export interface PathChartProps {
  result: PortfolioProjectionResult;
  targetValue?: number;
  valueMode?: ValueMode;
  className?: string;
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
  const themeRevision = useThemeRevision();
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

    const representativePathSummary =
      result.inputs.model === "hmm"
        ? " Six numbered highlighted paths correspond to the regime strips below."
        : "";

    return `${simulationCount.toLocaleString()} simulated portfolio paths over ${years} years. The median ending value is ${fullCurrency.format(median)}${valueMode === "real" ? " in today's dollars" : ""}. Ninety percent of outcomes finish between ${fullCurrency.format(lower)} and ${fullCurrency.format(upper)}. ${formatProbability(result.metrics.probabilityOfTarget)} reach the ${fullCurrency.format(target)} target.${representativePathSummary}`;
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
    const representativePathCount =
      result.inputs.model === "hmm"
        ? Math.min(
            REPRESENTATIVE_REGIME_PATH_COUNT,
            result.samplePaths.length,
            result.sampleRegimePaths.length,
          )
        : 0;
    context.beginPath();
    for (
      let pathIndex = 0;
      pathIndex < result.samplePaths.length;
      pathIndex += pathStep
    ) {
      if (pathIndex < representativePathCount) {
        continue;
      }
      const path = result.samplePaths[pathIndex];
      if (!path) {
        continue;
      }
      const pathCount = Math.min(count, path.length);
      appendSeriesPath(context, {
        values: path,
        count: pathCount,
        xForIndex,
        yForValue,
      });
    }
    context.strokeStyle = COLORS.path;
    context.lineWidth = 0.65;
    context.stroke();

    fillBand(context, {
      lower: series.p05,
      upper: series.p95,
      count,
      xForIndex,
      yForValue,
      fillStyle: COLORS.outerBand,
    });
    fillBand(context, {
      lower: series.p10,
      upper: series.p90,
      count,
      xForIndex,
      yForValue,
      fillStyle: COLORS.innerBand,
    });

    const representativePaths = result.samplePaths.slice(
      0,
      representativePathCount,
    );
    representativePaths.forEach((path, index) => {
      strokeSeries(context, {
        values: path,
        count: Math.min(count, path.length),
        xForIndex,
        yForValue,
        color: COLORS.representativePaths[index],
        width: 1.6,
        dash: [...REPRESENTATIVE_PATH_DASHES[index]],
      });
    });

    // Dotted decile boundaries remain identifiable in monochrome.
    strokeSeries(context, {
      values: series.p10,
      count,
      xForIndex,
      yForValue,
      color: COLORS.percentileLine,
      width: 0.9,
      dash: [2, 4],
    });
    strokeSeries(context, {
      values: series.p90,
      count,
      xForIndex,
      yForValue,
      color: COLORS.percentileLine,
      width: 0.9,
      dash: [2, 4],
    });
    strokeSeries(context, {
      values: series.p50,
      count,
      xForIndex,
      yForValue,
      color: COLORS.forest,
      width: 2.4,
    });

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

    context.font =
      '700 8px "Instrument Sans Variable", "Avenir Next", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    representativePaths.forEach((path, index) => {
      const markerIndex = Math.round(
        ((index + 1) / (representativePaths.length + 1)) * (count - 1),
      );
      const value = path[markerIndex];
      if (value === undefined) return;

      const markerX = xForIndex(markerIndex);
      const markerY = yForValue(value, markerIndex);
      context.beginPath();
      context.arc(markerX, markerY, 7, 0, Math.PI * 2);
      context.fillStyle = COLORS.paper;
      context.fill();
      context.strokeStyle = COLORS.representativePaths[index];
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = COLORS.representativePaths[index];
      context.fillText(String(index + 1).padStart(2, "0"), markerX, markerY);
    });

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
        label: targetBeyondScale ? "Target ↑" : "Target",
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
        label: targetBeyondScale ? "Target ↑" : "Target",
        dash: [6, 4],
      });
    }
  }, [dpr, height, result, target, themeRevision, valueMode, width]);

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
          10th–90th percentile ranges
          {result.inputs.model === "hmm"
            ? "; numbered paths match the regime strips below."
            : "."}
        </span>
      </figcaption>
    </figure>
  );
}
