import { describe, expect, it } from "vitest";

import { formatProbability, niceCeiling } from "./chart";

describe("chart utilities", () => {
  it("rounds chart ceilings to readable steps", () => {
    expect(niceCeiling(860_000)).toBe(1_000_000);
    expect(niceCeiling(42, 3)).toBe(60);
    expect(niceCeiling(0)).toBe(1);
  });

  it("clamps displayed probabilities to their valid range", () => {
    expect(formatProbability(-0.2)).toBe("0%");
    expect(formatProbability(0.426)).toBe("43%");
    expect(formatProbability(1.4)).toBe("100%");
  });
});
