import {
  QUANT_CORE_VERSION,
  QuantError,
  assertIncreasingTimestamps,
  assertFinite,
  assertIntegerInRange,
  assertNonNegative,
  assertPositive,
  assertProbability,
  asPriceSeries,
  asReturnSeries,
  asVarianceSeries,
  correlation,
  createSemanticRandom,
  factorCorrelationMatrix,
  inverseNormalCdf,
  matrixVectorMultiply,
  mean,
  normalCdf,
  populationVariance,
  quantile,
  studentTCdf,
  type ModelEnvelope,
  type ModelWarning,
  type NumericMatrix,
  type PriceSeries,
  type ReturnSeries,
  type VarianceSeries,
} from "./core";

export const MARKET_MODELS_VERSION = "market-models@1";

const MAX_SIMULATION_WORK = 5_000_000;
const MAX_RETAINED_VALUES = 5_000_000;
const MAX_JUMP_EVENTS_PER_ASSET_STEP = 100_000;
const RETAINED_VALUES_PER_JUMP_EVENT = 5;

export type ReturnConvention = "simple" | "log";
export type ObservationFrequency = "daily" | "weekly" | "monthly" | "annual";

export interface ReturnDataset {
  readonly contract: "return-dataset@1";
  readonly assetIds: readonly string[];
  readonly timestamps: readonly string[];
  readonly frequency: ObservationFrequency;
  readonly returnConvention: ReturnConvention;
  readonly rows: NumericMatrix;
  readonly missingValuePolicy: "reject";
  readonly alignmentPolicy: "intersection";
  readonly currency?: string;
  readonly adjusted?: boolean;
  readonly provenance: {
    readonly label: string;
    readonly kind: "illustrative" | "user-imported" | "historical";
  };
}

export interface CalibrationSnapshot<Parameters> {
  readonly contract: "calibration-snapshot@1";
  readonly modelContract: string;
  readonly schemaVersion: 1;
  readonly observationFrequency: ObservationFrequency;
  readonly returnConvention: ReturnConvention;
  readonly sampleStart: string;
  readonly sampleEnd: string;
  readonly estimates: Parameters;
  readonly fittingMethod: string;
  readonly convergence: {
    readonly converged: boolean;
    readonly iterations: number;
    readonly objective?: number;
  };
  readonly warnings: readonly string[];
  readonly dataProvenance: ReturnDataset["provenance"];
}

export function validateReturnDataset(dataset: ReturnDataset): void {
  if (dataset.contract !== "return-dataset@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported return-dataset contract.");
  }
  if (
    dataset.assetIds.length === 0 ||
    dataset.assetIds.some((id) => !id.trim()) ||
    new Set(dataset.assetIds).size !== dataset.assetIds.length
  ) {
    throw new QuantError(
      "INVALID_INPUT",
      "Asset identifiers must be non-empty and unique.",
      "assetIds",
    );
  }
  if (dataset.rows.length !== dataset.timestamps.length || dataset.rows.length < 2) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Timestamps and return rows must align and include at least two observations.",
    );
  }
  if (!["daily", "weekly", "monthly", "annual"].includes(dataset.frequency)) {
    throw new QuantError("INVALID_INPUT", "Dataset frequency is unsupported.", "frequency");
  }
  if (!["simple", "log"].includes(dataset.returnConvention)) {
    throw new QuantError("INVALID_INPUT", "Dataset return convention is unsupported.", "returnConvention");
  }
  if (dataset.missingValuePolicy !== "reject" || dataset.alignmentPolicy !== "intersection") {
    throw new QuantError("INVALID_INPUT", "Dataset alignment and missing-value policies are unsupported.");
  }
  if (!["illustrative", "user-imported", "historical"].includes(dataset.provenance.kind)) {
    throw new QuantError("INVALID_INPUT", "Dataset provenance kind is unsupported.");
  }
  if (dataset.rows.length * dataset.assetIds.length > 5_000_000) {
    throw new QuantError("OUT_OF_RANGE", "Dataset exceeds the five-million-cell limit.");
  }
  assertIncreasingTimestamps(dataset.timestamps);
  dataset.timestamps.forEach((timestamp, rowIndex) => {
    const row = dataset.rows[rowIndex];
    if (row.length !== dataset.assetIds.length) {
      throw new QuantError(
        "DIMENSION_MISMATCH",
        "Each return row must contain one value per asset.",
        `rows.${rowIndex}`,
      );
    }
    row.forEach((value, columnIndex) => {
      const path = `rows.${rowIndex}.${columnIndex}`;
      assertFinite(value, path);
      if (dataset.returnConvention === "simple" && value < -1) {
        throw new QuantError(
          "OUT_OF_RANGE",
          "Simple returns cannot fall below -100% (-1).",
          path,
        );
      }
    });
  });
  if (!dataset.provenance.label.trim()) {
    throw new QuantError("INVALID_INPUT", "Dataset provenance needs a label.");
  }
}

export interface AssetDiffusionSpec {
  /** Continuously compounded annual drift in dS/S. */
  readonly annualDrift: number;
  /** Annualized diffusion volatility. */
  readonly annualVolatility: number;
}

export interface JumpSpec {
  /** Expected arrivals per year. */
  readonly annualIntensity: number;
  /** Mean of the log jump multiplier. */
  readonly meanLogJump: number;
  /** Standard deviation of the log jump multiplier. */
  readonly logJumpVolatility: number;
}

export interface MertonJumpDiffusionInput {
  readonly contract: "market-model/merton-jump-diffusion@1";
  readonly initialPrices: readonly number[];
  readonly assets: readonly AssetDiffusionSpec[];
  readonly correlation: NumericMatrix;
  readonly jumps: readonly JumpSpec[];
  readonly execution: {
    readonly seed: number;
    readonly paths: number;
    readonly steps: number;
    readonly stepYears: number;
    readonly samplePaths?: number;
  };
}

export interface JumpEvent {
  readonly pathIndex: number;
  readonly stepIndex: number;
  readonly assetIndex: number;
  readonly count: number;
  readonly aggregateLogJump: number;
}

export interface MertonJumpDiffusionResult {
  readonly contract: "market-model/merton-jump-diffusion-result@1";
  readonly sampledPricePaths: readonly (readonly PriceSeries[])[];
  readonly terminalPrices: readonly PriceSeries[];
  readonly sampledJumpEvents: readonly JumpEvent[];
  readonly diagnostics: {
    readonly empiricalAnnualJumpCounts: readonly number[];
    readonly probabilityOfAnyCrash: number;
    readonly compensatedMeanGrowth: readonly number[];
    /** Positive fractional terminal loss, reported at the 95% loss quantile. */
    readonly terminalLoss95VaR: readonly number[];
    /** Mean positive fractional loss at or beyond the finite-sample 95% VaR. */
    readonly terminalLoss95Cvar: readonly number[];
    readonly meanMaximumDrawdown: readonly number[];
    /** Null when no simulated path for that asset contains a jump. */
    readonly jumpConditionedMeanMaximumDrawdown: readonly (number | null)[];
  };
}

