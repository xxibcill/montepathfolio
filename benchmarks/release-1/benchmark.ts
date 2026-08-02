import {
  isLessonWorkerResponse,
  LESSON_WORKER_PROTOCOL,
  type LessonWorkerRequest,
  type LessonWorkerResponse,
} from "../../src/labs/lesson-worker-protocol";
import { createLessonWorker } from "../../src/workers/lesson-worker-factory";

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 3;
const INTERACTIVE_BUDGET_MILLISECONDS = 2_500;
const RESULT_TITLE_PREFIX = "PORTFOLIO_BENCHMARK:";

interface BrowserNavigator extends Navigator {
  readonly deviceMemory?: number;
}

interface BenchmarkScenario {
  readonly lessonId: string;
  readonly label: string;
  readonly workload: string;
  readonly values: Readonly<Record<string, number>>;
}

interface ScenarioReport {
  readonly lessonId: string;
  readonly label: string;
  readonly workload: string;
  readonly resultContract: string;
  readonly samples: readonly number[];
  readonly durationMilliseconds: {
    readonly minimum: number;
    readonly median: number;
    readonly maximum: number;
  };
  readonly budgetMilliseconds: number;
  readonly withinBudget: boolean;
}

interface ReleaseOneBenchmarkReport {
  readonly benchmark: "quant-roadmap/release-1-browser-worker@1";
  readonly measuredAt: string;
  readonly method: {
    readonly warmupRuns: number;
    readonly measuredRuns: number;
    readonly timingBoundary: string;
  };
  readonly scenarios: readonly ScenarioReport[];
  readonly environment: {
    readonly userAgent: string;
    readonly logicalProcessors: number;
    readonly deviceMemoryGiB: number | null;
  };
}

const SCENARIOS: readonly BenchmarkScenario[] = [
  {
    lessonId: "jump-diffusion",
    label: "Merton jump diffusion",
    workload: "paired 2,000-path jump and GBM cases, 120 monthly steps",
    values: {
      drift: 0.07,
      volatility: 0.18,
      jumpIntensity: 0.6,
      meanJump: -0.12,
    },
  },
  {
    lessonId: "garch",
    label: "GARCH(1,1)",
    workload: "240-observation classroom fit plus paired 40-path, 120-step forecasts",
    values: {
      omega: 0.00002,
      alpha: 0.08,
      beta: 0.88,
      degreesOfFreedom: 7,
    },
  },
  {
    lessonId: "mean-variance",
    label: "Mean–variance optimization",
    workload: "two-asset long-only solve with 21 efficient-frontier points",
    values: {
      returnA: 0.08,
      returnB: 0.04,
      correlation: 0.2,
      riskFree: 0.02,
    },
  },
];

const statusElement = requireElement("benchmark-status");
const outputElement = requireElement("benchmark-output");

try {
  const scenarioReports: ScenarioReport[] = [];
  for (const scenario of SCENARIOS) {
    statusElement.textContent = `Warming up ${scenario.label}…`;
    await runScenario(scenario, 0);

    const samples: number[] = [];
    let response: Extract<LessonWorkerResponse, { ok: true }> | null = null;
    for (let runIndex = 0; runIndex < MEASURED_RUNS; runIndex += 1) {
      statusElement.textContent =
        `Measuring ${scenario.label}, run ${runIndex + 1} of ${MEASURED_RUNS}…`;
      const startedAt = performance.now();
      response = await runScenario(scenario, runIndex + 1);
      samples.push(roundMilliseconds(performance.now() - startedAt));
    }
    if (!response) throw new Error(`${scenario.label} returned no result.`);
    scenarioReports.push(createScenarioReport(scenario, samples, response));
  }

  const browserNavigator = navigator as BrowserNavigator;
  const report: ReleaseOneBenchmarkReport = {
    benchmark: "quant-roadmap/release-1-browser-worker@1",
    measuredAt: new Date().toISOString(),
    method: {
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      timingBoundary:
        "lesson worker creation through validated structured result receipt; rendering excluded",
    },
    scenarios: scenarioReports,
    environment: {
      userAgent: navigator.userAgent,
      logicalProcessors: navigator.hardwareConcurrency,
      deviceMemoryGiB: browserNavigator.deviceMemory ?? null,
    },
  };
  outputElement.textContent = JSON.stringify(report, null, 2);
  statusElement.textContent = scenarioReports.every((scenario) => scenario.withinBudget)
    ? "Complete — all model budgets met"
    : "Complete — at least one model exceeded its budget";
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

function runScenario(
  scenario: BenchmarkScenario,
  requestId: number,
): Promise<Extract<LessonWorkerResponse, { ok: true }>> {
  return new Promise((resolve, reject) => {
    const worker = createLessonWorker(scenario.lessonId);
    const request: LessonWorkerRequest = {
      contract: LESSON_WORKER_PROTOCOL,
      requestId,
      lessonId: scenario.lessonId,
      values: scenario.values,
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate();
      if (!isLessonWorkerResponse(event.data)) {
        reject(new Error(`${scenario.label} returned an invalid worker response.`));
        return;
      }
      if (!event.data.ok) {
        reject(
          new Error(
            `${scenario.label} failed: ${event.data.problem.code}: ${event.data.problem.message}`,
          ),
        );
        return;
      }
      resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error(`${scenario.label} worker stopped unexpectedly.`));
    };
    worker.postMessage(request);
  });
}

function createScenarioReport(
  scenario: BenchmarkScenario,
  samples: readonly number[],
  response: Extract<LessonWorkerResponse, { ok: true }>,
): ScenarioReport {
  const sorted = [...samples].sort((left, right) => left - right);
  const maximum = sorted[sorted.length - 1];
  return {
    lessonId: scenario.lessonId,
    label: scenario.label,
    workload: scenario.workload,
    resultContract: response.output.resultContract,
    samples,
    durationMilliseconds: {
      minimum: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      maximum,
    },
    budgetMilliseconds: INTERACTIVE_BUDGET_MILLISECONDS,
    withinBudget: maximum <= INTERACTIVE_BUDGET_MILLISECONDS,
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
