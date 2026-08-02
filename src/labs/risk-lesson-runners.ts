import {
  runBacktestingLesson,
  runVarLesson,
  type LessonRunner,
} from "./lesson-runners";

export const riskLessonRunners = {
  "var-cvar": runVarLesson,
  "risk-backtesting": runBacktestingLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