export function runMertonJumpDiffusion(
  input: MertonJumpDiffusionInput,
): ModelEnvelope<MertonJumpDiffusionResult> {
  validateJumpInput(input);
  const lower = factorCorrelationMatrix(input.correlation);
  const random = createSemanticRandom(input.execution.seed, input.contract);
  const jumpCompensations = input.jumps.map((jump, index) =>
    calculateJumpCompensation(jump, `jumps.${index}`),
  );
  const sampleCount = Math.min(input.execution.samplePaths ?? 24, input.execution.paths);
  const sampledPricePaths: PriceSeries[][] = [];
  const terminalPrices: PriceSeries[] = [];
  const sampledJumpEvents: JumpEvent[] = [];
  const jumpTotals = Array(input.assets.length).fill(0) as number[];
  const maximumDrawdowns = input.assets.map(() => [] as number[]);
  const jumpConditionedDrawdowns = input.assets.map(() => [] as number[]);
  let pathsWithCrash = 0;

  for (let pathIndex = 0; pathIndex < input.execution.paths; pathIndex += 1) {
    const prices = [...input.initialPrices];
    const path = prices.map((price) => [price]);
    const peaks = [...prices];
    const pathMaximumDrawdowns = input.assets.map(() => 0);
    const pathContainsJump = input.assets.map(() => false);
    let pathCrashed = false;
    for (let stepIndex = 1; stepIndex <= input.execution.steps; stepIndex += 1) {
      const independent = input.assets.map((_, assetIndex) =>
        random.normal("diffusion", pathIndex, stepIndex, assetIndex),
      );
      const shocks = matrixVectorMultiply(lower, independent);
      input.assets.forEach((asset, assetIndex) => {
        const jump = input.jumps[assetIndex];
        const count = random.poisson(
          jump.annualIntensity * input.execution.stepYears,
          "jump/arrival",
          pathIndex,
          stepIndex,
          assetIndex,
        );
        assertBoundedJumpCount(count);
        let aggregateLogJump = 0;
        for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
          aggregateLogJump +=
            jump.meanLogJump +
            jump.logJumpVolatility *
              random.normal(
                "jump/size",
                pathIndex,
                stepIndex,
                assetIndex,
                eventIndex,
              );
        }
        const logGrowth =
          (asset.annualDrift -
            0.5 * asset.annualVolatility ** 2 -
            jumpCompensations[assetIndex]) *
            input.execution.stepYears +
          asset.annualVolatility * Math.sqrt(input.execution.stepYears) * shocks[assetIndex] +
          aggregateLogJump;
        assertFiniteSimulationValue(
          logGrowth,
          `sampledLogGrowth.${pathIndex}.${assetIndex}.${stepIndex}`,
          "Jump-diffusion log growth overflowed. Reduce the horizon, volatility, or jump size.",
        );
        prices[assetIndex] *= Math.exp(logGrowth);
        assertPositiveFiniteSimulationValue(
          prices[assetIndex],
          `terminalPrices.${pathIndex}.${assetIndex}`,
          "Jump-diffusion price overflowed or underflowed. Reduce the horizon, volatility, or jump size.",
        );
        path[assetIndex].push(prices[assetIndex]);
        peaks[assetIndex] = Math.max(peaks[assetIndex], prices[assetIndex]);
        pathMaximumDrawdowns[assetIndex] = Math.max(
          pathMaximumDrawdowns[assetIndex],
          1 - prices[assetIndex] / peaks[assetIndex],
        );
        pathContainsJump[assetIndex] ||= count > 0;
        jumpTotals[assetIndex] += count;
        pathCrashed ||= aggregateLogJump < Math.log(0.8);
        if (pathIndex < sampleCount && count > 0) {
          sampledJumpEvents.push({
            pathIndex,
            stepIndex,
            assetIndex,
            count,
            aggregateLogJump,
          });
        }
      });
    }
    if (pathIndex < sampleCount) sampledPricePaths.push(path.map(asPriceSeries));
    terminalPrices.push(asPriceSeries([...prices]));
    pathMaximumDrawdowns.forEach((drawdown, assetIndex) => {
      maximumDrawdowns[assetIndex].push(drawdown);
      if (pathContainsJump[assetIndex]) {
        jumpConditionedDrawdowns[assetIndex].push(drawdown);
      }
    });
    pathsWithCrash += Number(pathCrashed);
  }

  const elapsedYears = input.execution.steps * input.execution.stepYears;
  const terminalLosses = input.assets.map((_, assetIndex) =>
    terminalPrices.map((prices) =>
      Math.max(0, 1 - prices[assetIndex] / input.initialPrices[assetIndex]),
    ),
  );
  const terminalLoss95VaR = terminalLosses.map((losses) => quantile(losses, 0.95));
  return envelope(input.contract, "market-model/merton-jump-diffusion-result@1", input.execution.seed, {
    contract: "market-model/merton-jump-diffusion-result@1",
    sampledPricePaths,
    terminalPrices,
    sampledJumpEvents,
    diagnostics: {
      empiricalAnnualJumpCounts: jumpTotals.map(
        (count) => count / (input.execution.paths * elapsedYears),
      ),
      probabilityOfAnyCrash: pathsWithCrash / input.execution.paths,
      compensatedMeanGrowth: input.assets.map((asset) =>
        Math.exp(asset.annualDrift * elapsedYears),
      ),
      terminalLoss95VaR,
      terminalLoss95Cvar: terminalLosses.map((losses, assetIndex) => {
        const tail = losses.filter((loss) => loss >= terminalLoss95VaR[assetIndex]);
        return mean(tail);
      }),
      meanMaximumDrawdown: maximumDrawdowns.map(mean),
      jumpConditionedMeanMaximumDrawdown: jumpConditionedDrawdowns.map(
        (drawdowns) => (drawdowns.length === 0 ? null : mean(drawdowns)),
      ),
    },
  });
}

export interface GarchParameters {
  /** Per-step variance intercept. */
  readonly omega: number;
  readonly alpha: number;
  readonly beta: number;
  /** Per-step conditional mean return. */
  readonly meanReturn: number;
}

export interface GarchInput {
  readonly contract: "market-model/garch-1-1@1";
  readonly parameters: GarchParameters;
  readonly initialVariance: number | "unconditional";
  readonly innovation:
    | { readonly kind: "gaussian" }
    | { readonly kind: "student-t"; readonly degreesOfFreedom: number };
  readonly execution: {
    readonly seed: number;
    readonly paths: number;
    readonly steps: number;
    readonly samplePaths?: number;
  };
}

export interface GarchResult {
  readonly contract: "market-model/garch-1-1-result@1";
  readonly sampledReturns: readonly ReturnSeries[];
  readonly sampledConditionalVariances: readonly VarianceSeries[];
  readonly volatilityCone: readonly {
    readonly step: number;
    readonly expectedVariance: number;
    readonly annualizedVolatility: number;
  }[];
  readonly diagnostics: {
    readonly persistence: number;
    readonly unconditionalVariance: number | null;
    readonly initialVariancePolicy: "supplied" | "unconditional";
  };
}

