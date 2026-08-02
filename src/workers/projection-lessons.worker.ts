import {
  runBootstrapLesson,
  runCompositeLesson,
  runCopulaLesson,
  runGarchLesson,
  runJumpDiffusionLesson,
  runRegimeLesson,
  runRetirementLesson,
  runStudentTLesson,
} from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"projection">({
  "jump-diffusion": runJumpDiffusionLesson,
  garch: runGarchLesson,
  "historical-bootstrap": runBootstrapLesson,
  "retirement-sequence": runRetirementLesson,
  "regime-calibration": runRegimeLesson,
  "student-t": runStudentTLesson,
  copulas: runCopulaLesson,
  "composite-market": runCompositeLesson,
});

registerLessonRunners(runners);
