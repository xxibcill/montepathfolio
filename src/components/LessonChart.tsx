import { useId } from "react";
import type { LessonChartAxes, LessonSeries } from "../labs/lesson-types";

const WIDTH = 820;
const HEIGHT = 360;
const MARGIN = { top: 24, right: 24, bottom: 68, left: 82 };
const TONES = {
  forest: "var(--forest)",
  vermilion: "var(--vermilion)",
  ochre: "var(--ochre)",
  ink: "var(--ink-soft)",
} as const;

export function LessonChart({
  title,
  series,
  xLabel = "x value",
  yLabel = "y value",
  xUnit,
  yUnit,
}: {
  readonly title: string;
  readonly series: readonly LessonSeries[];
} & Partial<LessonChartAxes>) {
  const titleId = useId();
  const descriptionId = useId();
  const points = series.flatMap((item) => item.points);
  if (points.length === 0) {
    return <p className="lesson-chart__empty">This run produced no plottable values.</p>;
  }
  const xExtent = extent(points.map((point) => point.x));
  const yExtent = includeZeroForBars(
    extent(points.map((point) => point.y)),
    series.some((item) => item.style === "bars"),
  );
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (value: number) =>
    MARGIN.left + normalize(value, xExtent) * plotWidth;
  const yScale = (value: number) =>
    MARGIN.top + (1 - normalize(value, yExtent)) * plotHeight;
  const xTicks = ticks(xExtent, 5);
  const yTicks = ticks(yExtent, 5);

  return (
    <figure className="lesson-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>
          {`Horizontal axis: ${axisHeading(xLabel, xUnit)}. Vertical axis: ${axisHeading(yLabel, yUnit)}. `}
          {series.map((item) => `${item.name}: ${item.points.length} points`).join(". ")}
        </desc>
        <g className="lesson-chart__grid" aria-hidden="true">
          {yTicks.map((tick) => (
            <line
              key={`y-${tick}`}
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={yScale(tick)}
              y2={yScale(tick)}
            />
          ))}
        </g>
        <g className="lesson-chart__axis" aria-hidden="true">
          {yTicks.map((tick) => (
            <text
              key={`yl-${tick}`}
              x={MARGIN.left - 11}
              y={yScale(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {axisNumber(tick)}
            </text>
          ))}
          {xTicks.map((tick) => (
            <text
              key={`xl-${tick}`}
              x={xScale(tick)}
              y={HEIGHT - MARGIN.bottom + 24}
              textAnchor="middle"
            >
              {axisNumber(tick)}
            </text>
          ))}
          <text
            className="lesson-chart__axis-label"
            x={MARGIN.left + plotWidth / 2}
            y={HEIGHT - 10}
            textAnchor="middle"
          >
            {axisHeading(xLabel, xUnit)}
          </text>
          <text
            className="lesson-chart__axis-label"
            x={18}
            y={MARGIN.top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${MARGIN.top + plotHeight / 2})`}
          >
            {axisHeading(yLabel, yUnit)}
          </text>
        </g>
        {series.map((item, index) => (
          <SeriesMark
            key={`${item.name}-${index}`}
            series={item}
            color={TONES[item.tone ?? "forest"]}
            xScale={xScale}
            yScale={yScale}
            zeroY={yScale(0)}
            plotBottom={HEIGHT - MARGIN.bottom}
            patternIndex={index}
          />
        ))}
      </svg>
      <figcaption>
        {series.map((item, index) => (
          <span key={item.name}>
            <LegendMark
              color={TONES[item.tone ?? "forest"]}
              patternIndex={index}
              style={item.style}
            />
            {item.name}
          </span>
        ))}
      </figcaption>
      <details className="lesson-chart-data">
        <summary>View chart values as a table</summary>
        <div>
          <table>
            <caption>{title} — bounded, evenly sampled values</caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">{axisHeading(xLabel, xUnit)}</th>
                <th scope="col">{axisHeading(yLabel, yUnit)}</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((item) =>
                samplePoints(item.points, 120).map((point, pointIndex) => (
                  <tr key={`${item.name}-${pointIndex}-${point.x}`}>
                    <th scope="row">{item.name}</th>
                    <td>{axisNumber(point.x)}</td>
                    <td>{axisNumber(point.y)}</td>
                    <td>{point.label ?? "—"}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function axisHeading(label: string, unit?: string): string {
  return unit ? `${label} (${unit})` : label;
}

function samplePoints(
  points: LessonSeries["points"],
  maximum: number,
): LessonSeries["points"] {
  if (points.length <= maximum) return points;
  const indexes = new Set<number>([0, points.length - 1]);
  for (let index = 0; index < maximum; index += 1) {
    indexes.add(Math.round((index * (points.length - 1)) / (maximum - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => points[index]);
}

function SeriesMark({
  series,
  color,
  xScale,
  yScale,
  zeroY,
  plotBottom,
  patternIndex,
}: {
  readonly series: LessonSeries;
  readonly color: string;
  readonly xScale: (value: number) => number;
  readonly yScale: (value: number) => number;
  readonly zeroY: number;
  readonly plotBottom: number;
  readonly patternIndex: number;
}) {
  if (series.style === "points") {
    return (
      <g fill={color} stroke="var(--paper-light)" strokeWidth="0.8" opacity="0.78" aria-hidden="true">
        {series.points.map((point, index) => (
          <PointMark
            key={index}
            x={xScale(point.x)}
            y={yScale(point.y)}
            patternIndex={patternIndex}
          />
        ))}
      </g>
    );
  }
  if (series.style === "bars") {
    const width = Math.max(3, Math.min(18, 500 / Math.max(1, series.points.length)));
    return (
      <g fill={color} opacity="0.78" aria-hidden="true">
        {series.points.map((point, index) => {
          const valueY = yScale(point.y);
          const baseline = Number.isFinite(zeroY) ? zeroY : plotBottom;
          return (
            <rect
              key={index}
              x={xScale(point.x) - width / 2}
              y={Math.min(valueY, baseline)}
              width={width}
              height={Math.max(1, Math.abs(baseline - valueY))}
              stroke={color}
              strokeWidth={1 + (patternIndex % 2)}
              strokeDasharray={lineDash(patternIndex)}
            />
          );
        })}
      </g>
    );
  }
  const path = series.points
    .map((point, index) => {
      const command = index === 0 ? "M" : series.style === "step" ? "H" : "L";
      if (series.style === "step" && index > 0) {
        return `${command}${xScale(point.x)} V${yScale(point.y)}`;
      }
      return `${command}${xScale(point.x)} ${yScale(point.y)}`;
    })
    .join(" ");
  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={lineDash(patternIndex)}
      vectorEffect="non-scaling-stroke"
      aria-hidden="true"
    />
  );
}

function PointMark({
  x,
  y,
  patternIndex,
}: {
  readonly x: number;
  readonly y: number;
  readonly patternIndex: number;
}) {
  const shape = patternIndex % 4;
  if (shape === 1) {
    return <rect x={x - 2.5} y={y - 2.5} width="5" height="5" />;
  }
  if (shape === 2) {
    return <rect x={x - 2.4} y={y - 2.4} width="4.8" height="4.8" transform={`rotate(45 ${x} ${y})`} />;
  }
  if (shape === 3) {
    return <path d={`M ${x} ${y - 3} L ${x + 3} ${y + 2.5} L ${x - 3} ${y + 2.5} Z`} />;
  }
  return <circle cx={x} cy={y} r="2.5" />;
}

function LegendMark({
  color,
  patternIndex,
  style,
}: {
  readonly color: string;
  readonly patternIndex: number;
  readonly style: LessonSeries["style"];
}) {
  return (
    <svg className="lesson-chart__legend-mark" viewBox="0 0 24 12" aria-hidden="true">
      <line
        x1="1"
        x2="23"
        y1="6"
        y2="6"
        stroke={color}
        strokeWidth={style === "bars" ? 5 : 2.2}
        strokeDasharray={lineDash(patternIndex)}
      />
      {style === "points" ? (
        <g fill={color}>
          <PointMark x={12} y={6} patternIndex={patternIndex} />
        </g>
      ) : null}
    </svg>
  );
}

function lineDash(patternIndex: number): string | undefined {
  return [undefined, "8 5", "2 4", "10 3 2 3"][patternIndex % 4];
}

function extent(values: readonly number[]): readonly [number, number] {
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.max(1, Math.abs(minimum) * 0.1);
    minimum -= padding;
    maximum += padding;
  } else {
    const padding = (maximum - minimum) * 0.06;
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function includeZeroForBars(
  extentValue: readonly [number, number],
  includeZero: boolean,
): readonly [number, number] {
  return includeZero
    ? [Math.min(0, extentValue[0]), Math.max(0, extentValue[1])]
    : extentValue;
}

function normalize(value: number, domain: readonly [number, number]): number {
  return (value - domain[0]) / (domain[1] - domain[0]);
}

function ticks(domain: readonly [number, number], count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => domain[0] + ((domain[1] - domain[0]) * index) / (count - 1),
  );
}

function axisNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (absolute > 0 && absolute < 0.01) return value.toExponential(1);
  return value.toFixed(absolute < 1 ? 2 : 1);
}
