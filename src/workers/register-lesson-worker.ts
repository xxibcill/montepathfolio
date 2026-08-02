import { QuantError } from "../lib/quant/core";
import {
  isLessonCalibrationSnapshot,
  isLessonDataAttachment,
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerRequest,
  type LessonWorkerResponse,
} from "../labs/lesson-worker-protocol";
import type { LessonOutput } from "../labs/lesson-types";
import {
  runLessonWithRunners,
  type LessonRunner,
} from "../labs/lesson-runners";

type RunLesson = (
  id: string,
  values: Readonly<Record<string, number>>,
  attachment?: LessonWorkerRequest["attachment"],
  calibrationSnapshot?: LessonWorkerRequest["calibrationSnapshot"],
) => LessonOutput;

export function registerLessonRunners(
  runners: Readonly<Record<string, LessonRunner>>,
): void {
  registerLessonWorker((id, values, attachment, calibrationSnapshot) =>
    runLessonWithRunners(
      { id, values, attachment, calibrationSnapshot },
      runners,
    ),
  );
}

export function registerLessonWorker(runLesson: RunLesson): void {
  self.onmessage = (event: MessageEvent<LessonWorkerRequest>) => {
    const request = event.data;
    const requestId = Number.isSafeInteger(request?.requestId)
      ? request.requestId
      : -1;
    let response: LessonWorkerResponse;
    try {
      if (
        !request ||
        request.contract !== LESSON_WORKER_PROTOCOL ||
        !Number.isSafeInteger(request.requestId) ||
        typeof request.lessonId !== "string" ||
        !request.values ||
        typeof request.values !== "object" ||
        (request.attachment !== undefined &&
          !isLessonDataAttachment(request.attachment)) ||
        (request.calibrationSnapshot !== undefined &&
          !isLessonCalibrationSnapshot(request.calibrationSnapshot)) ||
        (request.attachment !== undefined &&
          request.calibrationSnapshot !== undefined)
      ) {
        response = problemResponse(
          requestId,
          "INVALID_REQUEST",
          "The lesson worker received an invalid request.",
        );
        self.postMessage(response);
        return;
      }
      response = {
        contract: LESSON_WORKER_PROTOCOL,
        requestId,
        ok: true,
        output: runLesson(
          request.lessonId,
          request.values,
          request.attachment,
          request.calibrationSnapshot,
        ),
      };
    } catch (error) {
      const quantProblem =
        error instanceof QuantError
          ? {
              code:
                error.code === "NUMERICAL_FAILURE"
                  ? ("NUMERICAL_FAILURE" as const)
                  : error.code === "OUT_OF_RANGE" && /limit|exceed|resource/i.test(error.message)
                    ? ("RESOURCE_LIMIT" as const)
                    : ("INVALID_REQUEST" as const),
              path: error.path,
              quantCode: error.code,
            }
          : null;
      const baseProblem = problemResponse(
        requestId,
        quantProblem?.code ?? "CALCULATION_FAILED",
        error instanceof Error
          ? error.message
          : "The lesson calculation failed unexpectedly.",
      );
      response = {
        ...baseProblem,
        problem: {
          ...baseProblem.problem,
          ...(quantProblem?.path ? { path: quantProblem.path } : {}),
          ...(quantProblem ? { quantCode: quantProblem.quantCode } : {}),
        },
      };
    }
    self.postMessage(response);
  };
}

function problemResponse(
  requestId: number,
  code: Extract<LessonWorkerResponse, { ok: false }>["problem"]["code"],
  message: string,
): Extract<LessonWorkerResponse, { ok: false }> {
  return {
    contract: LESSON_WORKER_PROTOCOL,
    requestId,
    ok: false,
    problem: { contract: "educational-lesson-problem@1", code, message },
  };
}
