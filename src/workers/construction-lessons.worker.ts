import {
  runBlackLittermanLesson,
  runCapmLesson,
  runFactorLesson,
  runKellyLesson,
  runMeanVarianceLesson,
  runRiskParityLesson,
} from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"construction">({
  "mean-variance": runMeanVarianceLesson,
  capm: runCapmLesson,
  "factor-models": runFactorLesson,
  "risk-parity": runRiskParityLesson,
  kelly: runKellyLesson,
  "black-litterman": runBlackLittermanLesson,
});

registerLessonRunners(runners);
