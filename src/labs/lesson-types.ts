import type { LabId } from "./routes";

export type ParameterFormat =
  | "number"
  | "integer"
  | "decimal-percent"
  | "currency";

export interface LessonParameter {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly format: ParameterFormat;
  /** Named numeric choices keep worker payloads simple without exposing magic numbers. */
  readonly choices?: readonly {
    readonly value: number;
    readonly label: string;
  }[];
}

export interface LessonPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface LessonSymbol {
  readonly symbol: string;
  readonly meaning: string;
}

export interface LessonMetric {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: "neutral" | "positive" | "caution";
}

export interface LessonPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface LessonSeries {
  readonly name: string;
  readonly points: readonly LessonPoint[];
  readonly tone?: "forest" | "vermilion" | "ochre" | "ink";
  readonly style?: "line" | "bars" | "points" | "step";
}

export interface LessonTable {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface LessonChartAxes {
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xUnit?: string;
  readonly yUnit?: string;
}

export interface LessonChartSpec extends LessonChartAxes {
  readonly title: string;
  readonly series: readonly LessonSeries[];
}

export interface LessonOutput {
  readonly resultContract: string;
  readonly headline: string;
  readonly explanation: string;
  readonly metrics: readonly LessonMetric[];
  readonly series: readonly LessonSeries[];
  /** Semantic labels for the primary chart. Added by the lesson registry. */
  readonly chartAxes?: LessonChartAxes;
  /** Optional model-specific views when one shared axis would obscure meaning. */
  readonly additionalCharts?: readonly LessonChartSpec[];
  readonly table?: LessonTable;
  readonly diagnostics: readonly string[];
  readonly warnings: readonly string[];
  readonly provenance: readonly string[];
  readonly compactSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface LessonDefinition {
  readonly id: string;
  readonly lab: LabId;
  readonly release: number;
  readonly title: string;
  readonly kicker: string;
  readonly question: string;
  readonly intuition: string;
  readonly equation: string;
  readonly symbols: readonly LessonSymbol[];
  readonly parameters: readonly LessonParameter[];
  readonly presets: readonly LessonPreset[];
  readonly workedExample: string;
  readonly check: string;
  readonly assumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly modelNotePath: string;
  readonly dataImport?: {
    readonly label: string;
    readonly description: string;
    readonly templateFilename: string;
    readonly templateCsv: string;
  };
}

export interface LabDefinition {
  readonly id: LabId;
  readonly number: string;
  readonly title: string;
  readonly subtitle: string;
  readonly introduction: string;
  readonly lessonIds: readonly string[];
}
