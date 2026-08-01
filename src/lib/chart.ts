function themeColor(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function themeAlpha(light: string, dark: string): string {
  if (typeof document === "undefined") return light;
  return document.documentElement.dataset.theme === "dark" ? dark : light;
}

/** Canvas colors are getters so a theme change is reflected on the next draw. */
export const CHART_COLORS = {
  get paper() { return themeColor("--paper-light", "#fbf7ef"); },
  get ink() { return themeColor("--ink", "#29332d"); },
  get mutedInk() { return themeColor("--ink-faint", "#68736b"); },
  get grid() { return themeColor("--line", "#ded9ce"); },
  get forest() { return themeColor("--forest", "#376c4d"); },
  get path() { return themeAlpha("rgba(45, 67, 54, 0.085)", "rgba(187, 220, 196, 0.11)"); },
  get drawdownPath() { return themeAlpha("rgba(45, 67, 54, 0.075)", "rgba(187, 220, 196, 0.1)"); },
  get outerBand() { return themeAlpha("rgba(55, 108, 77, 0.11)", "rgba(127, 204, 153, 0.13)"); },
  get innerBand() { return themeAlpha("rgba(55, 108, 77, 0.22)", "rgba(127, 204, 153, 0.24)"); },
  get forestFill() { return themeAlpha("rgba(55, 108, 77, 0.62)", "rgba(127, 204, 153, 0.68)"); },
  get forestOutline() { return themeAlpha("rgba(41, 51, 45, 0.5)", "rgba(226, 232, 226, 0.58)"); },
  get bandOutline() { return themeAlpha("rgba(41, 51, 45, 0.42)", "rgba(226, 232, 226, 0.5)"); },
  get percentileLine() { return themeAlpha("rgba(41, 51, 45, 0.48)", "rgba(226, 232, 226, 0.6)"); },
  get vermilion() { return themeColor("--vermilion", "#a94734"); },
  get representativePaths() {
    return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
      ? ["#5eead4", "#fdba74", "#c4b5fd", "#7dd3fc", "#fde047", "#f9a8d4"]
      : ["#0f766e", "#9a3412", "#6d28d9", "#075985", "#854d0e", "#9d174d"];
  },
};

export const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const fullCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type XForIndex = (index: number) => number;
type YForValue = (value: number, index: number) => number;

interface SeriesPathOptions {
  values: number[];
  count: number;
  xForIndex: XForIndex;
  yForValue: YForValue;
}

interface StrokeSeriesOptions extends SeriesPathOptions {
  color: string;
  width: number;
  dash?: number[];
}

interface FillBandOptions {
  lower: number[];
  upper: number[];
  count: number;
  xForIndex: XForIndex;
  yForValue: YForValue;
  fillStyle: string;
}

interface BandLegendOptions {
  x: number;
  y: number;
  fill: string;
  label: string;
}

interface LineLegendOptions {
  x: number;
  y: number;
  color: string;
  label: string;
  dash?: number[];
}

export function niceCeiling(value: number, tickCount = 4): number {
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

export function formatProbability(value: number): string {
  const probability = Math.max(0, Math.min(1, value));
  return `${Math.round(probability * 100)}%`;
}

export function appendSeriesPath(
  context: CanvasRenderingContext2D,
  { values, count, xForIndex, yForValue }: SeriesPathOptions,
): void {
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

export function strokeSeries(
  context: CanvasRenderingContext2D,
  {
    values,
    count,
    xForIndex,
    yForValue,
    color,
    width,
    dash = [],
  }: StrokeSeriesOptions,
): void {
  context.beginPath();
  appendSeriesPath(context, { values, count, xForIndex, yForValue });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
}

export function fillBand(
  context: CanvasRenderingContext2D,
  {
    lower,
    upper,
    count,
    xForIndex,
    yForValue,
    fillStyle,
  }: FillBandOptions,
): void {
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

export function drawBandLegend(
  context: CanvasRenderingContext2D,
  { x, y, fill, label }: BandLegendOptions,
): void {
  context.fillStyle = fill;
  context.fillRect(x, y - 5, 18, 10);
  context.strokeStyle = CHART_COLORS.bandOutline;
  context.lineWidth = 0.8;
  context.strokeRect(x, y - 5, 18, 10);
  context.fillStyle = CHART_COLORS.ink;
  context.fillText(label, x + 24, y);
}

export function drawLineLegend(
  context: CanvasRenderingContext2D,
  { x, y, color, label, dash = [] }: LineLegendOptions,
): void {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + 20, y);
  context.setLineDash(dash);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = CHART_COLORS.ink;
  context.fillText(label, x + 26, y);
}
