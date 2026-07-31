import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SimulationInputs,
  SimulationResult,
  SimulationWorkerResponse,
} from "../types/simulation";

export type SimulationStatus = "idle" | "running" | "ready" | "error";

interface SimulationState {
  result: SimulationResult | null;
  previousResult: SimulationResult | null;
  status: SimulationStatus;
  error: string | null;
  run: (inputs: SimulationInputs) => void;
}

export function useSimulation(): SimulationState {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const runningRef = useRef(false);
  const resultRef = useRef<SimulationResult | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [previousResult, setPreviousResult] =
    useState<SimulationResult | null>(null);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const createWorker = useCallback(() => {
    const worker = new Worker(
      new URL("../workers/simulation.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      if (!mountedRef.current || event.data.id !== requestRef.current) {
        return;
      }

      if (event.data.error || !event.data.result) {
        runningRef.current = false;
        setStatus("error");
        setError(
          event.data.error ??
            "The simulation did not return a result. Try running it again.",
        );
        return;
      }

      runningRef.current = false;
      const nextResult = event.data.result;
      const priorResult = resultRef.current;
      if (priorResult) {
        setPreviousResult(priorResult);
      }
      resultRef.current = nextResult;
      setResult(nextResult);
      setStatus("ready");
      setError(null);
    };

    worker.onerror = () => {
      if (!mountedRef.current || workerRef.current !== worker) return;
      runningRef.current = false;
      workerRef.current = null;
      worker.terminate();
      setStatus("error");
      setError(
        "The simulation worker stopped unexpectedly. Run it again to restart the model.",
      );
    };

    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    createWorker();

    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  const run = useCallback((inputs: SimulationInputs) => {
    if (runningRef.current && workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const worker = workerRef.current ?? createWorker();

    const id = requestRef.current + 1;
    requestRef.current = id;
    runningRef.current = true;
    setStatus("running");
    setError(null);
    try {
      worker.postMessage({ id, inputs });
    } catch {
      runningRef.current = false;
      worker.terminate();
      workerRef.current = null;
      setStatus("error");
      setError(
        "The simulation could not start. Run it again to restart the model.",
      );
    }
  }, [createWorker]);

  return { result, previousResult, status, error, run };
}
