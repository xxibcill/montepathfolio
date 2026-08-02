import { describe, expect, it } from "vitest";
import { LESSONS } from "../labs/catalog";
import {
  runBacktestingLesson,
  runVarLesson,
} from "../labs/lesson-runners";
import {
  LESSON_WORKER_FAMILIES,
  defineLessonRunners,
  lessonWorkerFamily,
} from "./lesson-worker-registry";

describe("lesson worker registry", () => {
  it("assigns every advanced lesson to exactly one worker family", () => {
    const registeredLessonIds = Object.values(LESSON_WORKER_FAMILIES).flat();

    expect(new Set(registeredLessonIds).size).toBe(registeredLessonIds.length);
    expect([...registeredLessonIds].sort()).toEqual(
      LESSONS.map(({ id }) => id).sort(),
    );
    for (const [family, lessonIds] of Object.entries(LESSON_WORKER_FAMILIES)) {
      for (const lessonId of lessonIds) {
        expect(lessonWorkerFamily(lessonId)).toBe(family);
      }
    }
  });

  it("rejects unknown lesson identifiers before creating a worker", () => {
    expect(() => lessonWorkerFamily("not-a-lesson")).toThrow(
      /No worker family is registered/,
    );
  });

  it("returns a family runner registry without changing its entries", () => {
    const runners = defineLessonRunners<"risk">({
      "var-cvar": runVarLesson,
      "risk-backtesting": runBacktestingLesson,
    });

    expect(runners).toEqual({
      "var-cvar": runVarLesson,
      "risk-backtesting": runBacktestingLesson,
    });
  });
});
