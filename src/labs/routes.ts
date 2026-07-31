export const LAB_IDS = [
  "portfolio-projection",
  "portfolio-construction",
  "risk",
  "derivatives",
  "rates-credit",
  "trading",
] as const;

export type LabId = (typeof LAB_IDS)[number];

export type LabRoute =
  | { readonly kind: "home" }
  | {
      readonly kind: "lab";
      readonly lab: LabId;
      readonly lesson: string;
    };

const DEFAULT_LESSONS: Readonly<Record<LabId, string>> = {
  "portfolio-projection": "accumulation",
  "portfolio-construction": "mean-variance",
  risk: "var-cvar",
  derivatives: "black-scholes",
  "rates-credit": "vasicek",
  trading: "ornstein-uhlenbeck",
};

export function parseLabRoute(hash: string): LabRoute {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (segments[0] !== "labs" || !isLabId(segments[1])) {
    return { kind: "home" };
  }
  return {
    kind: "lab",
    lab: segments[1],
    lesson: segments[2] || DEFAULT_LESSONS[segments[1]],
  };
}

export function labHref(lab: LabId, lesson?: string): string {
  return `#/labs/${lab}/${lesson ?? DEFAULT_LESSONS[lab]}`;
}

function isLabId(value: string | undefined): value is LabId {
  return LAB_IDS.includes(value as LabId);
}
