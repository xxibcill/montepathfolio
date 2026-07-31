// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_INPUTS } from "../lib/defaults";
import { runSimulation } from "../lib/simulation";
import type {
  SimulationInputs,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../types/simulation";
import { useSimulation } from "./useSimulation";

type SimulationState = ReturnType<typeof useSimulation>;

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage:
    | ((event: MessageEvent<SimulationWorkerResponse>) => void)
    | null = null;
  onerror: (() => void) | null = null;
  readonly requests: SimulationWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: SimulationWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: SimulationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SimulationWorkerResponse>);
  }
}

interface HookHarnessProps {
  capture: (state: SimulationState) => void;
}

function HookHarness({ capture }: HookHarnessProps) {
  capture(useSimulation());
  return null;
}

const FIRST_INPUTS: SimulationInputs = {
  ...DEFAULT_INPUTS,
  horizonYears: 1,
  model: "constant",
  pathCount: 4,
  seed: 101,
};

const SECOND_INPUTS: SimulationInputs = {
  ...FIRST_INPUTS,
  seed: 202,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let state: SimulationState | null = null;

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
  if (root) {
    act(() => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  state = null;
  vi.unstubAllGlobals();
});

describe("useSimulation worker response ownership", () => {
  it.each([
    {
      responseName: "success",
      staleResponse: {
        id: 1,
        result: runSimulation(FIRST_INPUTS),
      } satisfies SimulationWorkerResponse,
    },
    {
      responseName: "error",
      staleResponse: {
        id: 1,
        error: "an older request failed",
      } satisfies SimulationWorkerResponse,
    },
  ])(
    "ignores a stale $responseName response and accepts the current response",
    ({ staleResponse }) => {
      expect(FakeWorker.instances).toHaveLength(1);

      act(() => state!.run(FIRST_INPUTS));
      const firstWorker = FakeWorker.instances[0]!;
      expect(firstWorker.requests).toEqual([{ id: 1, inputs: FIRST_INPUTS }]);

      act(() => state!.run(SECOND_INPUTS));
      const currentWorker = FakeWorker.instances[1]!;
      expect(firstWorker.terminated).toBe(true);
      expect(currentWorker.requests).toEqual([{ id: 2, inputs: SECOND_INPUTS }]);

      act(() => firstWorker.respond(staleResponse));
      expect(state!.status).toBe("running");
      expect(state!.result).toBeNull();
      expect(state!.error).toBeNull();

      const currentResult = runSimulation(SECOND_INPUTS);
      act(() => currentWorker.respond({ id: 2, result: currentResult }));

      expect(state!.status).toBe("ready");
      expect(state!.result).toEqual(currentResult);
      expect(state!.error).toBeNull();

      act(() => firstWorker.respond(staleResponse));
      expect(state!.status).toBe("ready");
      expect(state!.result).toEqual(currentResult);
      expect(state!.error).toBeNull();
    },
  );
});