export function runGarch(input: GarchInput): ModelEnvelope<GarchResult> {
  const warnings = validateGarchInput(input);
  const { parameters } = input;
  const persistence = parameters.alpha + parameters.beta;
  const unconditionalVariance =
    persistence < 1 ? parameters.omega / (1 - persistence) : null;
  const initialVariance =
    input.initialVariance === "unconditional"
      ? unconditionalVariance!
      : input.initialVariance;
  const random = createSemanticRandom(input.execution.seed, input.contract);
  const sampleCount = Math.min(input.execution.samplePaths ?? 32, input.execution.paths);
  const sampledReturns: ReturnSeries[] = [];
  const sampledConditionalVariances: VarianceSeries[] = [];

  for (let pathIndex = 0; pathIndex < input.execution.paths; pathIndex += 1) {
    let conditionalVariance = initialVariance;
    let priorInnovation = 0;
    const returns: number[] = [];
    const variances: number[] = [];
    for (let stepIndex = 0; stepIndex < input.execution.steps; stepIndex += 1) {
      if (stepIndex > 0) {
        conditionalVariance =
          parameters.omega +
          parameters.alpha * priorInnovation ** 2 +
          parameters.beta * conditionalVariance;
      }
      conditionalVariance = Math.max(0, conditionalVariance);
      assertFiniteSimulationValue(
        conditionalVariance,
        `sampledConditionalVariances.${pathIndex}.${stepIndex}`,
        "GARCH variance recurrence overflowed. Reduce the coefficients or initial variance.",
      );
      const standardizedInnovation = standardizedGarchInnovation(
        input.innovation,
        random,
        pathIndex,
        stepIndex,
      );
      priorInnovation = Math.sqrt(conditionalVariance) * standardizedInnovation;
      const value = parameters.meanReturn + priorInnovation;
      assertFiniteSimulationValue(
        value,
        `sampledReturns.${pathIndex}.${stepIndex}`,
        "GARCH return recurrence overflowed. Reduce the coefficients or initial variance.",
      );
      if (pathIndex < sampleCount) {
        returns.push(value);
        variances.push(conditionalVariance);
      }
    }
    if (pathIndex < sampleCount) {
      sampledReturns.push(asReturnSeries(returns));
      sampledConditionalVariances.push(asVarianceSeries(variances));
    }
  }

  const cone = buildGarchVolatilityCone(parameters, initialVariance, input.execution.steps);
  return {
    result: {
      contract: "market-model/garch-1-1-result@1",
      sampledReturns,
      sampledConditionalVariances,
      volatilityCone: cone,
      diagnostics: {
        persistence,
        unconditionalVariance,
        initialVariancePolicy:
          input.initialVariance === "unconditional" ? "unconditional" : "supplied",
      },
    },
    warnings,
    provenance: {
      engineVersion: `${MARKET_MODELS_VERSION}+${QUANT_CORE_VERSION}`,
      seed: input.execution.seed,
      inputContract: input.contract,
      resultContract: "market-model/garch-1-1-result@1",
    },
  };
}

export function buildGarchVolatilityCone(
  parameters: GarchParameters,
  latestVariance: number,
  horizonSteps: number,
  periodsPerYear = 252,
): GarchResult["volatilityCone"] {
  const persistence = parameters.alpha + parameters.beta;
  let forecast = latestVariance;
  return Array.from({ length: horizonSteps }, (_, index) => {
    forecast = parameters.omega + persistence * forecast;
    assertFiniteSimulationValue(
      forecast,
      `volatilityCone.${index}.expectedVariance`,
      "GARCH volatility forecast overflowed. Reduce the coefficients, horizon, or latest variance.",
    );
    const annualizedVolatility = Math.sqrt(Math.max(0, forecast) * periodsPerYear);
    assertFiniteSimulationValue(
      annualizedVolatility,
      `volatilityCone.${index}.annualizedVolatility`,
      "GARCH annualized volatility overflowed.",
    );
    return {
      step: index + 1,
      expectedVariance: forecast,
      annualizedVolatility,
    };
  });
}

export const STUDENT_T_INNOVATIONS_REQUEST_CONTRACT =
  "market-model/student-t-innovations@1";
export const STUDENT_T_INNOVATIONS_RESULT_CONTRACT =
  "market-model/student-t-innovations-result@1";

export interface StudentTInnovationsRequest {
  readonly contract: typeof STUDENT_T_INNOVATIONS_REQUEST_CONTRACT;
  readonly degreesOfFreedom: number;
  readonly seed: number;
  readonly samples: number;
  /** Absolute standardized-innovation threshold used for the paired tail comparison. */
  readonly tailThreshold: number;
}

export interface StudentTInnovationsResult {
  readonly contract: typeof STUDENT_T_INNOVATIONS_RESULT_CONTRACT;
  readonly normalInnovations: readonly number[];
  readonly standardizedStudentTInnovations: readonly number[];
  readonly diagnostics: {
    readonly degreesOfFreedom: number;
    readonly standardizationScale: number;
    readonly tailThreshold: number;
    readonly normalVariance: number;
    readonly studentTVariance: number;
    readonly normalTailProbability: number;
    readonly studentTTailProbability: number;
    readonly sharedNormalNumerators: true;
  };
}

/**
 * Draws a unit-variance Student-t sample beside a paired standard normal sample.
 * Each pair shares its normal numerator; only the Student-t scale mixture differs.
 */
export function runStudentTInnovations(
  request: StudentTInnovationsRequest,
): ModelEnvelope<StudentTInnovationsResult> {
  validateStudentTInnovationsRequest(request);
  const random = createSemanticRandom(request.seed, request.contract);
  const normalInnovations: number[] = [];
  const standardizedStudentTInnovations: number[] = [];
  const standardizationScale = Math.sqrt(
    (request.degreesOfFreedom - 2) / request.degreesOfFreedom,
  );

  for (let sampleIndex = 0; sampleIndex < request.samples; sampleIndex += 1) {
    const sharedNumerator = inverseNormalCdf(
      random.uniform("shared-normal-uniform", sampleIndex),
    );
    const chiSquared = random.gamma(
      request.degreesOfFreedom / 2,
      2,
      "student-t/chi-square",
      sampleIndex,
    );
    normalInnovations.push(sharedNumerator);
    standardizedStudentTInnovations.push(
      standardizeStudentT(
        sharedNumerator / Math.sqrt(chiSquared / request.degreesOfFreedom),
        request.degreesOfFreedom,
      ),
    );
  }

  const normalTailProbability = twoSidedTailFrequency(
    normalInnovations,
    request.tailThreshold,
  );
  const studentTTailProbability = twoSidedTailFrequency(
    standardizedStudentTInnovations,
    request.tailThreshold,
  );
  return envelope(
    request.contract,
    STUDENT_T_INNOVATIONS_RESULT_CONTRACT,
    request.seed,
    {
      contract: STUDENT_T_INNOVATIONS_RESULT_CONTRACT,
      normalInnovations,
      standardizedStudentTInnovations,
      diagnostics: {
        degreesOfFreedom: request.degreesOfFreedom,
        standardizationScale,
        tailThreshold: request.tailThreshold,
        normalVariance: populationVariance(normalInnovations),
        studentTVariance: populationVariance(standardizedStudentTInnovations),
        normalTailProbability,
        studentTTailProbability,
        sharedNormalNumerators: true,
      },
    },
    request.samples < 1_000
      ? [{
          code: "PRECISION",
          message: "Fewer than 1,000 draws can make the tail-frequency comparison noisy.",
        }]
      : [],
  );
}

