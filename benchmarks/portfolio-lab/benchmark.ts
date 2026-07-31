import { createWebWorkerPortfolioLabRunner } from "../../src/lib/portfolio-lab/worker-runner";
import type { PortfolioLabResult } from "../../src/lib/portfolio-lab/contracts";
import { PORTFOLIO_LAB_BASELINE_REQUEST } from "./request";

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 3;
const RESULT_TITLE_PREFIX = "PORTFOLIO_BENCHMARK:";

interface BrowserNavigator extends Navigator {
  readonly deviceMemory?: number;
}

interface BenchmarkReport {
  readonly benchmark: "portfolio-lab/browser-worker-baseline@1";
  readonly measuredAt: string;
  readonly scenario: {
    readonly cases: number;
    readonly pathsPerCase: number;
    readonly stepsPerPath: number;
    readonly simulatedPathSteps: number;
    readonly seed: number;
  };
  readonly method: {
    readonly warmupRuns: number;
    readonly measuredRuns: number;
    readonly timingBoundary: string;
  };
  readonly durationMilliseconds: {
    readonly samples: readonly number[];
    readonly minimum: number;
    readonly median: number;
    readonly maximum: number;
  };
  readonly environment: {
    readonly userAgent: string;
    readonly logicalProcessors: number;
    readonly deviceMemoryGiB: number | null;
  };
  readonly resultCheck: {
    readonly contract: string;
    readonly engineVersion: string;
    readonly primaryModel: string;
    readonly comparisonCount: number;
  };
}

const statusElement = requireElement("benchmark-status");
const outputElement = requireElement("benchmark-output");

try {
  statusElement.textContent = "Warming up the browser worker…";
  let lastResult = await runBaseline();

  const durationSamples: number[] = [];
  for (let runIndex = 0; runIndex < MEASURED_RUNS; runIndex += 1) {
    statusElement.textContent = `Measuring run ${runIndex + 1} of ${MEASURED_RUNS}…`;
    const startedAt = performance.now();
    lastResult = await runBaseline();
    durationSamples.push(roundMilliseconds(performance.now() - startedAt));
  }

  const report = createReport(durationSamples, lastResult);
  outputElement.textContent = JSON.stringify(report, null, 2);
  statusElement.textContent = "Complete";
  document.body.dataset.status = "complete";
  document.title = RESULT_TITLE_PREFIX + encodeBase64(JSON.stringify(report));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  statusElement.textContent = "Benchmark failed";
  outputElement.textContent = message;
  document.body.dataset.status = "failed";
  document.title = RESULT_TITLE_PREFIX + encodeBase64(
    JSON.stringify({ error: message }),
  );
}

async function runBaseline(): Promise<PortfolioLabResult> {
  const outcome = await createWebWorkerPortfolioLabRunner().run(
    PORTFOLIO_LAB_BASELINE_REQUEST,
  ).outcome;

  if (!outcome.ok) {
    throw new Error(`${outcome.problem.code}: ${outcome.problem.message}`);
  }

  return outcome.result;
}

function createReport(
  samples: readonly number[],
  result: PortfolioLabResult,
): BenchmarkReport {
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const execution = PORTFOLIO_LAB_BASELINE_REQUEST.execution;
  const browserNavigator = navigator as BrowserNavigator;

  return {
    benchmark: "portfolio-lab/browser-worker-baseline@1",
    measuredAt: new Date().toISOString(),
    scenario: {
      cases: PORTFOLIO_LAB_BASELINE_REQUEST.cases.length,
      pathsPerCase: execution.paths,
      stepsPerPath: execution.steps,
      simulatedPathSteps:
        PORTFOLIO_LAB_BASELINE_REQUEST.cases.length *
        execution.paths *
        execution.steps,
      seed: execution.seed,
    },
    method: {
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      timingBoundary:
        "worker creation through structured result receipt; rendering excluded",
    },
    durationMilliseconds: {
      samples,
      minimum: sortedSamples[0],
      median: sortedSamples[Math.floor(sortedSamples.length / 2)],
      maximum: sortedSamples[sortedSamples.length - 1],
    },
    environment: {
      userAgent: navigator.userAgent,
      logicalProcessors: navigator.hardwareConcurrency,
      deviceMemoryGiB: browserNavigator.deviceMemory ?? null,
    },
    resultCheck: {
      contract: result.contract,
      engineVersion: result.provenance.engineVersion,
      primaryModel: result.primary.model,
      comparisonCount: result.comparisons.length,
    },
  };
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing benchmark element: ${id}`);
  return element;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
