import { useCallback, useEffect, useRef, useState } from "react";
import {
  isLessonWorkerResponse,
  LESSON_WORKER_PROTOCOL,
  type LessonDataAttachment,
  type LessonWorkerRequest,
} from "../labs/lesson-worker-protocol";
import type { LessonOutput } from "../labs/lesson-types";

export type LessonRunStatus = "current" | "changed" | "running" | "error";

export interface PreviousLessonRun {
  readonly values: Readonly<Record<string, number>>;
  readonly output: LessonOutput;
}

interface LessonWorkerState {
  readonly output: LessonOutput;
  readonly runValues: Readonly<Record<string, number>>;
  readonly previous: PreviousLessonRun | null;
  readonly status: Exclude<LessonRunStatus, "changed">;
  readonly error: string | null;
}

interface PendingRun {
  readonly requestId: number;
  readonly values: Readonly<Record<string, number>>;
  readonly compareWithCurrent: boolean;
}

export function useLessonWorker(
  lessonId: string,
  initialValues: Readonly<Record<string, number>>,
) {
  const initialValuesRef = useRef({ ...initialValues });
  const workerRef = useRef<Worker | null>(null);
  const nextRequestIdRef = useRef(1);
  const pendingRef = useRef<PendingRun | null>(null);
  const [state, setState] = useState<LessonWorkerState>(() => ({
    output: loadingOutput(),
    runValues: { ...initialValues },
    previous: null,
    status: "running",
    error: null,
  }));

  const attachWorker = useCallback((worker: Worker) => {
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      const pending = pendingRef.current;
      if (!pending) {
        return;
      }
      if (!isLessonWorkerResponse(response)) {
        pendingRef.current = null;
        setState((current) => ({
          ...current,
          status: "error",
          error: "The calculation worker returned an invalid response.",
        }));
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        return;
      }
      if (response.requestId !== pending.requestId) return;
      pendingRef.current = null;
      if (!response.ok) {
        setState((current) => ({
          ...current,
          status: "error",
          error: response.problem.message,
        }));
        return;
      }
      setState((current) => ({
        output: response.output,
        runValues: pending.values,
        previous:
          pending.compareWithCurrent && current.status !== "error"
            ? { values: current.runValues, output: current.output }
            : current.previous,
        status: "current",
        error: null,
      }));
    };

    worker.onerror = () => {
      pendingRef.current = null;
      setState((current) => ({
        ...current,
        status: "error",
        error: "The calculation worker stopped unexpectedly. Run the experiment again to restart it.",
      }));
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = createLessonWorker();
    } catch {
      queueMicrotask(() => {
        setState((current) => ({
          ...current,
          status: "error",
          error: "The calculation worker could not start.",
        }));
      });
      return;
    }
    workerRef.current = worker;
    attachWorker(worker);

    const request: LessonWorkerRequest = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId: nextRequestIdRef.current,
      lessonId,
      values: initialValuesRef.current,
    };
    pendingRef.current = {
      requestId: request.requestId,
      values: initialValuesRef.current,
      compareWithCurrent: false,
    };
    try {
      worker.postMessage(request);
    } catch {
      pendingRef.current = null;
      worker.terminate();
      workerRef.current = null;
      queueMicrotask(() => {
        setState((current) => ({
          ...current,
          status: "error",
          error: "The calculation worker could not start.",
        }));
      });
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRef.current = null;
    };
  }, [attachWorker, lessonId]);

  const run = useCallback(
    (
      values: Readonly<Record<string, number>>,
      attachment?: LessonDataAttachment,
    ) => {
      let worker = workerRef.current;
      if (!worker) {
        try {
          worker = createLessonWorker();
        } catch {
          setState((current) => ({
            ...current,
            status: "error",
            error: "The calculation worker could not restart.",
          }));
          return;
        }
        workerRef.current = worker;
        attachWorker(worker);
      }
      const requestId = nextRequestIdRef.current + 1;
      nextRequestIdRef.current = requestId;
      const request: LessonWorkerRequest = {
        contract: LESSON_WORKER_PROTOCOL,
        requestId,
        lessonId,
        values: { ...values },
        ...(attachment ? { attachment } : {}),
      };
      pendingRef.current = {
        requestId,
        values: request.values,
        compareWithCurrent: true,
      };
      setState((current) => ({ ...current, status: "running", error: null }));
      try {
        worker.postMessage(request);
      } catch {
        pendingRef.current = null;
        worker.terminate();
        workerRef.current = null;
        setState((current) => ({
          ...current,
          status: "error",
          error: "The calculation worker could not receive this experiment.",
        }));
      }
    },
    [attachWorker, lessonId],
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    pendingRef.current = null;
    setState((current) => ({
      ...current,
      status: "error",
      error: "Calculation cancelled. Your inputs are unchanged and can be run again.",
    }));
  }, []);

  return { ...state, run, cancel };
}

function createLessonWorker(): Worker {
  return new Worker(
    new URL("../workers/lesson.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function loadingOutput(): LessonOutput {
  return {
    resultContract: "educational-lesson/pending@1",
    headline: "Calculating the fixed-seed experiment…",
    explanation: "The model is running away from the interface thread so controls and navigation stay responsive.",
    metrics: [],
    series: [],
    diagnostics: [],
    warnings: [],
    provenance: ["Dedicated Web Worker"],
    compactSummary: {},
  };
}
