import {
  runAgentMarketLesson,
  runExecutionLesson,
  runOrderBookLesson,
  runOuLesson,
} from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"trading">({
  "ornstein-uhlenbeck": runOuLesson,
  "order-book": runOrderBookLesson,
  "agent-market": runAgentMarketLesson,
  "optimal-execution": runExecutionLesson,
});

registerLessonRunners(runners);