export function fitGarch(
  dataset: ReturnDataset,
  assetIndex = 0,
): CalibrationSnapshot<GarchParameters> {
  validateReturnDataset(dataset);
  assertIntegerInRange(assetIndex, 0, dataset.assetIds.length - 1, "assetIndex");
  const returns = dataset.rows.map((row) => row[assetIndex]);
  const meanReturn = mean(returns);
  const centered = returns.map((value) => value - meanReturn);
  const empiricalVariance = populationVariance(centered);
  let best = {
    parameters: {
      omega: empiricalVariance * 0.05,
      alpha: 0.05,
      beta: 0.9,
      meanReturn,
    },
    objective: Number.POSITIVE_INFINITY,
  };
  let evaluations = 0;
  for (const alpha of [0.02, 0.05, 0.1, 0.15, 0.2]) {
    for (const beta of [0.5, 0.65, 0.75, 0.85, 0.9, 0.94]) {
      if (alpha + beta >= 0.995) continue;
      const omega = Math.max(1e-12, empiricalVariance * (1 - alpha - beta));
      const parameters = { omega, alpha, beta, meanReturn };
      const objective = garchNegativeLogLikelihood(centered, parameters, empiricalVariance);
      evaluations += 1;
      if (objective < best.objective) best = { parameters, objective };
    }
  }
  return {
    contract: "calibration-snapshot@1",
    modelContract: "market-model/garch-1-1@1",
    schemaVersion: 1,
    observationFrequency: dataset.frequency,
    returnConvention: dataset.returnConvention,
    sampleStart: dataset.timestamps[0],
    sampleEnd: dataset.timestamps.at(-1)!,
    estimates: best.parameters,
    fittingMethod: "bounded Gaussian quasi-maximum-likelihood grid",
    convergence: {
      converged: Number.isFinite(best.objective),
      iterations: evaluations,
      objective: best.objective,
    },
    warnings:
      returns.length < 100
        ? ["Fewer than 100 observations make volatility persistence uncertain."]
        : [],
    dataProvenance: dataset.provenance,
  };
}

export interface BootstrapInput {
  readonly contract: "market-model/historical-bootstrap@1";
  readonly dataset: ReturnDataset;
  readonly method:
    | { readonly kind: "iid" }
    | { readonly kind: "moving-block"; readonly blockSize: number };
  readonly seed: number;
  readonly paths: number;
  readonly steps: number;
  readonly samplePaths?: number;
}

export interface BootstrapResult {
  readonly contract: "market-model/historical-bootstrap-result@1";
  readonly sampledRows: readonly NumericMatrix[];
  readonly sampledSourceIndexes: readonly (readonly number[])[];
  readonly provenance: {
    readonly sourceLabel: string;
    readonly sampleStart: string;
    readonly sampleEnd: string;
    readonly method: BootstrapInput["method"];
    readonly replacement: true;
  };
}

export function runHistoricalBootstrap(
  input: BootstrapInput,
): ModelEnvelope<BootstrapResult> {
  if (input.contract !== "market-model/historical-bootstrap@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported historical-bootstrap contract.");
  }
  validateReturnDataset(input.dataset);
  assertIntegerInRange(input.paths, 1, 10_000, "paths");
  assertIntegerInRange(input.steps, 1, 10_000, "steps");
  if (input.paths * input.steps * input.dataset.assetIds.length > 5_000_000) {
    throw new QuantError("OUT_OF_RANGE", "Bootstrap request exceeds the five-million-cell limit.");
  }
  if (input.samplePaths !== undefined) {
    assertIntegerInRange(input.samplePaths, 1, input.paths, "samplePaths");
  }
  if (input.method.kind === "moving-block") {
    assertIntegerInRange(
      input.method.blockSize,
      1,
      input.dataset.rows.length,
      "method.blockSize",
    );
  }
  const sampleCount = Math.min(input.samplePaths ?? 32, input.paths);
  assertRetainedValueLimit(
    sampleCount * input.steps * (input.dataset.assetIds.length + 1),
    "samplePaths",
  );
  const random = createSemanticRandom(input.seed, input.contract);
  const sampledRows: number[][][] = [];
  const sampledSourceIndexes: number[][] = [];
  for (let pathIndex = 0; pathIndex < sampleCount; pathIndex += 1) {
    const indexes = bootstrapIndexes(input, random, pathIndex);
    sampledSourceIndexes.push(indexes);
    sampledRows.push(indexes.map((index) => [...input.dataset.rows[index]]));
  }
  return envelope(input.contract, "market-model/historical-bootstrap-result@1", input.seed, {
    contract: "market-model/historical-bootstrap-result@1",
    sampledRows,
    sampledSourceIndexes,
    provenance: {
      sourceLabel: input.dataset.provenance.label,
      sampleStart: input.dataset.timestamps[0],
      sampleEnd: input.dataset.timestamps.at(-1)!,
      method: input.method,
      replacement: true,
    },
  });
}

export interface CopulaInput {
  readonly contract: "market-model/copula@1";
  readonly kind: "gaussian" | "student-t";
  readonly correlation: NumericMatrix;
  readonly degreesOfFreedom?: number;
  readonly seed: number;
  readonly samples: number;
}

export interface CopulaResult {
  readonly contract: "market-model/copula-result@1";
  readonly standardizedInnovations: NumericMatrix;
  readonly uniforms: NumericMatrix;
  readonly diagnostics: {
    readonly empiricalCorrelation: NumericMatrix;
    readonly lowerTailCoMovement: number;
  };
}

