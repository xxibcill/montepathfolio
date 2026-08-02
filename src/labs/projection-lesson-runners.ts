import {
  runBootstrapLesson,
  runCompositeLesson,
  runCopulaLesson,
  runGarchLesson,
  runJumpDiffusionLesson,
  runRegimeLesson,
  runRetirementLesson,
  runStudentTLesson,
  type LessonRunner,
} from "./lesson-runners";

export const projectionLessonRunners = {
  "jump-diffusion": runJumpDiffusionLesson,
  garch: runGarchLesson,
  "historical-bootstrap": runBootstrapLesson,
  "retirement-sequence": runRetirementLesson,
  "regime-calibration": runRegimeLesson,
  "student-t": runStudentTLesson,
  copulas: runCopulaLesson,
  "composite-market": runCompositeLesson,
} as const satisfies Readonly<Record<string, LessonRunner>>;
