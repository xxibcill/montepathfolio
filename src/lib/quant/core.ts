/**
 * Shared numerical kernels used by more than one quantitative laboratory.
 *
 * The functions in this module deliberately operate on plain arrays and plain
 * data so they remain structured-clone safe and easy to inspect while learning.
 */

export const QUANT_CORE_VERSION = "quant-core@1";

export type NumericVector = readonly number[];
export type NumericMatrix = readonly (readonly number[])[];

declare const semanticSeriesKind: unique symbol;

export type SemanticSeries<Kind extends string> = readonly number[] & {
  readonly [semanticSeriesKind]: Kind;
};

export type ReturnSeries = SemanticSeries<"return">;
export type VarianceSeries = SemanticSeries<"variance">;
export type WealthSeries = SemanticSeries<"wealth">;
export type DrawdownSeries = SemanticSeries<"drawdown-probability">;
export type IndexSeries = SemanticSeries<"index">;
export type LossValueSeries = SemanticSeries<"positive-loss">;

export function asReturnSeries(values: readonly number[]): ReturnSeries {
  return values as ReturnSeries;
}

export function asVarianceSeries(values: readonly number[]): VarianceSeries {
  return values as VarianceSeries;
}

export function asWealthSeries(values: readonly number[]): WealthSeries {
  return values as WealthSeries;
}

export function asDrawdownSeries(values: readonly number[]): DrawdownSeries {
  return values as DrawdownSeries;
}

export function asIndexSeries(values: readonly number[]): IndexSeries {
  return values as IndexSeries;
}

export function asLossValueSeries(values: readonly number[]): LossValueSeries {
  return values as LossValueSeries;
}

export type QuantIssueCode =
  | "INVALID_INPUT"
  | "NON_FINITE"
  | "OUT_OF_RANGE"
  | "DIMENSION_MISMATCH"
  | "NOT_POSITIVE_SEMIDEFINITE"
  | "NUMERICAL_FAILURE";

export class QuantError extends Error {
  readonly code: QuantIssueCode;
  readonly path?: string;

  constructor(code: QuantIssueCode, message: string, path?: string) {
    super(message);
    this.name = "QuantError";
    this.code = code;
    this.path = path;
  }
}

export interface ModelWarning {
  readonly code:
    | "ASSUMPTION"
    | "BOUNDARY"
    | "CALIBRATION"
    | "PRECISION"
    | "STATIONARITY";
  readonly message: string;
}

export interface ModelProvenance {
  readonly engineVersion: string;
  readonly seed?: number;
  readonly inputContract: string;
  readonly resultContract: string;
}

export interface ModelEnvelope<Result> {
  readonly result: Result;
  readonly warnings: readonly ModelWarning[];
  readonly provenance: ModelProvenance;
}

export function assertFinite(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    throw new QuantError("NON_FINITE", `${path} must be finite.`, path);
  }
}

export function assertPositive(value: number, path: string): void {
  assertFinite(value, path);
  if (value <= 0) {
    throw new QuantError("OUT_OF_RANGE", `${path} must be positive.`, path);
  }
}

export function assertNonNegative(value: number, path: string): void {
  assertFinite(value, path);
  if (value < 0) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must be non-negative.`,
      path,
    );
  }
}

export function assertProbability(value: number, path: string): void {
  assertFinite(value, path);
  if (value < 0 || value > 1) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must be between zero and one.`,
      path,
    );
  }
}

export function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  path: string,
): void {
  assertFinite(value, path);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new QuantError(
      "OUT_OF_RANGE",
      `${path} must be an integer between ${minimum} and ${maximum}.`,
      path,
    );
  }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function sum(values: NumericVector): number {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values: NumericVector): number {
  if (values.length === 0) {
    throw new QuantError("INVALID_INPUT", "A mean needs at least one value.");
  }

  let runningMean = 0;
  for (let index = 0; index < values.length; index += 1) {
    assertFinite(values[index], `values.${index}`);
    runningMean += (values[index] - runningMean) / (index + 1);
  }
  return runningMean;
}

