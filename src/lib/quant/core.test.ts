import { describe, expect, it } from "vitest";
import {
  cholesky,
  correlation,
  createSemanticRandom,
  factorCorrelationMatrix,
  inverseNormalCdf,
  matrixMultiply,
  mean,
  normalCdf,
  populationVariance,
  projectOntoSimplex,
  quantile,
  solveLinearSystem,
  studentTCdf,
} from "./core";

describe("quantitative core", () => {
  it("calculates stable descriptive statistics", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(populationVariance([1, 2, 3, 4])).toBe(1.25);
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });

  it("solves and factors small matrices", () => {
    expect(solveLinearSystem([[2, 1], [1, 3]], [5, 6])).toEqual([
      1.8,
      1.4,
    ]);
    const lower = cholesky([[4, 2], [2, 3]]);
    const rebuilt = matrixMultiply(lower, [
      [lower[0][0], lower[1][0]],
      [lower[0][1], lower[1][1]],
    ]);
    expect(rebuilt[0][0]).toBeCloseTo(4, 12);
    expect(rebuilt[0][1]).toBeCloseTo(2, 12);
    expect(rebuilt[1][1]).toBeCloseTo(3, 12);
  });

  it("distinguishes correlation matrices from arbitrary PSD matrices", () => {
    expect(factorCorrelationMatrix([[1, 0.4], [0.4, 1]])).toHaveLength(2);
    expect(() => factorCorrelationMatrix([[4, 0], [0, 4]])).toThrow(/ones/);
    expect(() => factorCorrelationMatrix([[1, 1.2], [1.2, 1]])).toThrow(
      /between -1 and 1/,
    );
  });

  it("projects candidate allocations onto the fully invested simplex", () => {
    const weights = projectOntoSimplex([0.9, -0.2, 0.8]);
    expect(weights.reduce((total, value) => total + value, 0)).toBeCloseTo(1);
    expect(weights.every((value) => value >= 0)).toBe(true);
  });

  it("round-trips normal probabilities", () => {
    for (const probability of [0.01, 0.1, 0.5, 0.9, 0.99]) {
      expect(normalCdf(inverseNormalCdf(probability))).toBeCloseTo(
        probability,
        6,
      );
    }
  });

  it("evaluates symmetric Student-t probabilities", () => {
    expect(studentTCdf(0, 5)).toBe(0.5);
    expect(studentTCdf(2.5705818356, 5)).toBeCloseTo(0.975, 6);
    expect(studentTCdf(-2.5705818356, 5)).toBeCloseTo(0.025, 6);
  });

  it("uses deterministic isolated semantic random addresses", () => {
    const random = createSemanticRandom(42, "lesson");
    const first = random.normal("path", 1, "step", 2);
    random.poisson(3, "unrelated");
    expect(random.normal("path", 1, "step", 2)).toBe(first);
    expect(createSemanticRandom(42, "lesson").normal("path", 1, "step", 2)).toBe(
      first,
    );
    expect(random.normal("path", 1, "step", 3)).not.toBe(first);
  });

  it("samples finite Poisson, gamma, and Student-t values", () => {
    const random = createSemanticRandom(7, "distributions");
    expect(random.poisson(0, "zero")).toBe(0);
    expect(random.poisson(4, "count")).toBeGreaterThanOrEqual(0);
    expect(random.poisson(100, "large-count")).toBeGreaterThanOrEqual(0);
    expect(random.gamma(2, 3, "gamma")).toBeGreaterThan(0);
    expect(Number.isFinite(random.studentT(5, "t"))).toBe(true);
  });
});
