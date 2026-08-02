import {
  runBinomialLesson,
  runBlackScholesLesson,
  runHestonLesson,
  runMonteCarloOptionLesson,
  runStrategyLesson,
  type LessonRunner,
} from "./lesson-runners";

export const derivativesLessonRunners = {
  "black-scholes": runBlackScholesLesson,
  "binomial-tree": runBinomialLesson,
  "monte-carlo-options": runMonteCarloOptionLesson,
  heston: runHestonLesson,
  "strategy-builder": runStrategyLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
