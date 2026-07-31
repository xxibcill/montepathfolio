import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimulationInputs } from "../types/simulation";
import { DEFAULT_INPUTS, loadStoredInputs, STORAGE_KEY } from "./defaults";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stored input migration", () => {
  it("keeps legacy v1 scenarios on the constant model", () => {
    const legacyInputs: Partial<SimulationInputs> = { ...DEFAULT_INPUTS };
    delete legacyInputs.hmm;
    delete legacyInputs.model;
    const getItem = vi.fn((key: string) =>
      key === STORAGE_KEY ? JSON.stringify(legacyInputs) : null,
    );
    vi.stubGlobal("window", { localStorage: { getItem } });

    const migrated = loadStoredInputs();

    expect(migrated.model).toBe("constant");
    expect(migrated.hmm).toEqual(DEFAULT_INPUTS.hmm);
  });

  it("preserves an explicitly stored model selection", () => {
    const getItem = vi.fn(() =>
      JSON.stringify({ ...DEFAULT_INPUTS, model: "hmm" }),
    );
    vi.stubGlobal("window", { localStorage: { getItem } });

    expect(loadStoredInputs().model).toBe("hmm");
  });
});
