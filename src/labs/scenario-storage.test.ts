// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLesson } from "./catalog";
import type { LessonCalibrationSnapshot, LessonOutput } from "./lesson-types";
import {
  loadLessonScenario,
  saveLessonScenario,
} from "./scenario-storage";

const snapshot: LessonCalibrationSnapshot = {
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
};

const output: LessonOutput = {
  resultContract: "market-model/garch-1-1-result@1",
  headline: "Fixture",
  explanation: "Fixture",
  metrics: [],
  series: [],
  diagnostics: [],
  warnings: [],
  provenance: ["Fixture engine"],
  compactSummary: {},
  calibrationSnapshot: snapshot,
};

describe("lesson scenario persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores immutable fitted parameters without storing raw CSV text", () => {
    const lesson = getLesson("portfolio-projection", "garch");
    const defaults = Object.fromEntries(
      lesson.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
    );
    saveLessonScenario(
      "portfolio-projection",
      lesson,
      defaults,
      output,
      {
        contract: "educational-lesson-data-attachment@1",
        filename: "returns.csv",
        mediaType: "text/csv",
        text: "sensitive raw observations",
      },
    );

    const raw = window.localStorage.getItem(
      "montepathfolio/scenario/portfolio-projection@3",
    );
    expect(raw).not.toContain("sensitive raw observations");
    const restored = loadLessonScenario(
      "portfolio-projection",
      lesson,
      defaults,
    );
    expect(restored.calibrationSnapshot).toEqual(snapshot);
    expect(restored.needsDataReattachment).toBe(false);
  });

  it("asks for the source data when loading an older imported scenario", () => {
    const lesson = getLesson("portfolio-projection", "garch");
    const defaults = Object.fromEntries(
      lesson.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
    );
    window.localStorage.setItem(
      "montepathfolio/scenario/portfolio-projection@2",
      JSON.stringify({
        contract: "educational-scenario@2",
        lessonId: lesson.id,
        inputs: defaults,
        fittedSnapshotReference: {
          sourceContract: "educational-lesson-data-attachment@1",
          filename: "returns.csv",
        },
      }),
    );

    const restored = loadLessonScenario(
      "portfolio-projection",
      lesson,
      defaults,
    );

    expect(restored.calibrationSnapshot).toBeNull();
    expect(restored.needsDataReattachment).toBe(true);
  });

  it("reports when the browser rejects local persistence", () => {
    const lesson = getLesson("portfolio-projection", "garch");
    const values = Object.fromEntries(
      lesson.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

    expect(
      saveLessonScenario("portfolio-projection", lesson, values, output),
    ).toBe(false);
    setItem.mockRestore();
  });
});