export function assertIncreasingTimestamps(
  timestamps: readonly string[],
  path = "timestamps",
): void {
  let previousEpoch = Number.NEGATIVE_INFINITY;
  timestamps.forEach((timestamp, index) => {
    const epoch = Date.parse(timestamp);
    if (!Number.isFinite(epoch) || epoch <= previousEpoch) {
      throw new QuantError(
        "INVALID_INPUT",
        "Timestamps must be valid, unique, and increasing.",
        `${path}.${index}`,
      );
    }
    previousEpoch = epoch;
  });
}

export function sampleVariance(values: NumericVector): number {
  if (values.length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "Sample variance needs at least two values.",
    );
  }
  const average = mean(values);
  return (
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1)
  );
}

export function populationVariance(values: NumericVector): number {
  const average = mean(values);
  return (
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length
  );
}

export function standardDeviation(values: NumericVector): number {
  return Math.sqrt(sampleVariance(values));
}

export function covariance(left: NumericVector, right: NumericVector): number {
  assertSameLength(left, right, "covariance inputs");
  if (left.length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "Covariance needs at least two paired observations.",
    );
  }
  const leftMean = mean(left);
  const rightMean = mean(right);
  let crossProducts = 0;
  for (let index = 0; index < left.length; index += 1) {
    crossProducts +=
      (left[index] - leftMean) * (right[index] - rightMean);
  }
  return crossProducts / (left.length - 1);
}

export function correlation(left: NumericVector, right: NumericVector): number {
  const denominator = standardDeviation(left) * standardDeviation(right);
  return denominator === 0 ? 0 : covariance(left, right) / denominator;
}

/** R-7 linear quantile, the convention used by the portfolio lab. */
export function quantile(values: NumericVector, probability: number): number {
  assertProbability(probability, "probability");
  if (values.length === 0) {
    throw new QuantError("INVALID_INPUT", "A quantile needs at least one value.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function covarianceMatrix(rows: NumericMatrix): number[][] {
  validateRectangularMatrix(rows, "rows");
  if (rows.length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "A covariance matrix needs at least two observations.",
    );
  }
  const columns = transpose(rows);
  return columns.map((left) => columns.map((right) => covariance(left, right)));
}

export function dot(left: NumericVector, right: NumericVector): number {
  assertSameLength(left, right, "dot-product inputs");
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

export function transpose(matrix: NumericMatrix): number[][] {
  const columnCount = validateRectangularMatrix(matrix, "matrix");
  return Array.from({ length: columnCount }, (_, columnIndex) =>
    matrix.map((row) => row[columnIndex]),
  );
}

export function matrixVectorMultiply(
  matrix: NumericMatrix,
  vector: NumericVector,
): number[] {
  const columnCount = validateRectangularMatrix(matrix, "matrix");
  if (columnCount !== vector.length) {
    throw dimensionError("Matrix columns must match the vector length.");
  }
  return matrix.map((row) => dot(row, vector));
}

export function matrixMultiply(
  left: NumericMatrix,
  right: NumericMatrix,
): number[][] {
  const leftColumns = validateRectangularMatrix(left, "left");
  validateRectangularMatrix(right, "right");
  if (leftColumns !== right.length) {
    throw dimensionError("Inner matrix dimensions must match.");
  }
  const rightColumns = transpose(right);
  return left.map((row) => rightColumns.map((column) => dot(row, column)));
}

export function addMatrices(
  left: NumericMatrix,
  right: NumericMatrix,
): number[][] {
  assertSameMatrixShape(left, right);
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
  );
}

export function scaleMatrix(matrix: NumericMatrix, scale: number): number[][] {
  assertFinite(scale, "scale");
  validateRectangularMatrix(matrix, "matrix");
  return matrix.map((row) => row.map((value) => value * scale));
}

export function identityMatrix(size: number): number[][] {
  assertIntegerInRange(size, 1, 1_000, "size");
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => Number(row === column)),
  );
}

