import {
  runBlackLittermanLesson,
  runCapmLesson,
  runFactorLesson,
  runKellyLesson,
  runMeanVarianceLesson,
  runRiskParityLesson,
  type LessonRunner,
} from "./lesson-runners";

export const constructionLessonRunners = {
  "mean-variance": runMeanVarianceLesson,
  capm: runCapmLesson,
  "factor-models": runFactorLesson,
  "risk-parity": runRiskParityLesson,
  kelly: runKellyLesson,
  "black-litterman": runBlackLittermanLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
