import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  type CancelledProblem,
  type InvalidRequestProblem,
  type NumericalFailureProblem,
  type PortfolioLabIssue,
  type PortfolioLabOutcome,
  type PortfolioLabProblem,
  type PortfolioLabRequest,
  type PortfolioLabRunner,
  type ResourceLimitProblem,
  type UnsupportedContractProblem,
} from "./contracts";
import { executeValidatedPortfolioLabRequestCooperatively } from "./engine";
import {
  PortfolioLabEngineCancelledError,
  PortfolioLabNumericalError,
} from "./errors";

const PROBABILITY_SUM_TOLERANCE = 1e-8;
const WEIGHT_SUM_TOLERANCE = 1e-12;
const ESTIMATED_BYTES_PER_PATH_STEP = 48;

export const PORTFOLIO_LAB_LIMITS = {
  cases: 16,
  paths: 10_000,
  steps: 1_200,
  estimatedBytes: 256 * 1024 * 1024,
} as const;

type UnknownRecord = Record<string, unknown>;
type IssuePath = readonly (string | number)[];

type RequestValidation =
  | { readonly ok: true; readonly request: PortfolioLabRequest }
  | { readonly ok: false; readonly problem: PortfolioLabProblem };

export function createInProcessPortfolioLabRunner(): PortfolioLabRunner {
  return {
    run(request) {
      const abortController = new AbortController();
      const outcome: Promise<PortfolioLabOutcome> = Promise.resolve()
        .then(() => executeRequest(request, abortController.signal))
        .catch((error: unknown) => ({
          ok: false,
          problem: unexpectedRunnerProblem(error),
        }));

      return {
        outcome,
        cancel() {
          abortController.abort();
        },
      };
    },
  };
}

export function preflightPortfolioLabRequest(
  request: unknown,
): PortfolioLabProblem | null {
  const validation = validateRequest(request);
  return validation.ok ? null : validation.problem;
}

async function executeRequest(
  rawRequest: unknown,
  signal: AbortSignal,
): Promise<PortfolioLabOutcome> {
  if (signal.aborted) {
    return { ok: false, problem: cancelledProblem() };
  }

  const validation = validateRequest(rawRequest);
  if (!validation.ok) {
    return { ok: false, problem: validation.problem };
  }

  return executeValidatedRequest(validation.request, signal);
}

async function executeValidatedRequest(
  request: PortfolioLabRequest,
  signal: AbortSignal,
): Promise<PortfolioLabOutcome> {
  try {
    const result = await executeValidatedPortfolioLabRequestCooperatively(
      request,
      signal,
    );
    return { ok: true, result };
  } catch (error) {
    if (error instanceof PortfolioLabEngineCancelledError || signal.aborted) {
      return { ok: false, problem: cancelledProblem() };
    }
    if (error instanceof PortfolioLabNumericalError) {
      return { ok: false, problem: numericalFailureProblem(error) };
    }
    throw error;
  }
}

function validateRequest(value: unknown): RequestValidation {
  if (!isRecord(value)) {
    return invalidValidation([
      issue("MISSING", [], "A portfolio-lab request object is required."),
    ]);
  }

  if (value.contract !== PORTFOLIO_LAB_CONTRACT.request) {
    return unsupportedValidation(
      ["contract"],
      value.contract,
      [PORTFOLIO_LAB_CONTRACT.request],
      "The requested portfolio-lab contract is not supported.",
    );
  }

  if (!Array.isArray(value.cases)) {
    return invalidValidation([
      issue("MISSING", ["cases"], "Market cases must be an array."),
    ]);
  }

  if (value.cases.length > PORTFOLIO_LAB_LIMITS.cases) {
    return resourceValidation(
      "CASES",
      value.cases.length,
      PORTFOLIO_LAB_LIMITS.cases,
    );
  }

  const contractProblem = findUnsupportedModelContract(value.cases);
  if (contractProblem) {
    return { ok: false, problem: contractProblem };
  }

  const issues: PortfolioLabIssue[] = [];
  validateCases(value.cases, issues);
  validatePrimaryCaseId(value.primaryCaseId, value.cases, issues);
  validatePlan(value.plan, issues);
  validateExecution(value.execution, issues);

  if (issues.length > 0) {
    return invalidValidation(issues);
  }

  const execution = value.execution as UnknownRecord;
  const resourceProblem = executionResourceProblem(
    execution.paths as number,
    execution.steps as number,
  );
  if (resourceProblem) {
    return { ok: false, problem: resourceProblem };
  }

  return {
    ok: true,
    request: value as unknown as PortfolioLabRequest,
  };
}

