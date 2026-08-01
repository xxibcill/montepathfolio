import {
  runBootstrapLesson,
  runCompositeLesson,
  runCopulaLesson,
  runGarchLesson,
  runJumpDiffusionLesson,
  runLessonWithRunners,
  runRegimeLesson,
  runRetirementLesson,
  runStudentTLesson,
} from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = {
  "jump-diffusion": runJumpDiffusionLesson,
  garch: runGarchLesson,
  "historical-bootstrap": runBootstrapLesson,
  "retirement-sequence": runRetirementLesson,
  "regime-calibration": runRegimeLesson,
  "student-t": runStudentTLesson,
  copulas: runCopulaLesson,
  "composite-market": runCompositeLesson,
};
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
