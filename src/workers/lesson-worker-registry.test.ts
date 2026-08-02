import { describe, expect, it } from "vitest";
import { LESSONS } from "../labs/catalog";
import { LESSON_RUNNERS_BY_FAMILY } from "../labs/lesson-runner-registry";
import {
  LESSON_WORKER_FAMILY_BY_LAB,
  lessonWorkerFamily,
} from "./lesson-worker-registry";

describe("lesson worker registry", () => {
  it("derives every lesson's worker family from its laboratory", () => {
    const registeredLessonIds = Object.values(LESSON_RUNNERS_BY_FAMILY).flatMap(
      (runners) => Object.keys(runners),
    );

    expect(new Set(registeredLessonIds).size).toBe(registeredLessonIds.length);
    expect([...registeredLessonIds].sort()).toEqual(
      LESSONS.map(({ id }) => id).sort(),
    );
    for (const lesson of LESSONS) {
      const family = LESSON_WORKER_FAMILY_BY_LAB[lesson.lab];
      expect(lessonWorkerFamily(lesson.id)).toBe(family);
      expect(LESSON_RUNNERS_BY_FAMILY[family]).toHaveProperty(lesson.id);
    }
  });

  it("rejects unknown lesson identifiers before creating a worker", () => {
    expect(() => lessonWorkerFamily("not-a-lesson")).toThrow(
      /No worker family is registered/,
    );
  });
});
