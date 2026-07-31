// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INPUTS } from "../lib/defaults";
import type { PortfolioLabOutcome } from "../lib/portfolio-lab/contracts";
import { executeValidatedPortfolioLabRequest } from "../lib/portfolio-lab/engine";
import {
  PORTFOLIO_LAB_WORKER_PROTOCOL,
  type PortfolioLabWorkerRequest,
  type PortfolioLabWorkerResponse,
} from "../lib/portfolio-lab/worker-protocol";
import type { PortfolioProjectionInputs } from "../types/portfolio-projection";
import { useSimulation } from "./useSimulation";

type SimulationState = ReturnType<typeof useSimulation>;

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: PortfolioLabWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PortfolioLabWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(outcome: PortfolioLabOutcome): void {
    const request = this.messages.find((message) => message.kind === "run");
    if (!request) throw new Error("No native portfolio-lab request was posted.");
    const response: PortfolioLabWorkerResponse = {
      contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
      kind: "outcome",
      runId: request.runId,
      outcome,
    };
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

function HookHarness({ capture }: { capture: (state: SimulationState) => void }) {
  capture(useSimulation());
  return null;
}

const FIRST_INPUTS: PortfolioProjectionInputs = {
  ...DEFAULT_INPUTS,
  horizonYears: 1,
  model: "constant",
  pathCount: 4,
  seed: 101,
};

const SECOND_INPUTS: PortfolioProjectionInputs = {
  ...FIRST_INPUTS,
  model: "hmm",
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
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  state = null;
  vi.unstubAllGlobals();
});

describe("useSimulation native portfolio-lab ownership", () => {
  it("posts an explicit GBM/HMM request and presents the selected result", async () => {
    act(() => state!.run(FIRST_INPUTS));

    const worker = FakeWorker.instances[0]!;
    const message = worker.messages[0];
    expect(message).toMatchObject({
      contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
      kind: "run",
      request: {
        contract: "portfolio-lab/request@1",
        primaryCaseId: "portfolio-projection/gbm",
        cases: [
          { id: "portfolio-projection/gbm", model: { kind: "gbm" } },
          { id: "portfolio-projection/hmm", model: { kind: "hmm" } },
        ],
      },
    });
    if (!message || message.kind !== "run") throw new Error("Missing run request.");

    const result = executeValidatedPortfolioLabRequest(message.request);
    await act(async () => {
      worker.respond({ ok: true, result });
      await Promise.resolve();
    });

    expect(state!.status).toBe("ready");
    expect(state!.result).toMatchObject({
      contract: "portfolio-lab/result@1",
      inputs: { model: "constant", seed: 101 },
      provenance: { requestContract: "portfolio-lab/request@1", seed: 101 },
    });
    expect(state!.result!.comparisonMetrics).toHaveProperty("constant");
    expect(state!.result!.comparisonMetrics).toHaveProperty("hmm");
  });

  it("cancels the superseded native run and ignores its late response", async () => {
    act(() => state!.run(FIRST_INPUTS));
    const firstWorker = FakeWorker.instances[0]!;
    const firstMessage = firstWorker.messages[0];
    if (!firstMessage || firstMessage.kind !== "run") {
      throw new Error("Missing first run request.");
    }
    const firstResult = executeValidatedPortfolioLabRequest(firstMessage.request);

    act(() => state!.run(SECOND_INPUTS));
    const currentWorker = FakeWorker.instances[1]!;
    expect(firstWorker.messages.filter((message) => message.kind === "cancel"))
      .toHaveLength(1);
    expect(firstWorker.terminated).toBe(true);

    await act(async () => {
      firstWorker.respond({ ok: true, result: firstResult });
      await Promise.resolve();
    });
    expect(state!.status).toBe("running");
    expect(state!.result).toBeNull();

    const currentMessage = currentWorker.messages[0];
    if (!currentMessage || currentMessage.kind !== "run") {
      throw new Error("Missing current run request.");
    }
    const currentResult = executeValidatedPortfolioLabRequest(
      currentMessage.request,
    );
    await act(async () => {
      currentWorker.respond({ ok: true, result: currentResult });
      await Promise.resolve();
    });

    expect(state!.status).toBe("ready");
    expect(state!.result?.inputs).toMatchObject({ model: "hmm", seed: 202 });
  });
});
