// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LESSON_DATA_ATTACHMENT_CONTRACT,
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerRequest,
  type LessonWorkerResponse,
} from "../labs/lesson-worker-protocol";
import type { LessonOutput } from "../labs/lesson-types";
import { useLessonWorker } from "./useLessonWorker";

type LessonState = ReturnType<typeof useLessonWorker>;

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly requests: LessonWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: LessonWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: LessonWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

function fixtureOutput(label: string): LessonOutput {
  return {
    resultContract: `fixture/${label}@1`,
    headline: label,
    explanation: "Deterministic worker fixture.",
    metrics: [],
    series: [],
    diagnostics: [],
    warnings: [],
    provenance: [],
    compactSummary: { label },
  };
}

function success(requestId: number, label: string): LessonWorkerResponse {
  return {
    contract: LESSON_WORKER_PROTOCOL,
    requestId,
    ok: true,
    output: fixtureOutput(label),
  };
}

function HookHarness({ capture }: { readonly capture: (state: LessonState) => void }) {
  capture(useLessonWorker("fixture-lesson", { parameter: 1 }));
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let state: LessonState | null = null;

beforeEach(() => {
  FakeWorker.instances = [];
  state = null;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<HookHarness capture={(nextState) => (state = nextState)} />);
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  state = null;
  vi.unstubAllGlobals();
});

describe("useLessonWorker request ownership", () => {
  it("ignores a stale response and retains a fair previous-run comparison", () => {
    const worker = FakeWorker.instances[0]!;
    expect(worker.requests[0].requestId).toBe(1);

    act(() => worker.respond(success(1, "initial")));
    expect(state!.status).toBe("current");

    act(() => state!.run({ parameter: 2 }));
    act(() =>
      state!.run(
        { parameter: 3 },
        {
          contract: LESSON_DATA_ATTACHMENT_CONTRACT,
          filename: "fixture.csv",
          mediaType: "text/csv",
          text: "date,value\n2026-01-01,0.01",
        },
      ),
    );
    expect(worker.requests.slice(1).map((request) => request.requestId)).toEqual([2, 3]);
    expect(worker.requests[2].attachment?.filename).toBe("fixture.csv");

    act(() => worker.respond(success(2, "stale")));
    expect(state!.status).toBe("running");
    expect(state!.output.headline).toBe("initial");

    act(() => worker.respond(success(3, "current")));
    expect(state!.status).toBe("current");
    expect(state!.output.headline).toBe("current");
    expect(state!.previous?.output.headline).toBe("initial");
    expect(state!.previous?.values).toEqual({ parameter: 1 });

    act(() => state!.run({ parameter: 4 }));
    act(() => worker.respond(success(4, "after-attachment")));
    expect(state!.previous?.attachment?.filename).toBe("fixture.csv");
    expect(state!.previous?.values).toEqual({ parameter: 3 });
  });

  it("terminates on cancel, ignores late messages, and can restart", () => {
    const firstWorker = FakeWorker.instances[0]!;
    act(() => state!.cancel());
    expect(firstWorker.terminated).toBe(true);
    expect(state!.error).toMatch(/cancelled/i);

    act(() => firstWorker.respond(success(1, "late")));
    expect(state!.output.headline).toMatch(/Calculating/);

    act(() => state!.run({ parameter: 4 }));
    const replacement = FakeWorker.instances[1]!;
    expect(replacement.requests[0].requestId).toBe(2);
    act(() => replacement.respond(success(2, "restarted")));
    expect(state!.output.headline).toBe("restarted");
    expect(state!.error).toBeNull();
  });
});
