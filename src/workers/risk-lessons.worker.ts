import { runBacktestingLesson, runVarLesson } from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"risk">({
  "var-cvar": runVarLesson,
  "risk-backtesting": runBacktestingLesson,
});

registerLessonRunners(runners);
