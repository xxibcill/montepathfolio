import { runBacktestingLesson, runLessonWithRunners, runVarLesson } from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = { "var-cvar": runVarLesson, "risk-backtesting": runBacktestingLesson };
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
