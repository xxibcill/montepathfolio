// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerRequest,
  type LessonWorkerResponse,
} from "./lesson-worker-protocol";
import type { LessonOutput } from "./lesson-types";
import QuantLabWorkspace from "./QuantLabWorkspace";

class FakeWorker {
  static instance: FakeWorker;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly requests: LessonWorkerRequest[] = [];

  constructor() {
    FakeWorker.instance = this;
  }

  postMessage(request: LessonWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {}

  respond(output: LessonOutput): void {
    const request = this.requests.at(-1)!;
    const response: LessonWorkerResponse = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId: request.requestId,
      ok: true,
      output,
    };
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

function output(label: string, first: string, second: string): LessonOutput {
  return {
    resultContract: "fixture@1",
    headline: `${label} headline`,
    explanation: `${label} explanation`,
    metrics: [
      { label: "Threshold", value: first, detail: "First fixture metric" },
      { label: "Tail", value: second, detail: "Second fixture metric" },
    ],
    series: [
      {
        name: label,
        points: [{ x: 0, y: Number(first) }, { x: 1, y: Number(second) }],
      },
    ],
    chartAxes: { xLabel: "Step", yLabel: "Value" },
    diagnostics: [],
    warnings: [],
    provenance: ["Fixture engine"],
    compactSummary: {},
  };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.localStorage.setItem(
    "montepathfolio/scenario/risk@3",
    JSON.stringify({
      contract: "educational-scenario@3",
      lab: "risk",
      lessonId: "var-cvar",
      inputs: {
        confidence: 0.9,
        portfolioValue: 100_000,
        volatility: 0.012,
        holdingPeriods: 1,
      },
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <QuantLabWorkspace lab="risk" initialLessonId="var-cvar" />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("QuantLabWorkspace comparisons", () => {
  it("gates stale actions and preserves the complete prior result", () => {
    act(() => FakeWorker.instance.respond(output("Previous", "1", "2")));

    const reset = container.querySelector(
      'button[aria-label="Reset lesson inputs"]',
    ) as HTMLButtonElement;
    act(() => reset.click());
    const summary = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Summary"),
    )!;
    expect(summary.disabled).toBe(true);

    const run = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Run experiment"),
    )!;
    act(() => run.click());
    act(() => FakeWorker.instance.respond(output("Current", "3", "4")));

    const comparison = container.querySelector(".cause-effect-note")!;
    expect(comparison.textContent).toContain("Previous: 1");
    expect(comparison.textContent).toContain("Current: 3");
    expect(comparison.textContent).toContain("Previous: 2");
    expect(comparison.textContent).toContain("Current: 4");
    expect(comparison.textContent).toContain("View prior run chart");
  });
});