export function runCopula(input: CopulaInput): ModelEnvelope<CopulaResult> {
  if (input.contract !== "market-model/copula@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported copula contract.");
  }
  assertIntegerInRange(input.samples, 2, 100_000, "samples");
  if (input.kind === "student-t") {
    if ((input.degreesOfFreedom ?? 0) <= 2) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "Student-t copula degrees of freedom must exceed two so standardized variance exists.",
        "degreesOfFreedom",
      );
    }
  }
  const lower = factorCorrelationMatrix(input.correlation);
  if (input.samples * input.correlation.length > 5_000_000) {
    throw new QuantError("OUT_OF_RANGE", "Copula output exceeds the five-million-cell limit.");
  }
  const random = createSemanticRandom(input.seed, input.contract);
  const innovations: number[][] = [];
  const uniforms: number[][] = [];
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex += 1) {
    const independent = input.correlation.map((_, dimension) =>
      random.normal("copula/z", sampleIndex, dimension),
    );
    let correlated = matrixVectorMultiply(lower, independent);
    if (input.kind === "student-t") {
      const degreesOfFreedom = input.degreesOfFreedom!;
      const chiSquare = random.gamma(
        degreesOfFreedom / 2,
        2,
        "copula/scale",
        sampleIndex,
      );
      correlated = correlated.map(
        (value) =>
          (value / Math.sqrt(chiSquare / degreesOfFreedom)) *
          Math.sqrt((degreesOfFreedom - 2) / degreesOfFreedom),
      );
    }
    innovations.push(correlated);
    uniforms.push(
      input.kind === "student-t"
        ? correlated.map((value) => {
            const degreesOfFreedom = input.degreesOfFreedom!;
            const rawStudentT =
              value / Math.sqrt((degreesOfFreedom - 2) / degreesOfFreedom);
            return studentTCdf(rawStudentT, degreesOfFreedom);
          })
        : correlated.map(normalCdf),
    );
  }
  const columns = input.correlation.map((_, dimension) =>
    innovations.map((row) => row[dimension]),
  );
  const empiricalCorrelation = columns.map((left) =>
    columns.map((right) => correlation(left, right)),
  );
  const tailThresholds = columns.map((column) => quantile(column, 0.05));
  const jointTailCount = innovations.filter((row) =>
    row.every((value, dimension) => value <= tailThresholds[dimension]),
  ).length;
  return envelope(input.contract, "market-model/copula-result@1", input.seed, {
    contract: "market-model/copula-result@1",
    standardizedInnovations: innovations,
    uniforms,
    diagnostics: {
      empiricalCorrelation,
      lowerTailCoMovement: jointTailCount / input.samples,
    },
  });
}

export interface RegimeCalibrationResult {
  readonly regimeLabels: readonly string[];
  readonly means: readonly number[];
  readonly volatilities: readonly number[];
  readonly transitionMatrix: NumericMatrix;
  readonly statePath: readonly number[];
}

export const ORDERED_REGIME_MINIMUM_DISTINCT_OBSERVATIONS = 5;

/**
 * Educational deterministic regime calibration: returns are assigned to
 * ordered low/middle/high clusters and one-step transitions are counted with a
 * small Laplace prior. This keeps label identity explicit; it is not EM/HMM MLE.
 */
export function fitOrderedRegimes(
  dataset: ReturnDataset,
  assetIndex = 0,
): CalibrationSnapshot<RegimeCalibrationResult> {
  validateReturnDataset(dataset);
  assertIntegerInRange(assetIndex, 0, dataset.assetIds.length - 1, "assetIndex");
  const returns = dataset.rows.map((row) => row[assetIndex]);
  if (new Set(returns).size < ORDERED_REGIME_MINIMUM_DISTINCT_OBSERVATIONS) {
    throw new QuantError(
      "INVALID_INPUT",
      "Ordered three-regime calibration needs at least five distinct return observations.",
      `rows.*.${assetIndex}`,
    );
  }
  const lower = quantile(returns, 1 / 3);
  const upper = quantile(returns, 2 / 3);
  const statePath = returns.map((value) => (value <= lower ? 0 : value >= upper ? 2 : 1));
  const buckets = [0, 1, 2].map((state) =>
    returns.filter((_, index) => statePath[index] === state),
  );
  if (buckets.some((bucket) => bucket.length === 0)) {
    throw new QuantError(
      "INVALID_INPUT",
      "Ordered three-regime calibration cannot form three states when ties collapse a tertile bucket.",
      `rows.*.${assetIndex}`,
    );
  }
  const counts = Array.from({ length: 3 }, () => Array(3).fill(1) as number[]);
  for (let index = 1; index < statePath.length; index += 1) {
    counts[statePath[index - 1]][statePath[index]] += 1;
  }
  const transitionMatrix = counts.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    return row.map((value) => value / total);
  });
  const estimates: RegimeCalibrationResult = {
    regimeLabels: ["bear", "sideways", "bull"],
    means: buckets.map(mean),
    volatilities: buckets.map((values) => Math.sqrt(populationVariance(values))),
    transitionMatrix,
    statePath,
  };
  return {
    contract: "calibration-snapshot@1",
    modelContract: "market-model/ordered-regimes@1",
    schemaVersion: 1,
    observationFrequency: dataset.frequency,
    returnConvention: dataset.returnConvention,
    sampleStart: dataset.timestamps[0],
    sampleEnd: dataset.timestamps.at(-1)!,
    estimates,
    fittingMethod: "ordered three-bin illustrative classification with Laplace-smoothed transitions",
    convergence: { converged: true, iterations: 1 },
    warnings: ["This transparent classroom classifier is not maximum-likelihood HMM calibration."],
    dataProvenance: dataset.provenance,
  };
}

export interface CompositeMarketInput {
  readonly contract: "market-model/hmm-garch-copula-jump@1";
  readonly initialPrices: readonly number[];
  readonly regimes: {
    readonly initialProbabilities: readonly number[];
    readonly transitionMatrix: NumericMatrix;
    readonly annualDrifts: NumericMatrix;
  };
  readonly garch: readonly GarchParameters[];
  readonly copula: {
    readonly correlation: NumericMatrix;
    readonly kind: "gaussian" | "student-t";
    readonly degreesOfFreedom?: number;
  };
  readonly jumps: readonly JumpSpec[];
  readonly enabled: {
    readonly regimes: boolean;
    readonly dynamicVariance: boolean;
    readonly dependence: boolean;
    readonly jumps: boolean;
  };
  readonly execution: {
    readonly seed: number;
    readonly paths: number;
    readonly steps: number;
    readonly stepYears: number;
    readonly samplePaths?: number;
  };
}

export interface CompositeMarketResult {
  readonly contract: "market-model/hmm-garch-copula-jump-result@1";
  readonly sampledPrices: readonly (readonly PriceSeries[])[];
  readonly diagnostics: {
    readonly sampledRegimes: NumericMatrix;
    readonly sampledVariances: readonly NumericMatrix[];
    readonly jumpEvents: readonly JumpEvent[];
    readonly updateOrder: "hmm->garch->copula->jump->price";
  };
}

