import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type PortfolioLabOutcome,
  type PortfolioLabRequest,
} from "./contracts";
import { createWebWorkerPortfolioLabRunner } from "./worker-runner";
import {
  PORTFOLIO_LAB_WORKER_PROTOCOL,
  type PortfolioLabWorkerRequest,
  type PortfolioLabWorkerResponse,
} from "./worker-protocol";

const request: PortfolioLabRequest = {
  contract: PORTFOLIO_LAB_CONTRACT.request,
  plan: {
    initialCapital: 100,
    contributionPerStep: 0,
    targetWeights: { stocks: 1, bonds: 0 },
    rebalance: { kind: "never" },
    annualInflationRate: 0,
    targetValue: 100,
  },
  primaryCaseId: asPortfolioCaseId("gbm"),
  cases: [
    {
      id: asPortfolioCaseId("gbm"),
      label: "GBM",
      model: {
        contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
        kind: "gbm",
        market: {
          stocks: { annualDrift: 0.05, annualVolatility: 0.2 },
          bonds: { annualDrift: 0.02, annualVolatility: 0.05 },
          correlation: 0,
        },
      },
    },
  ],
  execution: { seed: 1, paths: 2, steps: 2, stepYears: 1 / 12 },
};

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: PortfolioLabWorkerRequest[] = [];
  terminated = false;

  postMessage(message: PortfolioLabWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(outcome: PortfolioLabOutcome): void {
    const run = this.messages.find((message) => message.kind === "run");
    if (!run) throw new Error("No run message was posted.");
    const response: PortfolioLabWorkerResponse = {
      contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
      kind: "outcome",
      runId: run.runId,
      outcome,
    };
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }
}

describe("Web Worker portfolio-lab runner", () => {
  it("sends native requests and resolves structured outcomes", async () => {
    const worker = new FakeWorker();
    const run = createWebWorkerPortfolioLabRunner(() => worker).run(request);
    expect(worker.messages[0]).toMatchObject({
      contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
      kind: "run",
      request,
    });
    worker.respond({
      ok: false,
      problem: {
        contract: PORTFOLIO_LAB_CONTRACT.problem,
        code: "NUMERICAL_FAILURE",
        message: "Illustrative failure",
        caseId: asPortfolioCaseId("gbm"),
      },
    });
    expect(await run.outcome).toMatchObject({
      ok: false,
      problem: { code: "NUMERICAL_FAILURE" },
    });
    expect(worker.terminated).toBe(true);
  });

  it("cancels idempotently and ignores stale worker responses", async () => {
    const worker = new FakeWorker();
    const run = createWebWorkerPortfolioLabRunner(() => worker).run(request);
    run.cancel();
    run.cancel();
    expect(worker.messages.filter((message) => message.kind === "cancel")).toHaveLength(1);
    expect(await run.outcome).toMatchObject({
      ok: false,
      problem: { code: "CANCELLED" },
    });
    expect(worker.terminated).toBe(true);
  });

  it("maps worker startup and receive failures to structured problems", async () => {
    const startup = createWebWorkerPortfolioLabRunner(() => {
      throw new Error("blocked");
    }).run(request);
    expect(await startup.outcome).toMatchObject({
      ok: false,
      problem: { code: "WORKER_FAILURE", phase: "START" },
    });

    const worker = new FakeWorker();
    const receive = createWebWorkerPortfolioLabRunner(() => worker).run(request);
    worker.onmessage?.({ data: { broken: true } } as MessageEvent<unknown>);
    expect(await receive.outcome).toMatchObject({
      ok: false,
      problem: { code: "WORKER_FAILURE", phase: "RECEIVE" },
    });
  });
});
