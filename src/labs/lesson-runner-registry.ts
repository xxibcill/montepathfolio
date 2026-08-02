import { constructionLessonRunners } from "./construction-lesson-runners";
import { derivativesLessonRunners } from "./derivatives-lesson-runners";
import { runLessonWithRunners, type LessonRunner } from "./lesson-runners";
import { projectionLessonRunners } from "./projection-lesson-runners";
import { ratesCreditLessonRunners } from "./rates-credit-lesson-runners";
import { riskLessonRunners } from "./risk-lesson-runners";
import { tradingLessonRunners } from "./trading-lesson-runners";
import type { LessonDataAttachment } from "./lesson-worker-protocol";
import type {
  LessonCalibrationSnapshot,
  LessonOutput,
} from "./lesson-types";
import type { LessonWorkerFamily } from "../workers/lesson-worker-registry";

export const LESSON_RUNNERS_BY_FAMILY = {
  projection: projectionLessonRunners,
  risk: riskLessonRunners,
  construction: constructionLessonRunners,
  derivatives: derivativesLessonRunners,
  "rates-credit": ratesCreditLessonRunners,
  trading: tradingLessonRunners,
} as const satisfies Readonly<
  Record<LessonWorkerFamily, Readonly<Record<string, LessonRunner>>>
>;

const allLessonRunners: Readonly<Record<string, LessonRunner>> = Object.assign(
  {},
  ...Object.values(LESSON_RUNNERS_BY_FAMILY),
);

export function runLesson(
  id: string,
  values: Readonly<Record<string, number>>,
  attachment?: LessonDataAttachment,
  calibrationSnapshot?: LessonCalibrationSnapshot,
): LessonOutput {
  return runLessonWithRunners(
    { id, values, attachment, calibrationSnapshot },
    allLessonRunners,
  );
}