export function runCompositeMarket(
  input: CompositeMarketInput,
): ModelEnvelope<CompositeMarketResult> {
  validateCompositeInput(input);
  const dimension = input.initialPrices.length;
  const random = createSemanticRandom(input.execution.seed, input.contract);
  const jumpCompensations = input.enabled.jumps
    ? input.jumps.map((jump, index) =>
        calculateJumpCompensation(jump, `jumps.${index}`),
      )
    : input.jumps.map(() => 0);
  const dependence = input.enabled.dependence
    ? factorCorrelationMatrix(input.copula.correlation)
    : Array.from({ length: dimension }, (_, row) =>
        Array.from({ length: dimension }, (_, column) => Number(row === column)),
      );
  const sampleCount = Math.min(input.execution.samplePaths ?? 16, input.execution.paths);
  const sampledPrices: PriceSeries[][] = [];
  const sampledRegimes: number[][] = [];
  const sampledVariances: number[][][] = [];
  const jumpEvents: JumpEvent[] = [];

  for (let pathIndex = 0; pathIndex < input.execution.paths; pathIndex += 1) {
    const prices = [...input.initialPrices];
    const paths = prices.map((price) => [price]);
    const variances = input.garch.map((parameters) =>
      parameters.alpha + parameters.beta < 1
        ? parameters.omega / (1 - parameters.alpha - parameters.beta)
        : parameters.omega,
    );
    const variancePaths = variances.map((value) => [value]);
    const priorInnovations = Array(dimension).fill(0) as number[];
    let regime = sampleCategorical(
      input.regimes.initialProbabilities,
      random.uniform("regime/initial", pathIndex),
    );
    const regimePath = [regime];

    for (let stepIndex = 1; stepIndex <= input.execution.steps; stepIndex += 1) {
      if (input.enabled.regimes) {
        regime = sampleCategorical(
          input.regimes.transitionMatrix[regime],
          random.uniform("regime/transition", pathIndex, stepIndex),
        );
      } else {
        regime = 0;
      }
      regimePath.push(regime);
      for (let assetIndex = 0; assetIndex < dimension; assetIndex += 1) {
        if (input.enabled.dynamicVariance) {
          const parameters = input.garch[assetIndex];
          variances[assetIndex] = Math.max(
            0,
            parameters.omega +
              parameters.alpha * priorInnovations[assetIndex] ** 2 +
              parameters.beta * variances[assetIndex],
          );
          assertFiniteSimulationValue(
            variances[assetIndex],
            `sampledVariances.${pathIndex}.${assetIndex}.${stepIndex}`,
            "Composite GARCH variance overflowed. Reduce the variance coefficients.",
          );
        }
      }
      let independent = Array.from({ length: dimension }, (_, assetIndex) =>
        random.normal("diffusion", pathIndex, stepIndex, assetIndex),
      );
      if (input.copula.kind === "student-t") {
        const degreesOfFreedom = input.copula.degreesOfFreedom!;
        const varianceScale = Math.sqrt(
          (degreesOfFreedom - 2) / degreesOfFreedom,
        );
        if (input.enabled.dependence) {
          const commonScale = Math.sqrt(
            random.gamma(
              degreesOfFreedom / 2,
              2,
              "copula/scale",
              pathIndex,
              stepIndex,
            ) / degreesOfFreedom,
          );
          independent = independent.map(
            (value) => (value / commonScale) * varianceScale,
          );
        } else {
          independent = independent.map((value, assetIndex) => {
            const independentScale = Math.sqrt(
              random.gamma(
                degreesOfFreedom / 2,
                2,
                "copula/independent-scale",
                pathIndex,
                stepIndex,
                assetIndex,
              ) / degreesOfFreedom,
            );
            return (value / independentScale) * varianceScale;
          });
        }
      }
      const innovations = matrixVectorMultiply(dependence, independent);
      for (let assetIndex = 0; assetIndex < dimension; assetIndex += 1) {
        const jump = input.jumps[assetIndex];
        const count = input.enabled.jumps
          ? random.poisson(
              jump.annualIntensity * input.execution.stepYears,
              "jump/arrival",
              pathIndex,
              stepIndex,
              assetIndex,
            )
          : 0;
        assertBoundedJumpCount(count);
        let aggregateLogJump = 0;
        for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
          aggregateLogJump +=
            jump.meanLogJump +
            jump.logJumpVolatility *
              random.normal("jump/size", pathIndex, stepIndex, assetIndex, eventIndex);
        }
        const variance = variances[assetIndex];
        priorInnovations[assetIndex] = Math.sqrt(variance) * innovations[assetIndex];
        const drift = input.regimes.annualDrifts[regime][assetIndex];
        const logGrowth =
          (drift - jumpCompensations[assetIndex]) *
            input.execution.stepYears -
            0.5 * variance +
            priorInnovations[assetIndex] +
            aggregateLogJump;
        assertFiniteSimulationValue(
          logGrowth,
          `sampledLogGrowth.${pathIndex}.${assetIndex}.${stepIndex}`,
          "Composite market log growth overflowed. Reduce the horizon or model scale.",
        );
        prices[assetIndex] *= Math.exp(logGrowth);
        assertPositiveFiniteSimulationValue(
          prices[assetIndex],
          `sampledPrices.${pathIndex}.${assetIndex}.${stepIndex}`,
          "Composite market price overflowed or underflowed. Reduce the horizon or model scale.",
        );
        paths[assetIndex].push(prices[assetIndex]);
        variancePaths[assetIndex].push(variance);
        if (pathIndex < sampleCount && count > 0) {
          jumpEvents.push({ pathIndex, stepIndex, assetIndex, count, aggregateLogJump });
        }
      }
    }
    if (pathIndex < sampleCount) {
      sampledPrices.push(paths.map(asPriceSeries));
      sampledRegimes.push(regimePath);
      sampledVariances.push(variancePaths);
    }
  }
  const warnings: ModelWarning[] = input.garch.flatMap((parameters, index) =>
    parameters.alpha + parameters.beta >= 1
      ? [{ code: "STATIONARITY" as const, message: `Asset ${index + 1} has nonstationary GARCH persistence.` }]
      : [],
  );
  return {
    result: {
      contract: "market-model/hmm-garch-copula-jump-result@1",
      sampledPrices,
      diagnostics: {
        sampledRegimes,
        sampledVariances,
        jumpEvents,
        updateOrder: "hmm->garch->copula->jump->price",
      },
    },
    warnings,
    provenance: {
      engineVersion: `${MARKET_MODELS_VERSION}+${QUANT_CORE_VERSION}`,
      seed: input.execution.seed,
      inputContract: input.contract,
      resultContract: "market-model/hmm-garch-copula-jump-result@1",
    },
  };
}

export function standardizeStudentT(value: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 2) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Student-t degrees of freedom must exceed two for finite variance.",
    );
  }
  return value * Math.sqrt((degreesOfFreedom - 2) / degreesOfFreedom);
}

function validateStudentTInnovationsRequest(
  request: StudentTInnovationsRequest,
): void {
  if (request.contract !== STUDENT_T_INNOVATIONS_REQUEST_CONTRACT) {
    throw new QuantError("INVALID_INPUT", "Unsupported Student-t innovation contract.");
  }
  assertFinite(request.degreesOfFreedom, "degreesOfFreedom");
  if (request.degreesOfFreedom <= 2) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Student-t degrees of freedom must exceed two so standardized variance exists.",
      "degreesOfFreedom",
    );
  }
  assertFinite(request.seed, "seed");
  assertIntegerInRange(request.samples, 2, 100_000, "samples");
  assertPositive(request.tailThreshold, "tailThreshold");
}

function twoSidedTailFrequency(
  values: readonly number[],
  threshold: number,
): number {
  return values.filter((value) => Math.abs(value) > threshold).length / values.length;
}

