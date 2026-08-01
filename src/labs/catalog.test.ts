import { describe, expect, it } from "vitest";
import { getLesson, isKnownLesson, LABS, LESSONS } from "./catalog";
import { runLesson } from "./lesson-runners";
import { LESSON_DATA_ATTACHMENT_CONTRACT } from "./lesson-worker-protocol";
import type { LessonDefinition, LessonOutput } from "./lesson-types";

function defaultValues(
  lesson: LessonDefinition,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    lesson.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  );
}

function expectFiniteOutput(output: LessonOutput): void {
  expect(output.resultContract).toMatch(/@\d+$/);
  expect(output.headline.trim()).not.toBe("");
  expect(output.explanation.trim()).not.toBe("");
  expect(output.metrics.length).toBeGreaterThan(0);
  expect(output.provenance.length).toBeGreaterThan(0);
  expect(output.chartAxes?.xLabel.trim()).not.toBe("");
  expect(output.chartAxes?.yLabel.trim()).not.toBe("");

  for (const metric of output.metrics) {
    expect(metric.label.trim()).not.toBe("");
    expect(metric.value.trim()).not.toBe("");
    expect(metric.detail.trim()).not.toBe("");
  }

  for (const series of [
    ...output.series,
    ...(output.additionalCharts?.flatMap((chart) => chart.series) ?? []),
  ]) {
    expect(series.name.trim()).not.toBe("");
    expect(series.points.length).toBeGreaterThan(0);
    for (const point of series.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  }

  for (const chart of output.additionalCharts ?? []) {
    expect(chart.xLabel.trim()).not.toBe("");
    expect(chart.yLabel.trim()).not.toBe("");
  }

  for (const message of [
    ...output.diagnostics,
    ...output.warnings,
    ...output.provenance,
  ]) {
    expect(message.trim()).not.toBe("");
  }

  for (const value of Object.values(output.compactSummary)) {
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
    }
  }

  if (output.table) {
    expect(output.table.caption.trim()).not.toBe("");
    expect(output.table.columns.length).toBeGreaterThan(0);
    for (const row of output.table.rows) {
      expect(row).toHaveLength(output.table.columns.length);
    }
  }
}

