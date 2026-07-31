import {
  type HmmRegime,
  type HmmRegimeProbabilities,
  type MarketCase,
  type PortfolioCaseId,
  type PortfolioLabExecution,
  type TwoAssetMarketAssumptions,
} from "./contracts";
import { PortfolioLabNumericalError } from "./errors";
import {
  createPortfolioRandomSource,
  type PortfolioRandomSource,
} from "./semantic-random";

const REGIME_ORDER: readonly HmmRegime[] = ["bull", "bear", "sideways"];

interface StepMarketModel {
  readonly stockDrift: number;
  readonly stockDiffusion: number;
  readonly bondDrift: number;
  readonly bondDiffusion: number;
  readonly correlation: number;
  readonly independentBondWeight: number;
}

type CaseMarketModel =
  | {
      readonly kind: "gbm";
      readonly market: StepMarketModel;
    }
  | {
      readonly kind: "hmm";
      readonly regimes: Readonly<Record<HmmRegime, StepMarketModel>>;
      readonly transitionMatrix: Readonly<
        Record<HmmRegime, HmmRegimeProbabilities>
      >;
      readonly initialStateProbabilities: HmmRegimeProbabilities;
    };

export interface MarketStep {
  readonly stepIndex: number;
  readonly stockGrowth: number;
  readonly bondGrowth: number;
  readonly regime: HmmRegime | null;
}

export interface MarketPath {
  readonly initialRegime: HmmRegime | null;
  readonly steps: Iterable<MarketStep>;
}

export interface MarketPathGenerator {
  generate(pathIndex: number): MarketPath;
}

export function createMarketPathGenerator(
  requestCase: MarketCase,
  execution: PortfolioLabExecution,
): MarketPathGenerator {
  const model = createCaseMarketModel(requestCase, execution.stepYears);
  const randomSource = createPortfolioRandomSource(execution.seed);

  return {
    generate(pathIndex) {
      return createMarketPath(
        requestCase.id,
        model,
        randomSource,
        execution.steps,
        pathIndex,
      );
    },
  };
}

export function sampleRegime(
  probabilities: HmmRegimeProbabilities,
  randomValue: number,
): HmmRegime {
  let cumulativeProbability = 0;

  for (const regime of REGIME_ORDER) {
    cumulativeProbability += probabilities[regime];
    if (randomValue <= cumulativeProbability) {
      return regime;
    }
  }

  return REGIME_ORDER.at(-1)!;
}

function createCaseMarketModel(
  requestCase: MarketCase,
  stepYears: number,
): CaseMarketModel {
  const { model } = requestCase;
  if (model.kind === "gbm") {
    return {
      kind: "gbm",
      market: createStepMarketModel(model.market, stepYears),
    };
  }

  return {
    kind: "hmm",
    regimes: {
      bull: createStepMarketModel(model.regimes.bull, stepYears),
      bear: createStepMarketModel(model.regimes.bear, stepYears),
      sideways: createStepMarketModel(model.regimes.sideways, stepYears),
    },
    transitionMatrix: model.transitionMatrix,
    initialStateProbabilities: model.initialStateProbabilities,
  };
}

function createStepMarketModel(
  assumptions: TwoAssetMarketAssumptions,
  stepYears: number,
): StepMarketModel {
  const stockVariance = assumptions.stocks.annualVolatility ** 2;
  const bondVariance = assumptions.bonds.annualVolatility ** 2;

  return {
    stockDrift:
      (assumptions.stocks.annualDrift - stockVariance / 2) * stepYears,
    stockDiffusion:
      assumptions.stocks.annualVolatility * Math.sqrt(stepYears),
    bondDrift:
      (assumptions.bonds.annualDrift - bondVariance / 2) * stepYears,
    bondDiffusion:
      assumptions.bonds.annualVolatility * Math.sqrt(stepYears),
    correlation: assumptions.correlation,
    independentBondWeight: Math.sqrt(
      Math.max(0, 1 - assumptions.correlation ** 2),
    ),
  };
}

function createMarketPath(
  caseId: PortfolioCaseId,
  model: CaseMarketModel,
  randomSource: PortfolioRandomSource,
  stepCount: number,
  pathIndex: number,
): MarketPath {
  const initialRegime =
    model.kind === "hmm"
      ? sampleRegime(
          model.initialStateProbabilities,
          randomSource.uniformAt(pathIndex, 0, "regime/initial"),
        )
      : null;

  return {
    initialRegime,
    steps: generateMarketSteps(
      caseId,
      model,
      randomSource,
      stepCount,
      pathIndex,
      initialRegime,
    ),
  };
}

function* generateMarketSteps(
  caseId: PortfolioCaseId,
  model: CaseMarketModel,
  randomSource: PortfolioRandomSource,
  stepCount: number,
  pathIndex: number,
  initialRegime: HmmRegime | null,
): Generator<MarketStep> {
  let regime = initialRegime;

  for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
    if (model.kind === "hmm" && regime) {
      regime = sampleRegime(
        model.transitionMatrix[regime],
        randomSource.uniformAt(
          pathIndex,
          stepIndex,
          "regime/transition",
        ),
      );
    }

    const marketModel =
      model.kind === "gbm" ? model.market : model.regimes[regime!];
    const stockShock = randomSource.normalAt(
      pathIndex,
      stepIndex,
      "diffusion/stocks",
    );
    const independentBondShock = randomSource.normalAt(
      pathIndex,
      stepIndex,
      "diffusion/bonds-independent",
    );
    const bondShock =
      marketModel.correlation * stockShock +
      marketModel.independentBondWeight * independentBondShock;
    const stockGrowth = Math.exp(
      marketModel.stockDrift + marketModel.stockDiffusion * stockShock,
    );
    const bondGrowth = Math.exp(
      marketModel.bondDrift + marketModel.bondDiffusion * bondShock,
    );

    assertFiniteGrowth(caseId, pathIndex, stepIndex, "stockGrowth", stockGrowth);
    assertFiniteGrowth(caseId, pathIndex, stepIndex, "bondGrowth", bondGrowth);

    yield {
      stepIndex,
      stockGrowth,
      bondGrowth,
      regime,
    };
  }
}

function assertFiniteGrowth(
  caseId: PortfolioCaseId,
  pathIndex: number,
  stepIndex: number,
  quantity: string,
  value: number,
): void {
  if (Number.isFinite(value)) {
    return;
  }

  throw new PortfolioLabNumericalError(
    caseId,
    "Asset assumptions produced a non-finite market growth factor.",
    { pathIndex, stepIndex, quantity },
  );
}