function validateJumpInput(input: MertonJumpDiffusionInput): void {
  if (input.contract !== "market-model/merton-jump-diffusion@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported jump-diffusion contract.");
  }
  const dimension = input.initialPrices.length;
  if (dimension < 1 || dimension > 2 || input.assets.length !== dimension || input.jumps.length !== dimension) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Jump diffusion supports one or two consistently specified assets.",
    );
  }
  input.initialPrices.forEach((value, index) => assertPositive(value, `initialPrices.${index}`));
  input.assets.forEach((asset, index) => {
    assertFinite(asset.annualDrift, `assets.${index}.annualDrift`);
    assertNonNegative(asset.annualVolatility, `assets.${index}.annualVolatility`);
  });
  input.jumps.forEach((jump, index) => {
    assertNonNegative(jump.annualIntensity, `jumps.${index}.annualIntensity`);
    assertFinite(jump.meanLogJump, `jumps.${index}.meanLogJump`);
    assertNonNegative(jump.logJumpVolatility, `jumps.${index}.logJumpVolatility`);
  });
  factorCorrelationMatrix(input.correlation);
  if (input.correlation.length !== dimension) {
    throw new QuantError("DIMENSION_MISMATCH", "Correlation dimensions must match assets.");
  }
  validateExecution(input.execution, {
    assets: dimension,
    additionalWork: expectedJumpEventWork(input.jumps, input.execution),
    retainedValues:
      input.execution.paths * dimension +
      Math.min(input.execution.samplePaths ?? 24, input.execution.paths) *
        dimension *
        (input.execution.steps + 1) +
      retainedJumpEventValues(
        input.jumps,
        input.execution,
        Math.min(input.execution.samplePaths ?? 24, input.execution.paths),
      ),
  });
}

function validateGarchInput(input: GarchInput): ModelWarning[] {
  if (input.contract !== "market-model/garch-1-1@1") {
    throw new QuantError("INVALID_INPUT", "Unsupported GARCH contract.");
  }
  const { parameters } = input;
  assertPositive(parameters.omega, "parameters.omega");
  assertNonNegative(parameters.alpha, "parameters.alpha");
  assertNonNegative(parameters.beta, "parameters.beta");
  assertFinite(parameters.meanReturn, "parameters.meanReturn");
  const persistence = parameters.alpha + parameters.beta;
  if (!Number.isFinite(persistence)) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "GARCH alpha + beta must remain finite.",
      "parameters",
    );
  }
  if (input.initialVariance !== "unconditional") {
    assertNonNegative(input.initialVariance, "initialVariance");
  } else if (persistence >= 1) {
    throw new QuantError(
      "INVALID_INPUT",
      "Unconditional initial variance requires alpha + beta below one.",
    );
  }
  if (!(["gaussian", "student-t"] as readonly unknown[]).includes(input.innovation.kind)) {
    throw new QuantError("INVALID_INPUT", "Unsupported GARCH innovation kind.", "innovation.kind");
  }
  if (input.innovation.kind === "student-t") {
    assertFinite(input.innovation.degreesOfFreedom, "innovation.degreesOfFreedom");
  }
  if (input.innovation.kind === "student-t" && input.innovation.degreesOfFreedom <= 2) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Student-t degrees of freedom must exceed two so variance exists.",
    );
  }
  validateExecution(
    { ...input.execution, stepYears: 1 },
    {
      retainedValues:
        2 *
          Math.min(input.execution.samplePaths ?? 32, input.execution.paths) *
          input.execution.steps +
        input.execution.steps,
    },
  );
  return persistence >= 1
    ? [{
        code: "STATIONARITY",
        message: "alpha + beta is at least one, so unconditional variance does not exist.",
      }]
    : [];
}

function standardizedGarchInnovation(
  innovation: GarchInput["innovation"],
  random: ReturnType<typeof createSemanticRandom>,
  pathIndex: number,
  stepIndex: number,
): number {
  if (innovation.kind === "gaussian") {
    return random.normal("innovation", pathIndex, stepIndex);
  }
  return standardizeStudentT(
    random.studentT(innovation.degreesOfFreedom, "innovation", pathIndex, stepIndex),
    innovation.degreesOfFreedom,
  );
}

function garchNegativeLogLikelihood(
  centeredReturns: readonly number[],
  parameters: GarchParameters,
  initialVariance: number,
): number {
  let variance = Math.max(initialVariance, 1e-12);
  let priorInnovation = 0;
  let objective = 0;
  for (const innovation of centeredReturns) {
    variance = Math.max(
      1e-12,
      parameters.omega + parameters.alpha * priorInnovation ** 2 + parameters.beta * variance,
    );
    objective += 0.5 * (Math.log(variance) + innovation ** 2 / variance);
    priorInnovation = innovation;
  }
  return objective;
}

function bootstrapIndexes(
  input: BootstrapInput,
  random: ReturnType<typeof createSemanticRandom>,
  pathIndex: number,
): number[] {
  const rowCount = input.dataset.rows.length;
  if (input.method.kind === "iid") {
    return Array.from({ length: input.steps }, (_, stepIndex) =>
      Math.floor(random.uniform("iid", pathIndex, stepIndex) * rowCount),
    );
  }
  const indexes: number[] = [];
  for (let block = 0; indexes.length < input.steps; block += 1) {
    const start = Math.floor(random.uniform("block", pathIndex, block) * rowCount);
    for (let offset = 0; offset < input.method.blockSize && indexes.length < input.steps; offset += 1) {
      indexes.push((start + offset) % rowCount);
    }
  }
  return indexes;
}

