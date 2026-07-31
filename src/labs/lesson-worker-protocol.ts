import type {
  LessonCalibrationSnapshot,
  LessonOutput,
} from "./lesson-types";

export const LESSON_WORKER_PROTOCOL = "educational-lesson-worker@1" as const;
export const LESSON_DATA_ATTACHMENT_CONTRACT =
  "educational-lesson-data-attachment@1" as const;

export interface LessonDataAttachment {
  readonly contract: typeof LESSON_DATA_ATTACHMENT_CONTRACT;
  readonly filename: string;
  readonly mediaType: "text/csv";
  readonly text: string;
}

export interface LessonWorkerRequest {
  readonly contract: typeof LESSON_WORKER_PROTOCOL;
  readonly requestId: number;
  readonly lessonId: string;
  readonly values: Readonly<Record<string, number>>;
  readonly attachment?: LessonDataAttachment;
  readonly calibrationSnapshot?: LessonCalibrationSnapshot;
}

export interface LessonWorkerProblem {
  readonly contract: "educational-lesson-problem@1";
  readonly code:
    | "INVALID_REQUEST"
    | "RESOURCE_LIMIT"
    | "NUMERICAL_FAILURE"
    | "CALCULATION_FAILED"
    | "WORKER_FAILURE"
    | "CANCELLED";
  readonly message: string;
  readonly path?: string;
  readonly quantCode?: string;
}

export type LessonWorkerResponse =
  | {
      readonly contract: typeof LESSON_WORKER_PROTOCOL;
      readonly requestId: number;
      readonly ok: true;
      readonly output: LessonOutput;
    }
  | {
      readonly contract: typeof LESSON_WORKER_PROTOCOL;
      readonly requestId: number;
      readonly ok: false;
      readonly problem: LessonWorkerProblem;
    };

export function isLessonWorkerResponse(value: unknown): value is LessonWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract === LESSON_WORKER_PROTOCOL &&
    Number.isSafeInteger(candidate.requestId) &&
    typeof candidate.ok === "boolean" &&
    (candidate.ok === true
      ? typeof candidate.output === "object" && candidate.output !== null
      : isLessonWorkerProblem(candidate.problem))
  );
}

/** Keeps user-provided data structured-clone safe and bounded before parsing. */
export function isLessonDataAttachment(
  value: unknown,
): value is LessonDataAttachment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract === LESSON_DATA_ATTACHMENT_CONTRACT &&
    candidate.mediaType === "text/csv" &&
    typeof candidate.filename === "string" &&
    candidate.filename.trim().length > 0 &&
    typeof candidate.text === "string" &&
    candidate.text.length > 0 &&
    candidate.text.length <= 2_000_000
  );
}

export function isLessonCalibrationSnapshot(
  value: unknown,
): value is LessonCalibrationSnapshot {
  if (!isRecord(value)) return false;
  const candidate = value;
  const provenance = candidate.dataProvenance;
  const convergence = candidate.convergence;
  if (
    candidate.contract === "calibration-snapshot@1" &&
    candidate.schemaVersion === 1 &&
    ["daily", "weekly", "monthly", "annual"].includes(
      String(candidate.observationFrequency),
    ) &&
    ["simple", "log"].includes(String(candidate.returnConvention)) &&
    typeof candidate.sampleStart === "string" &&
    Number.isFinite(Date.parse(candidate.sampleStart)) &&
    typeof candidate.sampleEnd === "string" &&
    Number.isFinite(Date.parse(candidate.sampleEnd)) &&
    Date.parse(candidate.sampleStart) <= Date.parse(candidate.sampleEnd) &&
    typeof candidate.fittingMethod === "string" &&
    candidate.fittingMethod.trim().length > 0 &&
    isRecord(convergence) &&
    typeof convergence.converged === "boolean" &&
    Number.isSafeInteger(convergence.iterations) &&
    Number(convergence.iterations) >= 0 &&
    (convergence.objective === undefined || isFiniteNumber(convergence.objective)) &&
    isStringArray(candidate.warnings) &&
    isRecord(provenance) &&
    typeof provenance.label === "string" &&
    provenance.label.trim().length > 0 &&
    ["illustrative", "user-imported", "historical"].includes(
      String(provenance.kind),
    )
  ) {
    return snapshotEstimatesMatchModel(
      candidate.modelContract,
      candidate.estimates,
    );
  }
  return false;
}

function snapshotEstimatesMatchModel(
  modelContract: unknown,
  estimates: unknown,
): boolean {
  if (!isRecord(estimates)) return false;
  if (modelContract === "market-model/garch-1-1@1") {
    return (
      isFiniteNumber(estimates.omega) &&
      isFiniteNumber(estimates.alpha) &&
      isFiniteNumber(estimates.beta) &&
      isFiniteNumber(estimates.meanReturn) &&
      estimates.omega >= 0 &&
      estimates.alpha >= 0 &&
      estimates.beta >= 0
    );
  }
  if (modelContract === "market-model/ordered-regimes@1") {
    return (
      isStringArray(estimates.regimeLabels, 3) &&
      isFiniteNumberArray(estimates.means, 3) &&
      isFiniteNumberArray(estimates.volatilities, 3) &&
      estimates.volatilities.every((item) => item >= 0) &&
      isFiniteMatrix(estimates.transitionMatrix, 3) &&
      Array.isArray(estimates.statePath) &&
      estimates.statePath.every(
        (state) => Number.isSafeInteger(state) && Number(state) >= 0 && Number(state) <= 2,
      )
    );
  }
  return false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(isFiniteNumber)
  );
}

function isFiniteMatrix(value: unknown, size: number): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === size &&
    value.every((row) => isFiniteNumberArray(row, size))
  );
}

function isStringArray(value: unknown, length?: number): value is string[] {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isLessonWorkerProblem(value: unknown): value is LessonWorkerProblem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract === "educational-lesson-problem@1" &&
    [
      "INVALID_REQUEST",
      "RESOURCE_LIMIT",
      "NUMERICAL_FAILURE",
      "CALCULATION_FAILED",
      "WORKER_FAILURE",
      "CANCELLED",
    ].includes(
      String(candidate.code),
    ) &&
    typeof candidate.message === "string" &&
    (candidate.path === undefined || typeof candidate.path === "string") &&
    (candidate.quantCode === undefined || typeof candidate.quantCode === "string")
  );
}
