import {
  runAgentMarketLesson,
  runExecutionLesson,
  runOrderBookLesson,
  runOuLesson,
  type LessonRunner,
} from "./lesson-runners";

export const tradingLessonRunners = {
  "ornstein-uhlenbeck": runOuLesson,
  "order-book": runOrderBookLesson,
  "agent-market": runAgentMarketLesson,
  "optimal-execution": runExecutionLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