function findUnsupportedModelContract(
  cases: readonly unknown[],
): UnsupportedContractProblem | null {
  for (const [caseIndex, requestCase] of cases.entries()) {
    if (!isRecord(requestCase) || !isRecord(requestCase.model)) {
      continue;
    }

    const model = requestCase.model;
    const expectedContract =
      model.kind === "gbm"
        ? PORTFOLIO_LAB_MODEL_CONTRACT.gbm
        : model.kind === "hmm"
          ? PORTFOLIO_LAB_MODEL_CONTRACT.hmm
          : null;

    if (expectedContract && model.contract !== expectedContract) {
      return unsupportedContractProblem(
        ["cases", caseIndex, "model", "contract"],
        model.contract,
        [expectedContract],
        "The requested model contract is not supported.",
      );
    }

    const supportedContracts = Object.values(PORTFOLIO_LAB_MODEL_CONTRACT);
    if (
      !expectedContract &&
      !supportedContracts.includes(
        model.contract as (typeof supportedContracts)[number],
      )
    ) {
      return unsupportedContractProblem(
        ["cases", caseIndex, "model", "contract"],
        model.contract,
        supportedContracts,
        "The requested model contract is not supported.",
      );
    }
  }

  return null;
}

function validateCases(
  cases: readonly unknown[],
  issues: PortfolioLabIssue[],
): void {
  if (cases.length === 0) {
    issues.push(issue("MISSING", ["cases"], "At least one market case is required."));
    return;
  }

  const caseIdIndexes = new Map<string, number>();
  for (const [caseIndex, requestCase] of cases.entries()) {
    const path = ["cases", caseIndex] as const;
    if (!isRecord(requestCase)) {
      issues.push(issue("MISSING", path, "Each market case must be an object."));
      continue;
    }

    validateCaseId(requestCase.id, path, caseIdIndexes, issues);
    validateNonEmptyString(
      requestCase.label,
      [...path, "label"],
      "A market case label is required.",
      issues,
    );
    validateModel(requestCase.model, [...path, "model"], issues);
  }
}

function validateCaseId(
  value: unknown,
  casePath: readonly ["cases", number],
  caseIdIndexes: Map<string, number>,
  issues: PortfolioLabIssue[],
): void {
  const path = [...casePath, "id"];
  if (!validateNonEmptyString(value, path, "A market case ID is required.", issues)) {
    return;
  }

  const existingIndex = caseIdIndexes.get(value);
  if (existingIndex !== undefined) {
    issues.push(
      issue(
        "DUPLICATE_ID",
        path,
        `Market case IDs must be unique; this ID first appears at cases.${existingIndex}.`,
      ),
    );
    return;
  }

  caseIdIndexes.set(value, casePath[1]);
}

function validatePrimaryCaseId(
  value: unknown,
  cases: readonly unknown[],
  issues: PortfolioLabIssue[],
): void {
  const path = ["primaryCaseId"] as const;
  if (!validateNonEmptyString(value, path, "A primary case ID is required.", issues)) {
    return;
  }

  const caseIds = new Set(
    cases
      .filter(isRecord)
      .map((requestCase) => requestCase.id)
      .filter((caseId): caseId is string => typeof caseId === "string"),
  );
  if (!caseIds.has(value)) {
    issues.push(
      issue(
        "INVALID_REFERENCE",
        path,
        "The primary case ID must reference a case.",
      ),
    );
  }
}

function validateModel(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A market model is required."));
    return;
  }

  if (value.kind === "gbm") {
    validateMarket(value.market, [...path, "market"], issues);
    return;
  }

  if (value.kind === "hmm") {
    validateHmmModel(value, path, issues);
    return;
  }

  issues.push(
    issue(
      "UNSUPPORTED_MODEL",
      [...path, "kind"],
      "The portfolio-lab engine supports GBM and HMM models only.",
    ),
  );
}

function validateHmmModel(
  model: UnknownRecord,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  const regimesPath = [...path, "regimes"];
  if (!isRecord(model.regimes)) {
    issues.push(issue("MISSING", regimesPath, "HMM regimes are required."));
  } else {
    for (const regime of ["bull", "bear", "sideways"] as const) {
      validateMarket(
        model.regimes[regime],
        [...regimesPath, regime],
        issues,
      );
    }
  }

  const transitionPath = [...path, "transitionMatrix"];
  if (!isRecord(model.transitionMatrix)) {
    issues.push(
      issue("MISSING", transitionPath, "An HMM transition matrix is required."),
    );
  } else {
    for (const regime of ["bull", "bear", "sideways"] as const) {
      validateProbabilityDistribution(
        model.transitionMatrix[regime],
        [...transitionPath, regime],
        issues,
      );
    }
  }

  validateProbabilityDistribution(
    model.initialStateProbabilities,
    [...path, "initialStateProbabilities"],
    issues,
  );
}

