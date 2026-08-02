import {
  runCirLesson,
  runHazardLesson,
  runMertonCreditLesson,
  runNelsonSiegelLesson,
  runVasicekLesson,
  type LessonRunner,
} from "./lesson-runners";

export const ratesCreditLessonRunners = {
  vasicek: runVasicekLesson,
  cir: runCirLesson,
  "nelson-siegel": runNelsonSiegelLesson,
  "hazard-credit": runHazardLesson,
  "merton-credit": runMertonCreditLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
