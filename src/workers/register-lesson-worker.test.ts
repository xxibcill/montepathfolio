// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { QuantError } from "../lib/quant/core";
import { LESSON_WORKER_PROTOCOL, type LessonWorkerRequest } from "../labs/lesson-worker-protocol";
import { registerLessonWorker } from "./register-lesson-worker";

describe("laboratory-family worker registration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns structured validation and numerical failures", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("postMessage", postMessage);
    registerLessonWorker(() => {
      throw new QuantError("NUMERICAL_FAILURE", "Overflowed recurrence", "values.alpha");
    });

    self.onmessage?.({ data: validRequest() } as MessageEvent<LessonWorkerRequest>);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      ok: false,
      problem: expect.objectContaining({
        code: "NUMERICAL_FAILURE",
        path: "values.alpha",
        quantCode: "NUMERICAL_FAILURE",
      }),
    }));

    self.onmessage?.({ data: { contract: "wrong", requestId: 2 } } as never);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 2,
      ok: false,
      problem: expect.objectContaining({ code: "INVALID_REQUEST" }),
    }));
  });
});

function validRequest(): LessonWorkerRequest {
  return {
    contract: LESSON_WORKER_PROTOCOL,
    requestId: 1,
    lessonId: "var-cvar",
    values: {},
  };
}