/** Gaussian elimination with partial pivoting. */
export function solveLinearSystem(
  matrix: NumericMatrix,
  vector: NumericVector,
  tolerance = 1e-12,
): number[] {
  const size = validateSquareMatrix(matrix, "matrix");
  if (vector.length !== size) {
    throw dimensionError("The right-hand vector must match the matrix size.");
  }
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let bestRow = pivotIndex;
    for (let row = pivotIndex + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivotIndex]) > Math.abs(augmented[bestRow][pivotIndex])) {
        bestRow = row;
      }
    }
    if (Math.abs(augmented[bestRow][pivotIndex]) <= tolerance) {
      throw new QuantError(
        "NUMERICAL_FAILURE",
        "The matrix is singular or ill-conditioned.",
      );
    }
    [augmented[pivotIndex], augmented[bestRow]] = [
      augmented[bestRow],
      augmented[pivotIndex],
    ];

    const pivot = augmented[pivotIndex][pivotIndex];
    for (let column = pivotIndex; column <= size; column += 1) {
      augmented[pivotIndex][column] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivotIndex) continue;
      const factor = augmented[row][pivotIndex];
      for (let column = pivotIndex; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivotIndex][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

export function inverseMatrix(matrix: NumericMatrix): number[][] {
  const size = validateSquareMatrix(matrix, "matrix");
  const identity = identityMatrix(size);
  const columns = identity.map((column) => solveLinearSystem(matrix, column));
  return transpose(columns);
}

/**
 * Cholesky factorization A = L Lᵀ. Small negative round-off on the diagonal is
 * accepted; materially negative pivots reject a non-PSD input.
 */
export function cholesky(
  matrix: NumericMatrix,
  tolerance = 1e-10,
): number[][] {
  const size = validateSquareMatrix(matrix, "matrix");
  assertSymmetric(matrix, tolerance);
  const lower = Array.from({ length: size }, () => Array(size).fill(0));

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let remainder = matrix[row][column];
      for (let inner = 0; inner < column; inner += 1) {
        remainder -= lower[row][inner] * lower[column][inner];
      }

      if (row === column) {
        if (remainder < -tolerance) {
          throw new QuantError(
            "NOT_POSITIVE_SEMIDEFINITE",
            "The matrix must be positive semidefinite.",
          );
        }
        lower[row][column] = Math.sqrt(Math.max(0, remainder));
      } else if (lower[column][column] > tolerance) {
        lower[row][column] = remainder / lower[column][column];
      } else if (Math.abs(remainder) > tolerance) {
        throw new QuantError(
          "NOT_POSITIVE_SEMIDEFINITE",
          "The matrix must be positive semidefinite.",
        );
      }
    }
  }
  return lower;
}

/** Validates a true correlation matrix and returns its Cholesky factor. */
export function factorCorrelationMatrix(
  matrix: NumericMatrix,
  tolerance = 1e-10,
): number[][] {
  if (matrix.length > 128) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Correlation matrices are limited to 128 dimensions.",
    );
  }
  matrix.forEach((row, rowIndex) => {
    if (Math.abs(row[rowIndex] - 1) > tolerance) {
      throw new QuantError(
        "INVALID_INPUT",
        "A correlation matrix must have ones on its diagonal.",
        `correlation.${rowIndex}.${rowIndex}`,
      );
    }
    row.forEach((value, columnIndex) => {
      if (value < -1 - tolerance || value > 1 + tolerance) {
        throw new QuantError(
          "OUT_OF_RANGE",
          "Correlation entries must lie between -1 and 1.",
          `correlation.${rowIndex}.${columnIndex}`,
        );
      }
    });
  });
  return cholesky(matrix, tolerance);
}

export function isPositiveSemidefinite(matrix: NumericMatrix): boolean {
  try {
    cholesky(matrix);
    return true;
  } catch (error) {
    if (error instanceof QuantError) return false;
    throw error;
  }
}

/** Euclidean projection onto non-negative weights that sum to one. */
export function projectOntoSimplex(values: NumericVector): number[] {
  if (values.length === 0) {
    throw new QuantError("INVALID_INPUT", "A weight vector cannot be empty.");
  }
  values.forEach((value, index) => assertFinite(value, `values.${index}`));
  const sorted = [...values].sort((left, right) => right - left);
  let cumulative = 0;
  let activeCount = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    cumulative += sorted[index];
    if (sorted[index] - (cumulative - 1) / (index + 1) > 0) {
      activeCount = index + 1;
    }
  }
  const threshold =
    (sorted.slice(0, activeCount).reduce((total, value) => total + value, 0) - 1) /
    activeCount;
  return values.map((value) => Math.max(0, value - threshold));
}

