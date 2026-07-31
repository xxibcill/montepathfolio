import type {
  LessonCalibrationSnapshot,
  LessonDefinition,
  LessonOutput,
} from "./lesson-types";
import {
  isLessonCalibrationSnapshot,
  type LessonDataAttachment,
} from "./lesson-worker-protocol";
import type { LabId } from "./routes";

const SCENARIO_CONTRACT = "educational-scenario@3";

export interface StoredLessonScenario {
  readonly values: Record<string, number>;
  readonly calibrationSnapshot: LessonCalibrationSnapshot | null;
  readonly needsDataReattachment: boolean;
}

export function loadLessonScenario(
  lab: LabId,
  lesson: LessonDefinition,
  defaults: Readonly<Record<string, number>>,
): StoredLessonScenario {
  const fallback = {
    values: { ...defaults },
    calibrationSnapshot: null,
    needsDataReattachment: false,
  } satisfies StoredLessonScenario;

  try {
    const raw =
      window.localStorage.getItem(scenarioKey(lab)) ??
      window.localStorage.getItem(`montepathfolio/scenario/${lab}@2`) ??
      window.localStorage.getItem(`montepathfolio/scenario/${lab}@1`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      ![
        "educational-scenario@1",
        "educational-scenario@2",
        SCENARIO_CONTRACT,
      ].includes(String(parsed.contract)) ||
      parsed.lessonId !== lesson.id ||
      !isRecord(parsed.inputs)
    ) {
      return fallback;
    }

    const calibrationSnapshot =
      isLessonCalibrationSnapshot(parsed.calibrationSnapshot) &&
      snapshotMatchesLesson(parsed.calibrationSnapshot, lesson.id)
        ? parsed.calibrationSnapshot
        : null;
    return {
      values: validatedValues(lesson, parsed.inputs, defaults),
      calibrationSnapshot,
      needsDataReattachment:
        !calibrationSnapshot &&
        (parsed.requiresDataReattachment === true ||
          isRecord(parsed.dataReference) ||
          isRecord(parsed.fittedSnapshotReference)),
    };
  } catch {
    return fallback;
  }
}

export function saveLessonScenario(
  lab: LabId,
  lesson: LessonDefinition,
  values: Readonly<Record<string, number>>,
  output: LessonOutput,
  attachment?: LessonDataAttachment,
): void {
  try {
    window.localStorage.setItem(
      scenarioKey(lab),
      JSON.stringify(
        portableLessonScenario(lab, lesson, values, output, attachment),
      ),
    );
  } catch {
    // Persistence is optional; the running experiment remains usable.
  }
}

export function portableLessonScenario(
  lab: LabId,
  lesson: LessonDefinition,
  values: Readonly<Record<string, number>>,
  output: LessonOutput,
  attachment?: LessonDataAttachment,
): Record<string, unknown> {
  return {
    contract: SCENARIO_CONTRACT,
    lab,
    lessonId: lesson.id,
    modelContract: output.resultContract,
    engineProvenance: output.provenance,
    dataReference: attachment
      ? {
          sourceContract: attachment.contract,
          filename: attachment.filename,
        }
      : null,
    calibrationSnapshot: output.calibrationSnapshot ?? null,
    requiresDataReattachment: Boolean(
      attachment && !output.calibrationSnapshot,
    ),
    inputs: values,
  };
}

function scenarioKey(lab: LabId): string {
  return `montepathfolio/scenario/${lab}@3`;
}

function snapshotMatchesLesson(
  snapshot: LessonCalibrationSnapshot,
  lessonId: string,
): boolean {
  return (
    (lessonId === "garch" &&
      snapshot.modelContract === "market-model/garch-1-1@1") ||
    (lessonId === "regime-calibration" &&
      snapshot.modelContract === "market-model/ordered-regimes@1")
  );
}

function validatedValues(
  lesson: LessonDefinition,
  inputs: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    lesson.parameters.map((parameter) => {
      const value = inputs[parameter.id];
      return [
        parameter.id,
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= parameter.minimum &&
        value <= parameter.maximum
          ? value
          : defaults[parameter.id],
      ];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