function validateMarket(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Market assumptions are required."));
    return;
  }

  validateAsset(value.stocks, [...path, "stocks"], issues);
  validateAsset(value.bonds, [...path, "bonds"], issues);
  validateNumberInRange(
    value.correlation,
    [...path, "correlation"],
    -1,
    1,
    issues,
  );
}

function validateAsset(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Asset assumptions are required."));
    return;
  }

  validateFiniteNumber(value.annualDrift, [...path, "annualDrift"], issues);
  validateNonNegativeNumber(
    value.annualVolatility,
    [...path, "annualVolatility"],
    issues,
  );
}

function validateProbabilityDistribution(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A probability distribution is required."));
    return;
  }

  let sum = 0;
  let allFinite = true;
  for (const regime of ["bull", "bear", "sideways"] as const) {
    const probability = value[regime];
    const valid = validateNumberInRange(
      probability,
      [...path, regime],
      0,
      1,
      issues,
    );
    allFinite &&= valid;
    if (valid) {
      sum += probability as number;
    }
  }

  if (allFinite && Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    issues.push(
      issue(
        "INVALID_DISTRIBUTION",
        path,
        "Probabilities must sum to one.",
      ),
    );
  }
}

function validatePlan(
  value: unknown,
  issues: PortfolioLabIssue[],
): void {
  const path = ["plan"] as const;
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A portfolio plan is required."));
    return;
  }

  validateNonNegativeNumber(
    value.initialCapital,
    [...path, "initialCapital"],
    issues,
  );
  validateNonNegativeNumber(
    value.contributionPerStep,
    [...path, "contributionPerStep"],
    issues,
  );
  validateWeights(value.targetWeights, [...path, "targetWeights"], issues);
  validateRebalance(value.rebalance, [...path, "rebalance"], issues);
  if (
    validateFiniteNumber(
      value.annualInflationRate,
      [...path, "annualInflationRate"],
      issues,
    ) &&
    (value.annualInflationRate as number) <= -1
  ) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        [...path, "annualInflationRate"],
        "Annual inflation must be greater than -1.",
      ),
    );
  }
  validateNonNegativeNumber(
    value.targetValue,
    [...path, "targetValue"],
    issues,
  );
}

function validateWeights(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Portfolio target weights are required."));
    return;
  }

  const stocksValid = validateNumberInRange(
    value.stocks,
    [...path, "stocks"],
    0,
    1,
    issues,
  );
  const bondsValid = validateNumberInRange(
    value.bonds,
    [...path, "bonds"],
    0,
    1,
    issues,
  );

  if (
    stocksValid &&
    bondsValid &&
    Math.abs((value.stocks as number) + (value.bonds as number) - 1) >
      WEIGHT_SUM_TOLERANCE
  ) {
    issues.push(
      issue("OUT_OF_RANGE", path, "Portfolio target weights must sum to one."),
    );
  }
}

function validateRebalance(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "A rebalancing policy is required."));
    return;
  }

  if (value.kind === "never") {
    return;
  }

  if (value.kind !== "periodic") {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        [...path, "kind"],
        "The rebalancing policy must be periodic or never.",
      ),
    );
    return;
  }

  validatePositiveInteger(value.everySteps, [...path, "everySteps"], issues);
}

function validateExecution(
  value: unknown,
  issues: PortfolioLabIssue[],
): void {
  const path = ["execution"] as const;
  if (!isRecord(value)) {
    issues.push(issue("MISSING", path, "Execution settings are required."));
    return;
  }

  validateInteger(value.seed, [...path, "seed"], issues);
  validatePositiveInteger(value.paths, [...path, "paths"], issues);
  validatePositiveInteger(value.steps, [...path, "steps"], issues);
  if (
    validateFiniteNumber(value.stepYears, [...path, "stepYears"], issues) &&
    (value.stepYears as number) <= 0
  ) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        [...path, "stepYears"],
        "The time-step length must be positive.",
      ),
    );
  }
}

function validateNonEmptyString(
  value: unknown,
  path: IssuePath,
  message: string,
  issues: PortfolioLabIssue[],
): value is string {
  if (typeof value === "string" && value.trim().length > 0) {
    return true;
  }

  issues.push(issue("MISSING", path, message));
  return false;
}

function validateFiniteNumber(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): value is number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return true;
  }

  const code = value === undefined || value === null ? "MISSING" : "NOT_FINITE";
  issues.push(issue(code, path, "A finite number is required."));
  return false;
}

function validateNonNegativeNumber(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): value is number {
  if (!validateFiniteNumber(value, path, issues)) {
    return false;
  }

  if (value < 0) {
    issues.push(issue("OUT_OF_RANGE", path, "The value must be non-negative."));
    return false;
  }

  return true;
}

