import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_COMPARISON_GROUP,
  PORTFOLIO_RANDOM_STREAM_VERSION,
  semanticNormalAt,
  semanticUniformAt,
} from "./semantic-random";

const ADDRESS = {
  seed: 8_291,
  comparisonGroup: PORTFOLIO_COMPARISON_GROUP,
  pathIndex: 3,
  stepIndex: 7,
} as const;

describe("semantic portfolio random streams", () => {
  it("publishes a stable stream version and comparison group", () => {
    expect(PORTFOLIO_RANDOM_STREAM_VERSION).toBe("semantic-keyed-streams@1");
    expect(PORTFOLIO_COMPARISON_GROUP).toBe("portfolio-lab/request@1");
  });

  it("returns the same draw for the same semantic address", () => {
    expect(semanticNormalAt(ADDRESS, "diffusion/stocks")).toBe(
      semanticNormalAt(ADDRESS, "diffusion/stocks"),
    );
    expect(semanticUniformAt(ADDRESS, "regime/transition")).toBe(
      semanticUniformAt(ADDRESS, "regime/transition"),
    );
  });

  it("keeps version-one golden draws stable", () => {
    expect(semanticNormalAt(ADDRESS, "diffusion/stocks")).toBe(
      -0.6095292886392938,
    );
    expect(semanticNormalAt(ADDRESS, "diffusion/bonds-independent")).toBe(
      -0.6744929714370318,
    );
    expect(semanticUniformAt(ADDRESS, "regime/initial")).toBe(
      0.6073885982623324,
    );
    expect(semanticUniformAt(ADDRESS, "regime/transition")).toBe(
      0.2632859587902203,
    );
  });

  it("isolates draws by comparison group, path, step, and stream role", () => {
    const draws = [
      semanticNormalAt(ADDRESS, "diffusion/stocks"),
      semanticNormalAt(ADDRESS, "diffusion/bonds-independent"),
      semanticNormalAt(
        { ...ADDRESS, comparisonGroup: "portfolio-lab/independent-check" },
        "diffusion/stocks",
      ),
      semanticNormalAt(
        { ...ADDRESS, pathIndex: ADDRESS.pathIndex + 1 },
        "diffusion/stocks",
      ),
      semanticNormalAt(
        { ...ADDRESS, stepIndex: ADDRESS.stepIndex + 1 },
        "diffusion/stocks",
      ),
    ];

    expect(new Set(draws)).toHaveLength(draws.length);
  });

  it("does not alias negative seeds with unsigned counterparts", () => {
    const negativeSeedAddress = { ...ADDRESS, seed: -1 };
    const unsignedSeedAddress = { ...ADDRESS, seed: 0xffff_ffff };

    expect(
      semanticNormalAt(negativeSeedAddress, "diffusion/stocks"),
    ).not.toBe(semanticNormalAt(unsignedSeedAddress, "diffusion/stocks"));
    expect(
      semanticUniformAt(negativeSeedAddress, "regime/initial"),
    ).not.toBe(semanticUniformAt(unsignedSeedAddress, "regime/initial"));
  });

  it("does not let unrelated draws shift an existing address", () => {
    const expected = semanticNormalAt(ADDRESS, "diffusion/stocks");

    semanticUniformAt(ADDRESS, "regime/initial");
    semanticUniformAt(ADDRESS, "regime/transition");
    semanticNormalAt(ADDRESS, "diffusion/bonds-independent");

    expect(semanticNormalAt(ADDRESS, "diffusion/stocks")).toBe(expected);
  });

  it("returns finite normal draws and open-interval uniforms", () => {
    const normal = semanticNormalAt(ADDRESS, "diffusion/stocks");
    const uniform = semanticUniformAt(ADDRESS, "regime/transition");

    expect(Number.isFinite(normal)).toBe(true);
    expect(uniform).toBeGreaterThan(0);
    expect(uniform).toBeLessThan(1);
  });
});
