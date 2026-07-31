import { DEFAULT_LESSONS, LAB_IDS, type LabId } from "./lab-registry";

export { LAB_IDS } from "./lab-registry";
export type { LabId } from "./lab-registry";

export type LabRoute =
  | { readonly kind: "home" }
  | {
      readonly kind: "lab";
      readonly lab: LabId;
      readonly lesson: string;
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
