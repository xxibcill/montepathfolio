import {
  runBinomialLesson,
  runBlackScholesLesson,
  runHestonLesson,
  runLessonWithRunners,
  runMonteCarloOptionLesson,
  runStrategyLesson,
} from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = {
  "black-scholes": runBlackScholesLesson,
  "binomial-tree": runBinomialLesson,
  "monte-carlo-options": runMonteCarloOptionLesson,
  heston: runHestonLesson,
  "strategy-builder": runStrategyLesson,
};
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
