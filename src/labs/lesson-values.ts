import { QuantError } from "../lib/quant/core";
import { LESSONS } from "./catalog";

declare const lessonValuesBrand: unique symbol;

/** Numeric worker payload validated against one catalog lesson. */
export type LessonValues = Readonly<Record<string, number>> & {
  readonly [lessonValuesBrand]: true;
};

export function validateLessonValues(
  lessonId: string,
  input: Readonly<Record<string, number>>,
): LessonValues {
  const lesson = LESSONS.find((candidate) => candidate.id === lessonId);
  if (!lesson) {
    throw new QuantError(
      "INVALID_INPUT",
      `No educational runner is registered for ${lessonId}.`,
      "lessonId",
    );
  }

  const parameterIds = new Set(lesson.parameters.map(({ id }) => id));
  const unknownParameter = Object.keys(input).find((id) => !parameterIds.has(id));
  if (unknownParameter) {
    throw new QuantError(
      "INVALID_INPUT",
      `Unknown parameter ${unknownParameter} for lesson ${lessonId}.`,
      `values.${unknownParameter}`,
    );
  }

  const values = Object.fromEntries(
    lesson.parameters.map((parameter) => {
      const value = input[parameter.id];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new QuantError(
          "NON_FINITE",
          `${parameter.label} must be a finite number.`,
          `values.${parameter.id}`,
        );
      }
      if (value < parameter.minimum || value > parameter.maximum) {
        throw new QuantError(
          "OUT_OF_RANGE",
          `${parameter.label} must be between ${parameter.minimum} and ${parameter.maximum}.`,
          `values.${parameter.id}`,
        );
      }
      if (
        parameter.choices &&
        !parameter.choices.some((choice) => choice.value === value)
      ) {
        throw new QuantError(
          "INVALID_INPUT",
          `${parameter.label} must be one of its named choices.`,
          `values.${parameter.id}`,
        );
      }
      if (parameter.format === "integer" && !Number.isSafeInteger(value)) {
        throw new QuantError(
          "INVALID_INPUT",
          `${parameter.label} must be an integer.`,
          `values.${parameter.id}`,
        );
      }
      return [parameter.id, value];
    }),
  );

  return values as LessonValues;
}
