// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonChart } from "./LessonChart";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("LessonChart accessible fallback", () => {
  it("renders a bounded tabular alternative with point notes", () => {
    const points = Array.from({ length: 500 }, (_, index) => ({
      x: index,
      y: index ** 2,
      ...(index === 0 ? { label: "initial value" } : {}),
    }));
    act(() => {
      root!.render(
        <LessonChart
          title="Quadratic classroom fixture"
          xLabel="Observation"
          xUnit="index"
          yLabel="Squared value"
          yUnit="units²"
          series={[{ name: "Fixture", points }]}
        />,
      );
    });

    expect(container!.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(container!.querySelector("svg desc")?.textContent).toContain(
      "Horizontal axis: Observation (index). Vertical axis: Squared value (units²).",
    );
    expect(container!.querySelector("svg")?.textContent).toContain("Observation (index)");
    expect(container!.querySelector("svg")?.textContent).toContain("Squared value (units²)");
    expect(container!.querySelector("details summary")?.textContent).toMatch(
      /View chart values/,
    );
    const rows = container!.querySelectorAll("tbody tr");
    expect(rows.length).toBeLessThanOrEqual(120);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows[0].textContent).toContain("initial value");
    expect(rows[rows.length - 1].textContent).toContain("499");
    const headings = [...container!.querySelectorAll("thead th")].map((heading) => heading.textContent);
    expect(headings).toContain("Observation (index)");
    expect(headings).toContain("Squared value (units²)");
  });
});
