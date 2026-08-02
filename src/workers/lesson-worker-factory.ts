import { lessonWorkerFamily } from "./lesson-worker-registry";

export function createLessonWorker(lessonId: string): Worker {
  switch (lessonWorkerFamily(lessonId)) {
    case "risk":
      return new Worker(new URL("./risk-lessons.worker.ts", import.meta.url), { type: "module" });
    case "construction":
      return new Worker(new URL("./construction-lessons.worker.ts", import.meta.url), { type: "module" });
    case "derivatives":
      return new Worker(new URL("./derivatives-lessons.worker.ts", import.meta.url), { type: "module" });
    case "rates-credit":
      return new Worker(new URL("./rates-credit-lessons.worker.ts", import.meta.url), { type: "module" });
    case "trading":
      return new Worker(new URL("./trading-lessons.worker.ts", import.meta.url), { type: "module" });
    case "projection":
      return new Worker(new URL("./projection-lessons.worker.ts", import.meta.url), { type: "module" });
  }
}
