import type { SimulationInputs } from "../types/simulation";
import { REGIME_ORDER } from "./defaults";

export type ChangeKey =
  | "model"
  | "initialCapital"
  | "monthlyContribution"
  | "horizonYears"
  | "stockAllocation"
  | "returnAssumptions"
  | "volatilityAssumptions"
  | "correlation"
  | "rebalanceFrequency"
  | "inflationRate"
  | "regimeTransition"
  | "targetValue";

const CHANGE_LABELS: Record<ChangeKey, string> = {
  model: "market model",
  initialCapital: "starting capital",
  monthlyContribution: "monthly contributions",
  horizonYears: "investment horizon",
  stockAllocation: "stock allocation",
  returnAssumptions: "return assumptions",
  volatilityAssumptions: "volatility assumptions",
  correlation: "stock–bond correlation",
  rebalanceFrequency: "rebalancing",
  inflationRate: "inflation",
  regimeTransition: "regime persistence",
  targetValue: "financial target",
};

export function changedFields(
  before: SimulationInputs,
  after: SimulationInputs,
): ChangeKey[] {
  const changes: ChangeKey[] = [];

  if (before.model !== after.model) {
    changes.push("model");
  }
  if (before.initialCapital !== after.initialCapital) {
    changes.push("initialCapital");
  }
  if (before.monthlyContribution !== after.monthlyContribution) {
    changes.push("monthlyContribution");
  }
  if (before.horizonYears !== after.horizonYears) {
    changes.push("horizonYears");
  }
  if (before.stockAllocation !== after.stockAllocation) {
    changes.push("stockAllocation");
  }
  if (
    before.stocks.expectedReturn !== after.stocks.expectedReturn ||
    before.bonds.expectedReturn !== after.bonds.expectedReturn
  ) {
    changes.push("returnAssumptions");
  }
  if (
    before.stocks.volatility !== after.stocks.volatility ||
    before.bonds.volatility !== after.bonds.volatility
  ) {
    changes.push("volatilityAssumptions");
  }
  if (before.correlation !== after.correlation) {
    changes.push("correlation");
  }
  if (before.rebalanceFrequency !== after.rebalanceFrequency) {
    changes.push("rebalanceFrequency");
  }
  if (before.inflationRate !== after.inflationRate) {
    changes.push("inflationRate");
  }
  if (
    REGIME_ORDER.some((regime) =>
      REGIME_ORDER.some(
        (nextRegime) =>
          before.hmm.transitionMatrix[regime][nextRegime] !==
          after.hmm.transitionMatrix[regime][nextRegime],
      ),
    )
  ) {
    changes.push("regimeTransition");
  }
  if (before.targetValue !== after.targetValue) {
    changes.push("targetValue");
  }

  return changes;
}

export function primaryChange(
  before: SimulationInputs,
  after: SimulationInputs,
  changes: ChangeKey[],
): string {
  if (changes.length > 1) {
    return `Changing ${formatList(changes.map((change) => CHANGE_LABELS[change]))}`;
  }
  if (changes.length === 0) {
    return "Refreshing this scenario";
  }

  switch (changes[0]) {
    case "model":
      return after.model === "hmm"
        ? "Switching on regime changes"
        : "Holding market assumptions constant";
    case "initialCapital":
      return `${after.initialCapital > before.initialCapital ? "Increasing" : "Reducing"} starting capital`;
    case "monthlyContribution":
      return after.monthlyContribution > before.monthlyContribution
        ? "Contributing more each month"
        : "Contributing less each month";
    case "horizonYears":
      return `${after.horizonYears > before.horizonYears ? "Extending" : "Shortening"} the horizon to ${after.horizonYears} years`;
    case "stockAllocation":
      return `${after.stockAllocation > before.stockAllocation ? "Increasing" : "Reducing"} stocks from ${Math.round(before.stockAllocation * 100)}% to ${Math.round(after.stockAllocation * 100)}%`;
    case "returnAssumptions":
      return "Changing the return assumptions";
    case "volatilityAssumptions":
      return "Changing the volatility assumptions";
    case "correlation":
      return `${after.correlation < before.correlation ? "Lowering" : "Raising"} stock–bond correlation`;
    case "rebalanceFrequency":
      return "Changing the rebalance schedule";
    case "inflationRate":
      return "Changing the inflation assumption";
    case "regimeTransition":
      return "Changing regime persistence";
    case "targetValue":
      return "Moving the financial target";
  }
}

export function reasonForChange(
  before: SimulationInputs,
  after: SimulationInputs,
  changes: ChangeKey[],
): string {
  if (changes.length !== 1) {
    return changes.length === 0
      ? "The assumptions and sampled shocks are unchanged."
      : "These assumptions interact across all 1,000 paths, so read the median, target likelihood, and drawdown change together.";
  }

  switch (changes[0]) {
    case "model":
      return "The same shock streams now pass through a different market-state process, isolating the effect of regime switching.";
    case "initialCapital":
      return "Starting capital compounds from day one, so it affects every future path.";
    case "monthlyContribution":
      return "Contributions add capital in every market path, while the cash-flow-neutral drawdown measure stays comparable.";
    case "horizonYears":
      return "A different runway changes both the time available for compounding and the time exposed to uncertainty.";
    case "stockAllocation":
      return allocationReason(before, after);
    case "returnAssumptions":
      return "Return assumptions shift compounding across the full range without changing the sampled shocks.";
    case "volatilityAssumptions":
      return "Volatility widens or narrows the range and changes the depth of adverse paths.";
    case "correlation":
      return after.correlation < before.correlation
        ? "The assets offset one another more often when their shocks are less aligned."
        : "More synchronized asset moves reduce the portfolio’s diversification cushion.";
    case "rebalanceFrequency":
      return "Rebalancing controls how far the portfolio can drift from its selected risk mix.";
    case "inflationRate":
      return "Inflation changes purchasing power, not the nominal paths, so the real-value estimate moves independently.";
    case "regimeTransition":
      return "Transition probabilities control how long favorable and adverse conditions tend to persist before the market changes state.";
    case "targetValue":
      return "The portfolio paths are unchanged; only the hurdle they must clear has moved.";
  }
}

function allocationReason(
  before: SimulationInputs,
  after: SimulationInputs,
): string {
  const increasesStocks = after.stockAllocation > before.stockAllocation;
  const emphasizedAsset = increasesStocks ? after.stocks : after.bonds;
  const otherAsset = increasesStocks ? after.bonds : after.stocks;
  const assetName = increasesStocks ? "stocks" : "bonds";
  const returnRelationship = relativeDescription(
    emphasizedAsset.expectedReturn,
    otherAsset.expectedReturn,
    "higher expected return",
    "lower expected return",
    "same expected return",
  );
  const volatilityRelationship = relativeDescription(
    emphasizedAsset.volatility,
    otherAsset.volatility,
    "higher volatility",
    "lower volatility",
    "same volatility",
  );

  return `This increases exposure to ${assetName}, which have the ${returnRelationship} and ${volatilityRelationship} in this scenario.`;
}

function relativeDescription(
  value: number,
  comparison: number,
  higher: string,
  lower: string,
  equal: string,
): string {
  if (value > comparison) {
    return higher;
  }
  if (value < comparison) {
    return lower;
  }
  return equal;
}

function formatList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
