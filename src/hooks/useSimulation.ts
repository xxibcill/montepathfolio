import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioLabRun } from "../lib/portfolio-lab/contracts";
import { createWebWorkerPortfolioLabRunner } from "../lib/portfolio-lab/worker-runner";
import {
  buildPortfolioProjectionRequest,
  presentPortfolioProjectionResult,
  type PortfolioProjectionResult,
} from "../labs/portfolio-projection-model";
import type { PortfolioProjectionInputs } from "../types/portfolio-projection";

export type SimulationStatus = "idle" | "running" | "ready" | "error";

interface SimulationState {
  result: PortfolioProjectionResult | null;
  previousResult: PortfolioProjectionResult | null;
  status: SimulationStatus;
  error: string | null;
  run: (inputs: PortfolioProjectionInputs) => void;
}

const runner = createWebWorkerPortfolioLabRunner();

export function useSimulation(): SimulationState {
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const activeRunRef = useRef<PortfolioLabRun | null>(null);
  const resultRef = useRef<PortfolioProjectionResult | null>(null);
  const [result, setResult] = useState<PortfolioProjectionResult | null>(null);
  const [previousResult, setPreviousResult] =
    useState<PortfolioProjectionResult | null>(null);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      activeRunRef.current?.cancel();
      activeRunRef.current = null;
    };
  }, []);

  const run = useCallback((inputs: PortfolioProjectionInputs) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    activeRunRef.current?.cancel();
    setStatus("running");
    setError(null);

    let nextRun: PortfolioLabRun;
    try {
      nextRun = runner.run(buildPortfolioProjectionRequest(inputs));
    } catch {
      setStatus("error");
      setError("The simulation could not start. Check the scenario and try again.");
      return;
    }

    activeRunRef.current = nextRun;
    void nextRun.outcome.then((outcome) => {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      activeRunRef.current = null;

      if (!outcome.ok) {
        setStatus("error");
        setError(formatProblem(outcome.problem.code, outcome.problem.message));
        return;
      }

      try {
        const nextResult = presentPortfolioProjectionResult(
          outcome.result,
          inputs,
        );
        const priorResult = resultRef.current;
        if (priorResult) setPreviousResult(priorResult);
        resultRef.current = nextResult;
        setResult(nextResult);
        setStatus("ready");
        setError(null);
      } catch {
        setStatus("error");
        setError("The simulation returned an incomplete comparison. Try again.");
      }
    });
  }, []);

  return { result, previousResult, status, error, run };
}

function formatProblem(code: string, message: string): string {
  if (code === "CANCELLED") return "The simulation was cancelled.";
  return `${message} (${code})`;
}
