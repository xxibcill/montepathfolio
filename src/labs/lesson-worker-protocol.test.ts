import { describe, expect, it } from "vitest";
import {
  isLessonCalibrationSnapshot,
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

  it("accepts only supported immutable calibration snapshots", () => {
    expect(
      isLessonCalibrationSnapshot({
        contract: "calibration-snapshot@1",
        modelContract: "market-model/garch-1-1@1",
        schemaVersion: 1,
        observationFrequency: "monthly",
        returnConvention: "simple",
        sampleStart: "2020-01-01",
        sampleEnd: "2025-01-01",
        estimates: { omega: 0.001, alpha: 0.1, beta: 0.8, meanReturn: 0 },
        fittingMethod: "fixture",
        convergence: { converged: true, iterations: 1 },
        warnings: [],
        dataProvenance: { label: "Local fixture", kind: "user-imported" },
      }),
    ).toBe(true);
    expect(
      isLessonCalibrationSnapshot({
        contract: "calibration-snapshot@1",
        modelContract: "unsupported@1",
        schemaVersion: 1,
      }),
    ).toBe(false);
    expect(
      isLessonCalibrationSnapshot({
        contract: "calibration-snapshot@1",
        modelContract: "market-model/garch-1-1@1",
        schemaVersion: 1,
        observationFrequency: "monthly",
        returnConvention: "simple",
        sampleStart: "2020-01-01",
        sampleEnd: "2025-01-01",
        estimates: { omega: "not-a-number", alpha: 0.1, beta: 0.8 },
        fittingMethod: "fixture",
        convergence: { converged: true, iterations: 1 },
        warnings: [],
        dataProvenance: { label: "Local fixture", kind: "user-imported" },
      }),
    ).toBe(false);
  });
});
