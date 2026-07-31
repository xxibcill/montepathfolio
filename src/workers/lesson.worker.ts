import { runLesson } from "../labs/lesson-runners";
import { QuantError } from "../lib/quant/core";
import {
  isLessonDataAttachment,
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerRequest,
  type LessonWorkerResponse,
} from "../labs/lesson-worker-protocol";

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
        !isLessonDataAttachment(request.attachment))
    ) {
      response = {
        contract: LESSON_WORKER_PROTOCOL,
        requestId,
        ok: false,
        problem: {
          contract: "educational-lesson-problem@1",
          code: "INVALID_REQUEST",
          message: "The lesson worker received an invalid request.",
        },
      };
      self.postMessage(response);
      return;
    }
    response = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId,
      ok: true,
      output: runLesson(request.lessonId, request.values, request.attachment),
    };
  } catch (error) {
    const quantProblem = error instanceof QuantError
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
    response = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId,
      ok: false,
      problem: {
        contract: "educational-lesson-problem@1",
        code: quantProblem?.code ?? "CALCULATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "The lesson calculation failed unexpectedly.",
        ...(quantProblem?.path ? { path: quantProblem.path } : {}),
        ...(quantProblem ? { quantCode: quantProblem.quantCode } : {}),
      },
    };
  }
  self.postMessage(response);
};
