import {
  runBlackLittermanLesson,
  runCapmLesson,
  runFactorLesson,
  runKellyLesson,
  runLessonWithRunners,
  runMeanVarianceLesson,
  runRiskParityLesson,
} from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = {
  "mean-variance": runMeanVarianceLesson,
  capm: runCapmLesson,
  "factor-models": runFactorLesson,
  "risk-parity": runRiskParityLesson,
  kelly: runKellyLesson,
  "black-litterman": runBlackLittermanLesson,
};
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
