import type { LessonOutput } from "./lesson-types";

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
