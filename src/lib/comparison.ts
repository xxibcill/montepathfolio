import type { PortfolioProjectionInputs } from "../types/portfolio-projection";
import { transitionMatricesEqual } from "./regimes";

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

interface ChangeDescriptor {
  label: string;
  headline: (
    before: PortfolioProjectionInputs,
    after: PortfolioProjectionInputs,
  ) => string;
  reason: (
    before: PortfolioProjectionInputs,
    after: PortfolioProjectionInputs,
  ) => string;
}

const CHANGE_DESCRIPTORS: Record<ChangeKey, ChangeDescriptor> = {
  model: {
    label: "market model",
    headline: (_before, after) =>
      after.model === "hmm"
        ? "Switching on regime changes"
        : "Holding market assumptions constant",
    reason: () =>
      "The same shock streams now pass through a different market-state process, isolating the effect of regime switching.",
  },
  initialCapital: {
    label: "starting capital",
    headline: (before, after) =>
      `${after.initialCapital > before.initialCapital ? "Increasing" : "Reducing"} starting capital`,
    reason: () =>
      "Starting capital compounds from day one, so it affects every future path.",
  },
  monthlyContribution: {
    label: "monthly contributions",
    headline: (before, after) =>
      after.monthlyContribution > before.monthlyContribution
        ? "Contributing more each month"
        : "Contributing less each month",
    reason: () =>
      "Contributions add capital in every market path, while the cash-flow-neutral drawdown measure stays comparable.",
  },
  horizonYears: {
    label: "investment horizon",
    headline: (before, after) =>
      `${after.horizonYears > before.horizonYears ? "Extending" : "Shortening"} the horizon to ${after.horizonYears} years`,
    reason: () =>
      "A different runway changes both the time available for compounding and the time exposed to uncertainty.",
  },
  stockAllocation: {
    label: "stock allocation",
    headline: (before, after) =>
      `${after.stockAllocation > before.stockAllocation ? "Increasing" : "Reducing"} stocks from ${Math.round(before.stockAllocation * 100)}% to ${Math.round(after.stockAllocation * 100)}%`,
    reason: allocationReason,
  },
  returnAssumptions: {
    label: "return assumptions",
    headline: () => "Changing the return assumptions",
    reason: () =>
      "Return assumptions shift compounding across the full range without changing the sampled shocks.",
  },
  volatilityAssumptions: {
    label: "volatility assumptions",
    headline: () => "Changing the volatility assumptions",
    reason: () =>
      "Volatility widens or narrows the range and changes the depth of adverse paths.",
  },
  correlation: {
    label: "stock–bond correlation",
    headline: (before, after) =>
      `${after.correlation < before.correlation ? "Lowering" : "Raising"} stock–bond correlation`,
    reason: (before, after) =>
      after.correlation < before.correlation
        ? "The assets offset one another more often when their shocks are less aligned."
        : "More synchronized asset moves reduce the portfolio’s diversification cushion.",
  },
  rebalanceFrequency: {
    label: "rebalancing",
    headline: () => "Changing the rebalance schedule",
    reason: () =>
      "Rebalancing controls how far the portfolio can drift from its selected risk mix.",
  },
  inflationRate: {
    label: "inflation",
    headline: () => "Changing the inflation assumption",
    reason: () =>
      "Inflation changes purchasing power, not the nominal paths, so the real-value estimate moves independently.",
  },
  regimeTransition: {
    label: "regime persistence",
    headline: () => "Changing regime persistence",
    reason: () =>
      "Transition probabilities control how long favorable and adverse conditions tend to persist before the market changes state.",
  },
  targetValue: {
    label: "financial target",
    headline: () => "Moving the financial target",
    reason: () =>
      "The portfolio paths are unchanged; only the hurdle they must clear has moved.",
  },
};

export function changedFields(
  before: PortfolioProjectionInputs,
  after: PortfolioProjectionInputs,
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
    !transitionMatricesEqual(
      before.hmm.transitionMatrix,
      after.hmm.transitionMatrix,
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
  before: PortfolioProjectionInputs,
  after: PortfolioProjectionInputs,
  changes: ChangeKey[],
): string {
  if (changes.length > 1) {
    return `Changing ${formatList(
      changes.map((change) => CHANGE_DESCRIPTORS[change].label),
    )}`;
  }
  if (changes.length === 0) {
    return "Refreshing this scenario";
  }

  return CHANGE_DESCRIPTORS[changes[0]].headline(before, after);
}

export function reasonForChange(
  before: PortfolioProjectionInputs,
  after: PortfolioProjectionInputs,
  changes: ChangeKey[],
): string {
  if (changes.length !== 1) {
    return changes.length === 0
      ? "The assumptions and sampled shocks are unchanged."
      : "These assumptions interact across all 1,000 paths, so read the median, target likelihood, and drawdown change together.";
  }

  return CHANGE_DESCRIPTORS[changes[0]].reason(before, after);
}

function allocationReason(
  before: PortfolioProjectionInputs,
  after: PortfolioProjectionInputs,
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
