import { describe, expect, it } from "vitest";

import { comparisonDirection } from "./model-comparison";

describe("model comparison direction", () => {
  it("classifies negative deltas from their numeric value", () => {
    expect(comparisonDirection(-0.01, false)).toBe("adverse");
    expect(comparisonDirection(-0.01, true)).toBe("favorable");
  });

  it("keeps zero and unavailable deltas neutral", () => {
    expect(comparisonDirection(0, false)).toBe("neutral");
    expect(comparisonDirection(null, true)).toBe("neutral");
  });
});
