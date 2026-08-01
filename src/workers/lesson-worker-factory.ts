export function createLessonWorker(lessonId: string): Worker {
  if (["var-cvar", "risk-backtesting"].includes(lessonId)) {
    return new Worker(new URL("./risk-lessons.worker.ts", import.meta.url), { type: "module" });
  }
  if (["mean-variance", "capm", "factor-models", "risk-parity", "kelly", "black-litterman"].includes(lessonId)) {
    return new Worker(new URL("./construction-lessons.worker.ts", import.meta.url), { type: "module" });
  }
  if (["black-scholes", "binomial-tree", "monte-carlo-options", "heston", "strategy-builder"].includes(lessonId)) {
    return new Worker(new URL("./derivatives-lessons.worker.ts", import.meta.url), { type: "module" });
  }
  if (["vasicek", "cir", "nelson-siegel", "hazard-credit", "merton-credit"].includes(lessonId)) {
    return new Worker(new URL("./rates-credit-lessons.worker.ts", import.meta.url), { type: "module" });
  }
  if (["ornstein-uhlenbeck", "order-book", "agent-market", "optimal-execution"].includes(lessonId)) {
    return new Worker(new URL("./trading-lessons.worker.ts", import.meta.url), { type: "module" });
  }
  return new Worker(new URL("./projection-lessons.worker.ts", import.meta.url), { type: "module" });
}
