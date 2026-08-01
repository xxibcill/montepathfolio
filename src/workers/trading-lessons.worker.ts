import {
  runAgentMarketLesson,
  runExecutionLesson,
  runLessonWithRunners,
  runOrderBookLesson,
  runOuLesson,
} from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = {
  "ornstein-uhlenbeck": runOuLesson,
  "order-book": runOrderBookLesson,
  "agent-market": runAgentMarketLesson,
  "optimal-execution": runExecutionLesson,
};
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