function isOnStep(value: number, minimum: number, step: number): boolean {
  const steps = (value - minimum) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

describe("educational lesson catalog", () => {
  it("maps every advanced lesson to exactly one laboratory", () => {
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(
      LESSONS.length,
    );

    for (const lesson of LESSONS) {
      const lab = LABS.find((candidate) => candidate.id === lesson.lab);
      expect(lab?.lessonIds).toContain(lesson.id);
    }
  });

  it("rejects unknown lesson identifiers instead of silently changing lessons", () => {
    expect(isKnownLesson("risk", "not-a-lesson")).toBe(false);
    expect(() => getLesson("risk", "not-a-lesson")).toThrow(/Unknown lesson route/);
  });

  it("keeps non-annual percentages labeled with their actual units", () => {
    const parameter = (lessonId: string, parameterId: string) =>
      LESSONS.find(({ id }) => id === lessonId)!.parameters.find(
        ({ id }) => id === parameterId,
      )!;

    expect(parameter("var-cvar", "volatility").unit).toBe("per-day decimal");
    expect(parameter("capm", "riskFree").unit).toBe(
      "simple decimal per observation",
    );
    expect(parameter("retirement-sequence", "stockAllocation").unit).toBe(
      "portfolio fraction",
    );
    expect(parameter("jump-diffusion", "meanJump").unit).toBe(
      "log return per jump",
    );
  });

  it.each(LESSONS)(
    "runs $id with valid defaults and returns finite educational output",
    (lesson) => {
      for (const parameter of lesson.parameters) {
        expect(parameter.defaultValue).toBeGreaterThanOrEqual(
          parameter.minimum,
        );
        expect(parameter.defaultValue).toBeLessThanOrEqual(parameter.maximum);
        expect(
          isOnStep(parameter.defaultValue, parameter.minimum, parameter.step),
          `${lesson.id}/${parameter.id} default must align with its input step`,
        ).toBe(true);
        if (parameter.choices) {
          expect(new Set(parameter.choices.map(({ value }) => value)).size).toBe(
            parameter.choices.length,
          );
          expect(parameter.choices.some(({ value }) => value === parameter.defaultValue)).toBe(true);
        }
      }

      expect(new Set(lesson.presets.map((preset) => preset.id)).size).toBe(
        lesson.presets.length,
      );
      for (const preset of lesson.presets) {
        for (const [parameterId, value] of Object.entries(preset.values)) {
          const parameter = lesson.parameters.find(({ id }) => id === parameterId);
          expect(parameter, `${lesson.id}/${preset.id}/${parameterId}`).toBeDefined();
          expect(value).toBeGreaterThanOrEqual(parameter!.minimum);
          expect(value).toBeLessThanOrEqual(parameter!.maximum);
          expect(
            isOnStep(value, parameter!.minimum, parameter!.step),
            `${lesson.id}/${preset.id}/${parameterId} must align with its input step`,
          ).toBe(true);
        }
      }
      if (lesson.dataImport) {
        expect(lesson.dataImport.templateFilename).toMatch(/\.csv$/);
        expect(lesson.dataImport.templateCsv.split(/\r?\n/).length).toBeGreaterThan(2);
      }

      expectFiniteOutput(runLesson(lesson.id, defaultValues(lesson)));
    },
    20_000,
  );

  it("rejects incomplete, out-of-range, and unnamed choice payloads", () => {
    const lesson = LESSONS.find(({ id }) => id === "historical-bootstrap")!;
    const defaults = defaultValues(lesson);

    expect(() => runLesson(lesson.id, {})).toThrow(/finite number/i);
    expect(() =>
      runLesson(lesson.id, { ...defaults, steps: 1_000_000 }),
    ).toThrow(/between/i);
    expect(() =>
      runLesson(lesson.id, { ...defaults, bootstrapMethod: 0.5 }),
    ).toThrow(/named choices/i);
  });
});

describe("learner-facing quantitative integrations", () => {
  const run = (
    lessonId: string,
    overrides: Readonly<Record<string, number>> = {},
  ): LessonOutput => {
    const lesson = LESSONS.find((candidate) => candidate.id === lessonId);
    if (!lesson) throw new Error(`Unknown lesson ${lessonId}.`);
    return runLesson(lessonId, { ...defaultValues(lesson), ...overrides });
  };

  it("shows timestamp alignment, rolling windows, and out-of-sample factor attribution", () => {
    const output = run("factor-models", { rollingWindow: 24 });

    expect(output.resultContract).toBe(
      "portfolio-construction/rolling-factor-result@1",
    );
    expect(output.series.map((series) => series.name)).toEqual([
      "Rolling Factor A exposure",
      "Rolling Factor B exposure",
    ]);
    expect(output.table?.caption).toContain("out-of-sample");
    expect(output.diagnostics.join(" ")).toContain("timestamp-intersection");
    expect(output.diagnostics.join(" ")).toContain("Look-ahead guard");
    expect(output.compactSummary.rollingWindowCount).toBeGreaterThan(0);
  });

  it("bounds learner-facing backtest chart detail for large imports", () => {
    const lesson = LESSONS.find(({ id }) => id === "risk-backtesting")!;
    const rows = Array.from({ length: 1_200 }, (_, index) => {
      const date = new Date(Date.UTC(2000, 0, index + 1))
        .toISOString()
        .slice(0, 10);
      return `${date},${index % 19 === 0 ? -0.03 : 0.004}`;
    });
    const output = runLesson(
      lesson.id,
      defaultValues(lesson),
      {
        contract: LESSON_DATA_ATTACHMENT_CONTRACT,
        filename: "large-backtest.csv",
        mediaType: "text/csv",
        text: ["date,Portfolio", ...rows].join("\n"),
      },
    );

    expect(output.series[0].points).toHaveLength(800);
    expect(output.series[1].points).toHaveLength(800);
    expect(output.diagnostics.join(" ")).toContain("of 1140");
  });

  it("compares one European contract across analytical, tree, and Monte Carlo methods", () => {
    const output = run("black-scholes", {
      comparisonSteps: 100,
      comparisonPaths: 2_000,
    });

    expect(output.resultContract).toBe(
      "derivatives/european-pricing-comparison-result@1",
    );
    expect(output.table?.rows.map((row) => row[0])).toEqual([
      "Black–Scholes",
      "CRR",
      "Monte Carlo",
    ]);
    expect(output.diagnostics.join(" ")).toContain(
      "Black–Scholes inside MC interval",
    );
  });

  it("builds bounded Black–Scholes sensitivity slices with the learner-selected dividend yield", () => {
    const output = run("black-scholes", {
      dividendYield: 0.035,
      surfaceDimension: 1,
      comparisonPaths: 2_000,
    });

    expect(output.chartAxes).toMatchObject({
      xLabel: "Annual volatility",
      xUnit: "fraction",
      yLabel: "Call model value",
    });
    expect(output.series[0].name).toContain("volatility");
    expect(output.series[0].points).toHaveLength(61);
    expect(output.series[0].points[0].x).toBeCloseTo(0.01);
    expect(output.compactSummary.dividendYield).toBe(0.035);
    expect(output.compactSummary.surfaceDimension).toBe("volatility");
    expect(output.diagnostics.join(" ")).toContain("61 bounded cells");
  });

  it("separates Heston spot, variance, terminal distribution, and leverage views", () => {
    const output = run("heston", { paths: 500 });

    expect(output.series.map((series) => series.name)).toEqual(["Spot path"]);
    expect(output.additionalCharts?.map((chart) => chart.title)).toEqual([
      "Heston variance path",
      "Heston terminal spot distribution summary",
      "Heston leverage effect on retained paths",
    ]);
    expect(output.additionalCharts?.[1].series[0].points).toHaveLength(5);
    expect(output.additionalCharts?.[2].series[0].style).toBe("points");
    expect(output.compactSummary.terminalSpotPercentile05).toBeLessThan(
      output.compactSummary.terminalSpotPercentile95 as number,
    );
  });

  it("rejects non-finite GARCH wealth output at valid control boundaries", () => {
    expect(() =>
      run("garch", {
        omega: 0.001,
        alpha: 0.5,
        beta: 1.1,
        degreesOfFreedom: 40,
      }),
    ).toThrow(/finite|numerical|wealth/i);
  });

  it("retains bounded small-tree nodes and explains when a large node table is omitted", () => {
    const small = run("binomial-tree", { steps: 20 });
    const large = run("binomial-tree", { steps: 200 });

    expect(small.table?.rows.length).toBeGreaterThan(0);
    expect(small.compactSummary.storedNodeCount).toBeGreaterThan(0);
    expect(large.table).toBeUndefined();
    expect(large.compactSummary.storedNodeCount).toBe(0);
    expect(large.diagnostics.join(" ")).toContain("Node table omitted");
  });

  it("exposes basket and floating-lookback Monte Carlo payoff families", () => {
    const basket = run("monte-carlo-options", { payoff: 4, paths: 500 });
    const floatingLookback = run("monte-carlo-options", {
      payoff: 5,
      paths: 500,
    });

    expect(basket.compactSummary.payoffFamily).toBe(
      "two-asset basket call",
    );
    expect(basket.series).toHaveLength(2);
    expect(floatingLookback.compactSummary.payoffFamily).toBe(
      "floating-strike lookback call",
    );
  });

  it("composes strangles and vertical spreads from validated strategy legs", () => {
    expect(run("strategy-builder", { strategy: 4 }).compactSummary.strategy).toBe(
      "Long strangle",
    );
    expect(run("strategy-builder", { strategy: 5 }).compactSummary.strategy).toBe(
      "Bull call spread",
    );
  });

  it("shows short-rate model comparison, named curve shocks, and hazard policy", () => {
    const shortRates = run("vasicek");
    const curve = run("nelson-siegel");
    const hazard = run("hazard-credit", { curveType: 1 });

    expect(shortRates.resultContract).toBe(
      "rates-credit/short-rate-comparison-result@1",
    );
    expect(shortRates.series.map((series) => series.name)).toEqual([
      "Vasicek median rate",
      "CIR median rate",
    ]);
    expect(curve.series.map((series) => series.name)).toEqual([
      "Fitted base curve",
      "parallel shock",
      "steepen shock",
      "flatten shock",
      "curvature shock",
    ]);
    expect(hazard.compactSummary.hazardCurveKind).toBe(
      "piecewise-constant",
    );
  });

  it("fits OU parameters and reconciles fee-aware book and agent ledgers", () => {
    const ou = run("ornstein-uhlenbeck");
    const book = run("order-book");
    const agents = run("agent-market");

    expect(ou.compactSummary.fittedStationary).toBe(true);
    expect(ou.table?.caption).toContain("Configured model");
    expect(book.compactSummary.feesCharged).toBeGreaterThan(0);
    expect(book.compactSummary.feesPaidDifference).toBeCloseTo(0, 10);
    expect(agents.compactSummary.riskBudget).toBe(2);
    expect(agents.compactSummary.feesCharged).toBeGreaterThan(0);
    expect(agents.diagnostics.join(" ")).toContain("Risk-budget decisions");
  });

  it.each([
    ["garch", "user-imported"],
    ["historical-bootstrap", "user-imported"],
    ["regime-calibration", "user-imported"],
    ["risk-backtesting", "user-imported"],
    ["factor-models", "user-imported"],
  ] as const)("runs %s from its bounded CSV template with provenance", (lessonId, provenanceKind) => {
    const lesson = LESSONS.find((candidate) => candidate.id === lessonId)!;
    const specification = lesson.dataImport!;
    const output = runLesson(
      lesson.id,
      defaultValues(lesson),
      {
        contract: LESSON_DATA_ATTACHMENT_CONTRACT,
        filename: specification.templateFilename,
        mediaType: "text/csv",
        text: specification.templateCsv,
      },
    );
    expectFiniteOutput(output);
    expect(output.provenance.join(" ")).toContain(specification.templateFilename);
    expect(
      String(output.compactSummary.dataKind ?? output.compactSummary.calibrationKind),
    ).toBe(provenanceKind);
  });
});
