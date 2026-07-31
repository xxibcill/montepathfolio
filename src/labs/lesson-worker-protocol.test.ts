import { describe, expect, it } from "vitest";
import {
  isLessonDataAttachment,
  isLessonWorkerResponse,
  LESSON_DATA_ATTACHMENT_CONTRACT,
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerResponse,
} from "./lesson-worker-protocol";

describe("educational lesson worker protocol", () => {
  it("accepts structured success and failure messages", () => {
    const success: LessonWorkerResponse = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId: 4,
      ok: true,
      output: {
        resultContract: "fixture@1",
        headline: "Fixture",
        explanation: "Deterministic fixture.",
        metrics: [],
        series: [],
        diagnostics: [],
        warnings: [],
        provenance: [],
        compactSummary: {},
      },
    };
    const failure: LessonWorkerResponse = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId: 5,
      ok: false,
      problem: {
        contract: "educational-lesson-problem@1",
        code: "CALCULATION_FAILED",
        message: "Invalid parameters.",
      },
    };
    expect(isLessonWorkerResponse(success)).toBe(true);
    expect(isLessonWorkerResponse(failure)).toBe(true);
  });

  it("rejects stale or malformed message shapes", () => {
    expect(isLessonWorkerResponse(null)).toBe(false);
    expect(
      isLessonWorkerResponse({
        contract: "educational-lesson-worker@999",
        requestId: 1,
        ok: false,
        problem: {
          contract: "educational-lesson-problem@1",
          code: "INVALID_REQUEST",
          message: "Wrong contract.",
        },
      }),
    ).toBe(false);
    expect(
      isLessonWorkerResponse({
        contract: LESSON_WORKER_PROTOCOL,
        requestId: 1.5,
        ok: true,
        output: {},
      }),
    ).toBe(false);
  });

  it("bounds learner-supplied CSV attachments before worker parsing", () => {
    expect(
      isLessonDataAttachment({
        contract: LESSON_DATA_ATTACHMENT_CONTRACT,
        filename: "returns.csv",
        mediaType: "text/csv",
        text: "date,asset\n2025-01-01,0.01",
      }),
    ).toBe(true);
    expect(
      isLessonDataAttachment({
        contract: LESSON_DATA_ATTACHMENT_CONTRACT,
        filename: "empty.csv",
        mediaType: "text/csv",
        text: "",
      }),
    ).toBe(false);
  });
});
