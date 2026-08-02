import { LESSONS } from "../labs/catalog";
import type { LabId } from "../labs/routes";

export const LESSON_WORKER_FAMILY_BY_LAB = {
  "portfolio-projection": "projection",
  risk: "risk",
  "portfolio-construction": "construction",
  derivatives: "derivatives",
  "rates-credit": "rates-credit",
  trading: "trading",
} as const;

export type LessonWorkerFamily =
  (typeof LESSON_WORKER_FAMILY_BY_LAB)[LabId];

const WORKER_FAMILY_BY_LESSON = new Map<string, LessonWorkerFamily>(
  LESSONS.map((lesson) => [
    lesson.id,
    LESSON_WORKER_FAMILY_BY_LAB[lesson.lab],
  ]),
);

export function lessonWorkerFamily(lessonId: string): LessonWorkerFamily {
  const family = WORKER_FAMILY_BY_LESSON.get(lessonId);
  if (!family) {
    throw new Error(`No worker family is registered for lesson ${lessonId}.`);
  }
  return family;
}
