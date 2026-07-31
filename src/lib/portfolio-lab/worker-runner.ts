import {
  PORTFOLIO_LAB_CONTRACT,
  type CancelledProblem,
  type PortfolioLabOutcome,
  type PortfolioLabProblem,
  type PortfolioLabRunner,
  type WorkerFailureProblem,
} from "./contracts";
import { preflightPortfolioLabRequest } from "./in-process-runner";
import {
  PORTFOLIO_LAB_WORKER_PROTOCOL,
  isPortfolioLabWorkerResponse,
  type PortfolioLabWorkerRequest,
} from "./worker-protocol";

interface WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: PortfolioLabWorkerRequest): void;
  terminate(): void;
}

export type PortfolioLabWorkerFactory = () => WorkerLike;

let nextRunId = 1;

export function createWebWorkerPortfolioLabRunner(
  workerFactory: PortfolioLabWorkerFactory = defaultWorkerFactory,
): PortfolioLabRunner {
  return {
    run(request) {
      const preflightProblem = preflightPortfolioLabRequest(request);
      if (preflightProblem) {
        return settledRun({ ok: false, problem: preflightProblem });
      }

      const runId = nextRunId;
      nextRunId += 1;
      let worker: WorkerLike;
      try {
        worker = workerFactory();
      } catch {
        return settledRun({ ok: false, problem: workerFailure("START") });
      }

      let settled = false;
      let settleOutcome: (outcome: PortfolioLabOutcome) => void = () => undefined;
      const outcome = new Promise<PortfolioLabOutcome>((resolve) => {
        settleOutcome = (value) => {
          if (settled) return;
          settled = true;
          worker.terminate();
          resolve(value);
        };
      });

      worker.onmessage = (event) => {
        if (!isPortfolioLabWorkerResponse(event.data)) {
          settleOutcome({ ok: false, problem: workerFailure("RECEIVE") });
          return;
        }
        if (event.data.runId === runId) settleOutcome(event.data.outcome);
      };
      worker.onerror = () => {
        settleOutcome({ ok: false, problem: workerFailure("CRASH") });
      };
      worker.onmessageerror = () => {
        settleOutcome({ ok: false, problem: workerFailure("RECEIVE") });
      };

      try {
        worker.postMessage({
          contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
          kind: "run",
          runId,
          request,
        });
      } catch {
        settleOutcome({ ok: false, problem: workerFailure("SEND") });
      }

      return {
        outcome,
        cancel() {
          if (settled) return;
          try {
            worker.postMessage({
              contract: PORTFOLIO_LAB_WORKER_PROTOCOL,
              kind: "cancel",
              runId,
            });
          } finally {
            settleOutcome({ ok: false, problem: cancelledProblem() });
          }
        },
      };
    },
  };
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(
    new URL("../../workers/portfolio-lab.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function settledRun(outcome: PortfolioLabOutcome) {
  return {
    outcome: Promise.resolve(outcome),
    cancel() {
      // The run has already reached a terminal state.
    },
  };
}

function cancelledProblem(): CancelledProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "CANCELLED",
    message: "The portfolio-lab run was cancelled.",
  };
}

function workerFailure(
  phase: WorkerFailureProblem["phase"],
): PortfolioLabProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "WORKER_FAILURE",
    message: `The portfolio-lab worker failed during ${phase.toLowerCase()}.`,
    phase,
  };
}
