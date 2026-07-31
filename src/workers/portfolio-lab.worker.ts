/// <reference lib="webworker" />

import { createInProcessPortfolioLabRunner } from "../lib/portfolio-lab/in-process-runner";
import {
  PORTFOLIO_LAB_WORKER_PROTOCOL,
  type PortfolioLabWorkerRequest,
  type PortfolioLabWorkerResponse,
} from "../lib/portfolio-lab/worker-protocol";
import type { PortfolioLabRun } from "../lib/portfolio-lab/contracts";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const runner = createInProcessPortfolioLabRunner();
const activeRuns = new Map<number, PortfolioLabRun>();

workerScope.addEventListener(
  "message",
  (event: MessageEvent<PortfolioLabWorkerRequest>) => {
    const message = event.data;
    if (message.contract !== PORTFOLIO_LAB_WORKER_PROTOCOL) return;

    if (message.kind === "cancel") {
      activeRuns.get(message.runId)?.cancel();
      return;
    }

    const run = runner.run(message.request);
    activeRuns.set(message.runId, run);
    void run.outcome.then((outcome) => {
      if (activeRuns.get(message.runId) !== run) return;
      activeRuns.delete(message.runId);
      const response: PortfolioLabWorkerResponse = {
        contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
        kind: "outcome",
        runId: message.runId,
        outcome,
      };
      workerScope.postMessage(response);
    });
  },
);
