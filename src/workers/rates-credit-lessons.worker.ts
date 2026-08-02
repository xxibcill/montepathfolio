import {
  runCirLesson,
  runHazardLesson,
  runMertonCreditLesson,
  runNelsonSiegelLesson,
  runVasicekLesson,
} from "../labs/lesson-runners";
import { defineLessonRunners } from "./lesson-worker-registry";
import { registerLessonRunners } from "./register-lesson-worker";

const runners = defineLessonRunners<"rates-credit">({
  vasicek: runVasicekLesson,
  cir: runCirLesson,
  "nelson-siegel": runNelsonSiegelLesson,
  "hazard-credit": runHazardLesson,
  "merton-credit": runMertonCreditLesson,
});

registerLessonRunners(runners);
