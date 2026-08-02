import type { LessonRunner } from "../labs/lesson-runners";

export const LESSON_WORKER_FAMILIES = {
  projection: [
    "jump-diffusion",
    "garch",
    "historical-bootstrap",
    "retirement-sequence",
    "regime-calibration",
    "student-t",
    "copulas",
    "composite-market",
  ],
  risk: ["var-cvar", "risk-backtesting"],
  construction: [
    "mean-variance",
    "capm",
    "factor-models",
    "risk-parity",
    "kelly",
    "black-litterman",
  ],
  derivatives: [
    "black-scholes",
    "binomial-tree",
    "monte-carlo-options",
    "heston",
    "strategy-builder",
  ],
  "rates-credit": [
    "vasicek",
    "cir",
    "nelson-siegel",
    "hazard-credit",
    "merton-credit",
  ],
  trading: [
    "ornstein-uhlenbeck",
    "order-book",
    "agent-market",
    "optimal-execution",
  ],
} as const;

export type LessonWorkerFamily = keyof typeof LESSON_WORKER_FAMILIES;

type LessonIdForFamily<Family extends LessonWorkerFamily> =
  (typeof LESSON_WORKER_FAMILIES)[Family][number];

const WORKER_FAMILY_BY_LESSON = new Map<string, LessonWorkerFamily>(
  (
    Object.entries(LESSON_WORKER_FAMILIES) as readonly [
      LessonWorkerFamily,
      readonly string[],
    ][]
  ).flatMap(([family, lessonIds]) =>
    lessonIds.map((lessonId) => [lessonId, family] as const),
  ),
);

export function lessonWorkerFamily(lessonId: string): LessonWorkerFamily {
  const family = WORKER_FAMILY_BY_LESSON.get(lessonId);
  if (!family) {
    throw new Error(`No worker family is registered for lesson ${lessonId}.`);
  }
  return family;
}

export function defineLessonRunners<Family extends LessonWorkerFamily>(
  runners: Readonly<Record<LessonIdForFamily<Family>, LessonRunner>>,
): Readonly<Record<LessonIdForFamily<Family>, LessonRunner>> {
  return runners;
}
