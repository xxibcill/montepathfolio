import {
  runBinomialLesson,
  runBlackScholesLesson,
  runHestonLesson,
  runMonteCarloOptionLesson,
  runStrategyLesson,
} from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"derivatives">({
  "black-scholes": runBlackScholesLesson,
  "binomial-tree": runBinomialLesson,
  "monte-carlo-options": runMonteCarloOptionLesson,
  heston: runHestonLesson,
  "strategy-builder": runStrategyLesson,
});

registerLessonRunners(runners);
