import { describe, expect, it } from "vitest";

import type { SimulationInputs } from "../types/simulation";
import { DEFAULT_INPUTS } from "./defaults";
import {
  changedFields,
  primaryChange,
  reasonForChange,
} from "./comparison";

describe("scenario comparison copy", () => {
  it("names every assumption changed in one debounced run", () => {
    const before = createInputs();
    const after = createInputs({
      monthlyContribution: 1_500,
      stockAllocation: 0.6,
      inflationRate: 0.03,
    });
    const changes = changedFields(before, after);

    expect(changes).toEqual([
      "monthlyContribution",
      "stockAllocation",
      "inflationRate",
    ]);
    expect(primaryChange(before, after, changes)).toBe(
      "Changing monthly contributions, stock allocation, and inflation",
    );
  });

  it("describes a stock allocation increase from the configured assumptions", () => {
    const before = createInputs({
      stockAllocation: 0.5,
      stocks: { expectedReturn: 0.03, volatility: 0.06 },
      bonds: { expectedReturn: 0.07, volatility: 0.14 },
    });
    const after = { ...before, stockAllocation: 0.7 };
    const changes = changedFields(before, after);

    expect(reasonForChange(before, after, changes)).toBe(
      "This increases exposure to stocks, which have the lower expected return and lower volatility in this scenario.",
    );
  });

  it("describes a stock allocation reduction as increased bond exposure", () => {
    const before = createInputs({
      stockAllocation: 0.8,
      stocks: { expectedReturn: 0.05, volatility: 0.1 },
      bonds: { expectedReturn: 0.05, volatility: 0.1 },
    });
    const after = { ...before, stockAllocation: 0.4 };
    const changes = changedFields(before, after);

    expect(reasonForChange(before, after, changes)).toBe(
      "This increases exposure to bonds, which have the same expected return and same volatility in this scenario.",
    );
  });

  it("distinguishes model selection from transition persistence", () => {
    const before = createInputs({ model: "constant" });
    const selectedHMM = createInputs({ model: "hmm" });
    const transitionChanged = {
      ...selectedHMM,
      hmm: {
        ...selectedHMM.hmm,
        transitionMatrix: {
          ...selectedHMM.hmm.transitionMatrix,
          bull: { bull: 0.9, bear: 0.03, sideways: 0.07 },
        },
      },
    };

    expect(changedFields(before, selectedHMM)).toEqual(["model"]);
    expect(
      primaryChange(before, selectedHMM, changedFields(before, selectedHMM)),
    ).toBe("Switching on regime changes");
    expect(changedFields(selectedHMM, transitionChanged)).toEqual([
      "regimeTransition",
    ]);
  });
});

function createInputs(
  overrides: Partial<SimulationInputs> = {},
): SimulationInputs {
  return {
    ...DEFAULT_INPUTS,
    ...overrides,
    stocks: { ...DEFAULT_INPUTS.stocks, ...overrides.stocks },
    bonds: { ...DEFAULT_INPUTS.bonds, ...overrides.bonds },
  };
}