export function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

/** Abramowitz-Stegun approximation; absolute error is about 7.5e-8. */
export function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * scaled);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t);
  const erf = sign * (1 - polynomial * Math.exp(-scaled * scaled));
  return 0.5 * (1 + erf);
}

/** Student-t CDF computed from the regularized incomplete beta function. */
export function studentTCdf(value: number, degreesOfFreedom: number): number {
  assertPositive(degreesOfFreedom, "degreesOfFreedom");
  assertFinite(value, "value");
  if (value === 0) return 0.5;
  const betaArgument = degreesOfFreedom / (degreesOfFreedom + value ** 2);
  const tail = 0.5 * regularizedIncompleteBeta(
    betaArgument,
    degreesOfFreedom / 2,
    0.5,
  );
  return value > 0 ? 1 - tail : tail;
}

/** Peter Acklam's rational approximation for the inverse normal CDF. */
export function inverseNormalCdf(probability: number): number {
  if (probability <= 0 || probability >= 1 || !Number.isFinite(probability)) {
    throw new QuantError(
      "OUT_OF_RANGE",
      "Normal probabilities must be strictly between zero and one.",
      "probability",
    );
  }

  const lower = 0.02425;
  const upper = 1 - lower;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];

  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return rationalTail(q, c, d);
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -rationalTail(q, c, d);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export interface SemanticRandom {
  uniform(...address: readonly (string | number)[]): number;
  normal(...address: readonly (string | number)[]): number;
  poisson(intensity: number, ...address: readonly (string | number)[]): number;
  gamma(shape: number, scale: number, ...address: readonly (string | number)[]): number;
  studentT(degreesOfFreedom: number, ...address: readonly (string | number)[]): number;
}

/**
 * A stateless, addressable pseudo-random source. Adding a draw at one semantic
 * address cannot shift values at another address.
 */
export function createSemanticRandom(seed: number, namespace: string): SemanticRandom {
  assertFinite(seed, "seed");
  const root = hashParts(0x811c9dc5, [namespace, Math.trunc(seed)]);

  const uniform = (...address: readonly (string | number)[]): number =>
    uniformFromHash(finalizeHash(hashParts(root, address)));

  const normal = (...address: readonly (string | number)[]): number => {
    const first = uniform(...address, "normal/u1");
    const second = uniform(...address, "normal/u2");
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  };

  const gamma = (
    shape: number,
    scale: number,
    ...address: readonly (string | number)[]
  ): number => sampleGamma(shape, scale, uniform, normal, address);

  return {
    uniform,
    normal,
    poisson(intensity, ...address) {
      assertNonNegative(intensity, "intensity");
      return samplePoisson(intensity, uniform, address);
    },
    gamma,
    studentT(degreesOfFreedom, ...address) {
      if (degreesOfFreedom <= 0) {
        throw new QuantError(
          "OUT_OF_RANGE",
          "Student-t degrees of freedom must be positive.",
        );
      }
      const numerator = normal(...address, "student-t/z");
      const chiSquare = gamma(
        degreesOfFreedom / 2,
        2,
        ...address,
        "student-t/chi-square",
      );
      return numerator / Math.sqrt(chiSquare / degreesOfFreedom);
    },
  };
}

export function bisectRoot(
  evaluate: (value: number) => number,
  lower: number,
  upper: number,
  tolerance = 1e-10,
  maxIterations = 200,
): number {
  let left = lower;
  let right = upper;
  let leftValue = evaluate(left);
  const rightValue = evaluate(right);
  if (leftValue === 0) return left;
  if (rightValue === 0) return right;
  if (leftValue * rightValue > 0) {
    throw new QuantError(
      "INVALID_INPUT",
      "Root bounds must bracket a sign change.",
    );
  }
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const midpoint = (left + right) / 2;
    const midpointValue = evaluate(midpoint);
    if (Math.abs(midpointValue) <= tolerance || right - left <= tolerance) {
      return midpoint;
    }
    if (leftValue * midpointValue <= 0) {
      right = midpoint;
    } else {
      left = midpoint;
      leftValue = midpointValue;
    }
  }
  return (left + right) / 2;
}

