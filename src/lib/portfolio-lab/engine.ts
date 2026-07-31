import {
  analyzePortfolioPath,
  buildCaseDetail,
  buildCaseSummary,
  type CaseSimulation,
  type PathAnalysis,
} from "./analytics";
import {
  PORTFOLIO_LAB_CONTRACT,
  type MarketCase,
  type PortfolioCaseDetail,
  type PortfolioCaseSummary,
  type PortfolioLabRequest,
  type PortfolioLabResult,
} from "./contracts";
import { PortfolioLabEngineCancelledError } from "./errors";
import {
  createMarketPathGenerator,
  type MarketPathGenerator,
} from "./market";
import { simulatePortfolioPath } from "./portfolio";
import { PORTFOLIO_RANDOM_STREAM_VERSION } from "./semantic-random";

export {
  PortfolioLabEngineCancelledError,
  PortfolioLabNumericalError,
} from "./errors";
export { sampleRegime } from "./market";

export const PORTFOLIO_LAB_ENGINE_VERSION = "portfolio-lab-engine@1";
export const PORTFOLIO_LAB_EVENT_ORDER_VERSION =
  "market-cashflow-rebalance-record@1";

const MAX_SAMPLE_PATHS = 160;
const COOPERATIVE_PATH_BATCH_SIZE = 16;

interface ExecutionState {
  readonly request: PortfolioLabRequest;
  readonly selectedPathIndexes: readonly number[];
  readonly comparisons: PortfolioCaseSummary[];
  primary?: PortfolioCaseDetail;
}

export function executeValidatedPortfolioLabRequest(
  request: PortfolioLabRequest,
): PortfolioLabResult {
  const state = createExecutionState(request);

  for (const requestCase of request.cases) {
    recordCaseSimulation(state, simulateCase(request, requestCase));
  }

  return completeExecution(state);
}

export async function executeValidatedPortfolioLabRequestCooperatively(
  request: PortfolioLabRequest,
  signal: AbortSignal,
): Promise<PortfolioLabResult> {
  throwIfCancelled(signal);
  const state = createExecutionState(request);

  for (const requestCase of request.cases) {
    const simulation = await simulateCaseCooperatively(
      request,
      requestCase,
      signal,
    );
    recordCaseSimulation(state, simulation);
  }

  throwIfCancelled(signal);
  return completeExecution(state);
}

export function selectPortfolioLabSampleIndexes(pathCount: number): number[] {
  return Array.from(
    { length: Math.min(pathCount, MAX_SAMPLE_PATHS) },
    (_, index) => index,
  );
}

function createExecutionState(request: PortfolioLabRequest): ExecutionState {
  return {
    request,
    selectedPathIndexes: selectPortfolioLabSampleIndexes(
      request.execution.paths,
    ),
    comparisons: [],
  };
}

function recordCaseSimulation(
  state: ExecutionState,
  simulation: CaseSimulation,
): void {
  if (simulation.requestCase.id === state.request.primaryCaseId) {
    state.primary = buildCaseDetail(
      simulation,
      state.selectedPathIndexes,
    );
    return;
  }

  state.comparisons.push(buildCaseSummary(simulation));
}

function completeExecution(state: ExecutionState): PortfolioLabResult {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.result,
    primary: requirePrimary(state.primary),
    comparisons: state.comparisons,
    warnings: [],
    provenance: {
      contract: PORTFOLIO_LAB_CONTRACT.provenance,
      requestContract: state.request.contract,
      engineVersion: PORTFOLIO_LAB_ENGINE_VERSION,
      randomStreamVersion: PORTFOLIO_RANDOM_STREAM_VERSION,
      eventOrderVersion: PORTFOLIO_LAB_EVENT_ORDER_VERSION,
      quantileMethod: "linear-r7",
      seed: state.request.execution.seed,
      timeGrid: {
        steps: state.request.execution.steps,
        stepYears: state.request.execution.stepYears,
      },
      selectedPathIndexes: state.selectedPathIndexes,
    },
  };
}

function simulateCase(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
): CaseSimulation {
  const marketPaths = createMarketPathGenerator(
    requestCase,
    request.execution,
  );
  const paths = Array.from(
    { length: request.execution.paths },
    (_, pathIndex) =>
      simulateAnalyzedPath(request, requestCase, marketPaths, pathIndex),
  );

  return createCaseSimulation(request, requestCase, paths);
}

async function simulateCaseCooperatively(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
  signal: AbortSignal,
): Promise<CaseSimulation> {
  const marketPaths = createMarketPathGenerator(
    requestCase,
    request.execution,
  );
  const paths: PathAnalysis[] = [];

  await Promise.resolve();
  throwIfCancelled(signal);

  for (let pathIndex = 0; pathIndex < request.execution.paths; pathIndex += 1) {
    paths.push(
      simulateAnalyzedPath(request, requestCase, marketPaths, pathIndex),
    );

    if ((pathIndex + 1) % COOPERATIVE_PATH_BATCH_SIZE === 0) {
      await yieldToEventLoop();
      throwIfCancelled(signal);
    }
  }

  throwIfCancelled(signal);
  return createCaseSimulation(request, requestCase, paths);
}

function simulateAnalyzedPath(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
  marketPaths: MarketPathGenerator,
  pathIndex: number,
): PathAnalysis {
  const portfolioPath = simulatePortfolioPath(
    request.plan,
    requestCase.id,
    pathIndex,
    marketPaths.generate(pathIndex),
  );
  return analyzePortfolioPath(portfolioPath);
}

function createCaseSimulation(
  request: PortfolioLabRequest,
  requestCase: MarketCase,
  paths: readonly PathAnalysis[],
): CaseSimulation {
  return {
    requestCase,
    plan: request.plan,
    execution: request.execution,
    paths,
  };
}

function requirePrimary(
  primary: PortfolioCaseDetail | undefined,
): PortfolioCaseDetail {
  if (!primary) {
    throw new Error("The primary case ID must reference a case.");
  }
  return primary;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PortfolioLabEngineCancelledError();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