function validateNumberInRange(
  value: unknown,
  path: IssuePath,
  minimum: number,
  maximum: number,
  issues: PortfolioLabIssue[],
): value is number {
  if (!validateFiniteNumber(value, path, issues)) {
    return false;
  }

  if (value < minimum || value > maximum) {
    issues.push(
      issue(
        "OUT_OF_RANGE",
        path,
        `The value must be between ${minimum} and ${maximum}.`,
      ),
    );
    return false;
  }

  return true;
}

function validateInteger(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): value is number {
  if (!validateFiniteNumber(value, path, issues)) {
    return false;
  }

  if (!Number.isSafeInteger(value)) {
    issues.push(issue("NOT_INTEGER", path, "A safe integer is required."));
    return false;
  }

  return true;
}

function validatePositiveInteger(
  value: unknown,
  path: IssuePath,
  issues: PortfolioLabIssue[],
): value is number {
  if (!validateInteger(value, path, issues)) {
    return false;
  }

  if (value <= 0) {
    issues.push(issue("OUT_OF_RANGE", path, "A positive integer is required."));
    return false;
  }

  return true;
}

function executionResourceProblem(
  paths: number,
  steps: number,
): ResourceLimitProblem | null {
  if (paths > PORTFOLIO_LAB_LIMITS.paths) {
    return resourceLimitProblem(
      "PATHS",
      paths,
      PORTFOLIO_LAB_LIMITS.paths,
    );
  }

  if (steps > PORTFOLIO_LAB_LIMITS.steps) {
    return resourceLimitProblem(
      "STEPS",
      steps,
      PORTFOLIO_LAB_LIMITS.steps,
    );
  }

  const estimatedBytes = estimateWorkingBytes(paths, steps);
  if (estimatedBytes > PORTFOLIO_LAB_LIMITS.estimatedBytes) {
    return resourceLimitProblem(
      "ESTIMATED_BYTES",
      estimatedBytes,
      PORTFOLIO_LAB_LIMITS.estimatedBytes,
    );
  }

  return null;
}

function estimateWorkingBytes(paths: number, steps: number): number {
  return paths * (steps + 1) * ESTIMATED_BYTES_PER_PATH_STEP;
}

function invalidValidation(issues: readonly PortfolioLabIssue[]): RequestValidation {
  return { ok: false, problem: invalidRequestProblem(issues) };
}

function unsupportedValidation(
  path: UnsupportedContractProblem["path"],
  receivedContract: unknown,
  supportedContracts: UnsupportedContractProblem["supportedContracts"],
  message: string,
): RequestValidation {
  return {
    ok: false,
    problem: unsupportedContractProblem(
      path,
      receivedContract,
      supportedContracts,
      message,
    ),
  };
}

function resourceValidation(
  resource: ResourceLimitProblem["resource"],
  requested: number,
  limit: number,
): RequestValidation {
  return {
    ok: false,
    problem: resourceLimitProblem(resource, requested, limit),
  };
}

function issue(
  code: PortfolioLabIssue["code"],
  path: IssuePath,
  message: string,
): PortfolioLabIssue {
  return { code, path, message };
}

function invalidRequestProblem(
  issues: readonly PortfolioLabIssue[],
): InvalidRequestProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "INVALID_REQUEST",
    message:
      issues.length === 1
        ? issues[0].message
        : "The request contains invalid values.",
    issues,
  };
}

function unsupportedContractProblem(
  path: UnsupportedContractProblem["path"],
  receivedContract: unknown,
  supportedContracts: UnsupportedContractProblem["supportedContracts"],
  message: string,
): UnsupportedContractProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "UNSUPPORTED_CONTRACT",
    message,
    path,
    receivedContract:
      typeof receivedContract === "string" ? receivedContract : null,
    supportedContracts,
  };
}

function resourceLimitProblem(
  resource: ResourceLimitProblem["resource"],
  requested: number,
  limit: number,
): ResourceLimitProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "RESOURCE_LIMIT",
    message: `The requested ${resource.toLowerCase()} exceeds the portfolio-lab limit.`,
    resource,
    requested,
    limit,
  };
}

function numericalFailureProblem(
  error: PortfolioLabNumericalError,
): NumericalFailureProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "NUMERICAL_FAILURE",
    message: error.message,
    caseId: error.caseId,
    ...(error.location ? { location: error.location } : {}),
  };
}

function cancelledProblem(): CancelledProblem {
  return {
    contract: PORTFOLIO_LAB_CONTRACT.problem,
    code: "CANCELLED",
    message: "The portfolio-lab run was cancelled.",
  };
}

function unexpectedRunnerProblem(error: unknown): PortfolioLabProblem {
  if (error instanceof PortfolioLabEngineCancelledError) {
    return cancelledProblem();
  }

  return invalidRequestProblem([
    issue(
      "OUT_OF_RANGE",
      [],
      error instanceof Error
        ? error.message
        : "The portfolio-lab request could not be executed.",
    ),
  ]);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