function samplePoisson(
  intensity: number,
  uniform: (...address: readonly (string | number)[]) => number,
  address: readonly (string | number)[],
): number {
  if (intensity === 0) return 0;
  if (intensity > 30) {
    // Hörmann's transformed-rejection sampler (PTRS). Unlike a normal
    // approximation, this remains an exact Poisson draw at high intensity.
    const root = Math.sqrt(intensity);
    const b = 0.931 + 2.53 * root;
    const a = -0.059 + 0.02483 * b;
    const inverseAlpha = 1.1239 + 1.1328 / (b - 3.4);
    const squeeze = 0.9277 - 3.6224 / (b - 2);
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const centered = uniform(...address, "poisson/ptrs/u", attempt) - 0.5;
      const candidateUniform = uniform(...address, "poisson/ptrs/v", attempt);
      const distance = 0.5 - Math.abs(centered);
      const candidate = Math.floor(
        ((2 * a) / distance + b) * centered + intensity + 0.43,
      );
      if (distance >= 0.07 && candidateUniform <= squeeze && candidate >= 0) {
        return candidate;
      }
      if (candidate < 0 || (distance < 0.013 && candidateUniform > distance)) {
        continue;
      }
      const acceptanceLog = Math.log(
        (candidateUniform * inverseAlpha) / (a / distance ** 2 + b),
      );
      const poissonLogMass =
        -intensity + candidate * Math.log(intensity) - logGamma(candidate + 1);
      if (acceptanceLog <= poissonLogMass) return candidate;
    }
    throw new QuantError("NUMERICAL_FAILURE", "Poisson sampling did not converge.");
  }
  const threshold = Math.exp(-intensity);
  let product = 1;
  for (let count = 0; count < 10_000; count += 1) {
    product *= uniform(...address, "poisson", count);
    if (product <= threshold) return count;
  }
  throw new QuantError("NUMERICAL_FAILURE", "Poisson sampling did not converge.");
}

/** Lanczos log-gamma approximation, accurate for positive real arguments. */
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index] / (shifted + index + 1);
  }
  const scale = shifted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(scale) -
    scale +
    Math.log(series)
  );
}

function regularizedIncompleteBeta(value: number, left: number, right: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  const front = Math.exp(
    logGamma(left + right) -
      logGamma(left) -
      logGamma(right) +
      left * Math.log(value) +
      right * Math.log1p(-value),
  );
  return value < (left + 1) / (left + right + 2)
    ? (front * betaContinuedFraction(left, right, value)) / left
    : 1 - (front * betaContinuedFraction(right, left, 1 - value)) / right;
}

function betaContinuedFraction(left: number, right: number, value: number): number {
  const minimum = 1e-300;
  const total = left + right;
  const leftPlusOne = left + 1;
  const leftMinusOne = left - 1;
  let denominator = 1 - (total * value) / leftPlusOne;
  if (Math.abs(denominator) < minimum) denominator = minimum;
  denominator = 1 / denominator;
  let numerator = 1;
  let fraction = denominator;
  for (let iteration = 1; iteration <= 200; iteration += 1) {
    const doubled = 2 * iteration;
    let coefficient =
      (iteration * (right - iteration) * value) /
      ((leftMinusOne + doubled) * (left + doubled));
    denominator = 1 + coefficient * denominator;
    if (Math.abs(denominator) < minimum) denominator = minimum;
    numerator = 1 + coefficient / numerator;
    if (Math.abs(numerator) < minimum) numerator = minimum;
    denominator = 1 / denominator;
    fraction *= denominator * numerator;

    coefficient =
      (-(left + iteration) * (total + iteration) * value) /
      ((left + doubled) * (leftPlusOne + doubled));
    denominator = 1 + coefficient * denominator;
    if (Math.abs(denominator) < minimum) denominator = minimum;
    numerator = 1 + coefficient / numerator;
    if (Math.abs(numerator) < minimum) numerator = minimum;
    denominator = 1 / denominator;
    const change = denominator * numerator;
    fraction *= change;
    if (Math.abs(change - 1) <= 3e-14) return fraction;
  }
  throw new QuantError(
    "NUMERICAL_FAILURE",
    "Incomplete-beta continued fraction did not converge.",
  );
}

