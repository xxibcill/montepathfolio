import {
  runCirLesson,
  runHazardLesson,
  runLessonWithRunners,
  runMertonCreditLesson,
  runNelsonSiegelLesson,
  runVasicekLesson,
} from "../labs/lesson-runners";
import { registerLessonWorker } from "./register-lesson-worker";

const runners = {
  vasicek: runVasicekLesson,
  cir: runCirLesson,
  "nelson-siegel": runNelsonSiegelLesson,
  "hazard-credit": runHazardLesson,
  "merton-credit": runMertonCreditLesson,
};
registerLessonWorker((id, values, attachment, snapshot) =>
  runLessonWithRunners(id, values, runners, attachment, snapshot),
);