function validateCompositeInput(input: CompositeMarketInput): void {
  const dimension = input.initialPrices.length;
  if (
    input.contract !== "market-model/hmm-garch-copula-jump@1" ||
    dimension === 0 ||
    input.garch.length !== dimension ||
    input.jumps.length !== dimension
  ) {
    throw new QuantError("DIMENSION_MISMATCH", "Composite model dimensions must agree.");
  }
  input.initialPrices.forEach((value, index) => assertPositive(value, `initialPrices.${index}`));
  validateProbabilityVector(input.regimes.initialProbabilities, "regimes.initialProbabilities");
  if (
    input.regimes.transitionMatrix.length !== input.regimes.initialProbabilities.length ||
    input.regimes.annualDrifts.length !== input.regimes.initialProbabilities.length
  ) {
    throw new QuantError("DIMENSION_MISMATCH", "Regime dimensions must agree.");
  }
  input.regimes.transitionMatrix.forEach((row, index) =>
    validateProbabilityVector(row, `regimes.transitionMatrix.${index}`),
  );
  input.regimes.annualDrifts.forEach((row, index) => {
    if (row.length !== dimension) {
      throw new QuantError("DIMENSION_MISMATCH", "Each regime needs one drift per asset.");
    }
    row.forEach((value, assetIndex) => assertFinite(value, `regimes.annualDrifts.${index}.${assetIndex}`));
  });
  input.garch.forEach((parameters, index) => {
    assertPositive(parameters.omega, `garch.${index}.omega`);
    assertNonNegative(parameters.alpha, `garch.${index}.alpha`);
    assertNonNegative(parameters.beta, `garch.${index}.beta`);
    assertFinite(parameters.meanReturn, `garch.${index}.meanReturn`);
    if (!Number.isFinite(parameters.alpha + parameters.beta)) {
      throw new QuantError(
        "OUT_OF_RANGE",
        "Composite GARCH alpha + beta must remain finite.",
        `garch.${index}`,
      );
    }
  });
  input.jumps.forEach((jump, index) => {
    assertNonNegative(jump.annualIntensity, `jumps.${index}.annualIntensity`);
    assertFinite(jump.meanLogJump, `jumps.${index}.meanLogJump`);
    assertNonNegative(jump.logJumpVolatility, `jumps.${index}.logJumpVolatility`);
  });
  factorCorrelationMatrix(input.copula.correlation);
  if (input.copula.correlation.length !== dimension) {
    throw new QuantError("DIMENSION_MISMATCH", "Copula dimensions must match assets.");
  }
  if (!(["gaussian", "student-t"] as readonly unknown[]).includes(input.copula.kind)) {
    throw new QuantError("INVALID_INPUT", "Unsupported copula kind.", "copula.kind");
  }
  if (input.copula.kind === "student-t") {
    assertFinite(
      input.copula.degreesOfFreedom ?? Number.NaN,
      "copula.degreesOfFreedom",
    );
  }
  if (input.copula.kind === "student-t" && (input.copula.degreesOfFreedom ?? 0) <= 2) {
    throw new QuantError("OUT_OF_RANGE", "Student-t copula degrees of freedom must exceed two.");
  }
  (["regimes", "dynamicVariance", "dependence", "jumps"] as const).forEach(
    (key) => {
      if (typeof input.enabled[key] !== "boolean") {
        throw new QuantError(
          "INVALID_INPUT",
          `enabled.${key} must be a boolean.`,
          `enabled.${key}`,
        );
      }
    },
  );
  const sampleCount = Math.min(
    input.execution.samplePaths ?? 16,
    input.execution.paths,
  );
  validateExecution(input.execution, {
    assets: dimension,
    additionalWork: input.enabled.jumps
      ? expectedJumpEventWork(input.jumps, input.execution)
      : 0,
    retainedValues:
      sampleCount *
        ((2 * dimension + 1) * (input.execution.steps + 1)) +
      (input.enabled.jumps
        ? retainedJumpEventValues(input.jumps, input.execution, sampleCount)
        : 0),
  });
}

function validateExecution(execution: {
  readonly seed?: number;
  readonly paths: number;
  readonly steps: number;
  readonly stepYears: number;
  readonly samplePaths?: number;
}, limits: {
  readonly assets?: number;
  readonly additionalWork?: number;
  readonly retainedValues?: number;
} = {}): void {
  if (execution.seed !== undefined) assertFinite(execution.seed, "execution.seed");
  assertIntegerInRange(execution.paths, 1, 10_000, "execution.paths");
  assertIntegerInRange(execution.steps, 1, 10_000, "execution.steps");
  assertPositive(execution.stepYears, "execution.stepYears");
  if (execution.samplePaths !== undefined) {
    assertIntegerInRange(
      execution.samplePaths,
      0,
      execution.paths,
      "execution.samplePaths",
    );
  }
  const assetStepWork =
    execution.paths * execution.steps * (limits.assets ?? 1);
  const additionalWork = limits.additionalWork ?? 0;
  const totalWork = assetStepWork + additionalWork;
  if (
    !Number.isSafeInteger(assetStepWork) ||
    !Number.isFinite(additionalWork) ||
    additionalWork < 0 ||
    totalWork > MAX_SIMULATION_WORK
  ) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "The requested simulation exceeds the 5,000,000 asset-step/event resource limit.",
      "execution",
    );
  }
  if (limits.retainedValues !== undefined) {
    assertRetainedValueLimit(
      limits.retainedValues,
      "execution.samplePaths",
    );
  }
}

function expectedJumpEventWork(
  jumps: readonly JumpSpec[],
  execution: {
    readonly paths: number;
    readonly steps: number;
    readonly stepYears: number;
  },
): number {
  const annualIntensity = jumps.reduce(
    (total, jump) => total + jump.annualIntensity,
    0,
  );
  return (
    execution.paths *
    execution.steps *
    execution.stepYears *
    annualIntensity
  );
}

function retainedJumpEventValues(
  jumps: readonly JumpSpec[],
  execution: { readonly steps: number },
  sampleCount: number,
): number {
  if (!jumps.some(({ annualIntensity }) => annualIntensity > 0)) return 0;
  return (
    sampleCount *
    execution.steps *
    jumps.length *
    RETAINED_VALUES_PER_JUMP_EVENT
  );
}

function calculateJumpCompensation(jump: JumpSpec, path: string): number {
  if (jump.annualIntensity === 0) return 0;
  const expectedLogMultiplier =
    jump.meanLogJump + 0.5 * jump.logJumpVolatility ** 2;
  assertFiniteSimulationValue(
    expectedLogMultiplier,
    `${path}.expectedLogMultiplier`,
    "Jump compensation overflowed. Reduce the jump-size parameters.",
  );
  const expectedJumpMultiplier = Math.expm1(expectedLogMultiplier);
  assertFiniteSimulationValue(
    expectedJumpMultiplier,
    `${path}.expectedMultiplier`,
    "Jump compensation overflowed. Reduce the jump-size parameters.",
  );
  const compensation = jump.annualIntensity * expectedJumpMultiplier;
  assertFiniteSimulationValue(
    compensation,
    `${path}.compensation`,
    "Jump compensation overflowed. Reduce the jump intensity or jump size.",
  );
  return compensation;
}

function assertRetainedValueLimit(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value > MAX_RETAINED_VALUES) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "The requested sampled output exceeds the 5,000,000-value retention limit. Reduce samplePaths or steps.",
      path,
    );
  }
}

function assertBoundedJumpCount(count: number): void {
  if (
    !Number.isSafeInteger(count) ||
    count > MAX_JUMP_EVENTS_PER_ASSET_STEP
  ) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Sampled jump count exceeded the per-step event resource limit.",
      "jumps.annualIntensity",
    );
  }
}

function assertFiniteSimulationValue(
  value: number,
  path: string,
  message: string,
): void {
  if (!Number.isFinite(value)) {
    throw new QuantError("NUMERICAL_FAILURE", message, path);
  }
}

function assertPositiveFiniteSimulationValue(
  value: number,
  path: string,
  message: string,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new QuantError("NUMERICAL_FAILURE", message, path);
  }
}

function validateProbabilityVector(values: readonly number[], path: string): void {
  if (values.length === 0) {
    throw new QuantError("INVALID_INPUT", `${path} cannot be empty.`);
  }
  values.forEach((value, index) => assertProbability(value, `${path}.${index}`));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-8) {
    throw new QuantError("INVALID_INPUT", `${path} must sum to one.`);
  }
}

function sampleCategorical(probabilities: readonly number[], uniform: number): number {
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (uniform <= cumulative) return index;
  }
  return probabilities.length - 1;
}

function envelope<Result>(
  inputContract: string,
  resultContract: string,
  seed: number,
  result: Result,
  warnings: readonly ModelWarning[] = [],
): ModelEnvelope<Result> {
  return {
    result,
    warnings,
    provenance: {
      engineVersion: `${MARKET_MODELS_VERSION}+${QUANT_CORE_VERSION}`,
      seed,
      inputContract,
      resultContract,
    },
  };
}