function sampleGamma(
  shape: number,
  scale: number,
  uniform: (...address: readonly (string | number)[]) => number,
  normal: (...address: readonly (string | number)[]) => number,
  address: readonly (string | number)[],
): number {
  assertPositive(shape, "shape");
  assertPositive(scale, "scale");
  if (shape < 1) {
    const boosted = sampleGamma(shape + 1, 1, uniform, normal, [
      ...address,
      "gamma/boost",
    ]);
    return (
      scale *
      boosted *
      uniform(...address, "gamma/power") ** (1 / shape)
    );
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const z = normal(...address, "gamma/z", attempt);
    const base = 1 + c * z;
    if (base <= 0) continue;
    const candidate = base ** 3;
    const u = uniform(...address, "gamma/u", attempt);
    if (
      u < 1 - 0.0331 * z ** 4 ||
      Math.log(u) < 0.5 * z ** 2 + d * (1 - candidate + Math.log(candidate))
    ) {
      return scale * d * candidate;
    }
  }
  throw new QuantError("NUMERICAL_FAILURE", "Gamma sampling did not converge.");
}

function validateRectangularMatrix(matrix: NumericMatrix, path: string): number {
  if (matrix.length === 0 || matrix[0].length === 0) {
    throw new QuantError("INVALID_INPUT", `${path} cannot be empty.`, path);
  }
  const columnCount = matrix[0].length;
  matrix.forEach((row, rowIndex) => {
    if (row.length !== columnCount) {
      throw dimensionError(`${path} must be rectangular.`);
    }
    row.forEach((value, columnIndex) =>
      assertFinite(value, `${path}.${rowIndex}.${columnIndex}`),
    );
  });
  return columnCount;
}

function validateSquareMatrix(matrix: NumericMatrix, path: string): number {
  const columnCount = validateRectangularMatrix(matrix, path);
  if (matrix.length !== columnCount) {
    throw dimensionError(`${path} must be square.`);
  }
  return matrix.length;
}

function assertSymmetric(matrix: NumericMatrix, tolerance: number): void {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = row + 1; column < matrix.length; column += 1) {
      if (Math.abs(matrix[row][column] - matrix[column][row]) > tolerance) {
        throw new QuantError("INVALID_INPUT", "The matrix must be symmetric.");
      }
    }
  }
}

function assertSameLength(
  left: NumericVector,
  right: NumericVector,
  label: string,
): void {
  if (left.length !== right.length) {
    throw dimensionError(`${label} must have the same length.`);
  }
}

function assertSameMatrixShape(left: NumericMatrix, right: NumericMatrix): void {
  const leftColumns = validateRectangularMatrix(left, "left");
  const rightColumns = validateRectangularMatrix(right, "right");
  if (left.length !== right.length || leftColumns !== rightColumns) {
    throw dimensionError("Matrices must have the same shape.");
  }
}

function dimensionError(message: string): QuantError {
  return new QuantError("DIMENSION_MISMATCH", message);
}

function rationalTail(
  value: number,
  numerator: readonly number[],
  denominator: readonly number[],
): number {
  return (
    (((((numerator[0] * value + numerator[1]) * value + numerator[2]) * value + numerator[3]) * value + numerator[4]) * value + numerator[5]) /
    ((((denominator[0] * value + denominator[1]) * value + denominator[2]) * value + denominator[3]) * value + 1)
  );
}

function hashParts(
  initial: number,
  parts: readonly (string | number)[],
): number {
  let hash = initial >>> 0;
  for (const part of parts) {
    const value = typeof part === "number" ? `#${Math.trunc(part)}` : part;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash = Math.imul(hash ^ 0xff, 0x85ebca6b) >>> 0;
  }
  return hash;
}

function finalizeHash(value: number): number {
  let hash = value;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function uniformFromHash(hash: number): number {
  return (hash + 0.5) / 4_294_967_296;
}
