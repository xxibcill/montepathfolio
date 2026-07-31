import {
  type HmmRegime,
  type PortfolioCaseId,
  type PortfolioPlan,
} from "./contracts";
import { PortfolioLabNumericalError } from "./errors";
import type { MarketPath } from "./market";

export interface PortfolioPath {
  readonly wealth: number[];
  readonly cashFlowNeutralValues: number[];
  readonly regimes: HmmRegime[];
}

export function simulatePortfolioPath(
  plan: PortfolioPlan,
  caseId: PortfolioCaseId,
  pathIndex: number,
  marketPath: MarketPath,
): PortfolioPath {
  let stockValue = plan.initialCapital * plan.targetWeights.stocks;
  let bondValue = plan.initialCapital * plan.targetWeights.bonds;
  let navStockValue = plan.targetWeights.stocks;
  let navBondValue = plan.targetWeights.bonds;
  const wealth = [plan.initialCapital];
  const cashFlowNeutralValues = [1];
  const regimes: HmmRegime[] = marketPath.initialRegime
    ? [marketPath.initialRegime]
    : [];

  for (const marketStep of marketPath.steps) {
    stockValue =
      stockValue * marketStep.stockGrowth +
      plan.contributionPerStep * plan.targetWeights.stocks;
    bondValue =
      bondValue * marketStep.bondGrowth +
      plan.contributionPerStep * plan.targetWeights.bonds;
    navStockValue *= marketStep.stockGrowth;
    navBondValue *= marketStep.bondGrowth;

    if (shouldRebalance(plan, marketStep.stepIndex)) {
      [stockValue, bondValue] = rebalance(
        stockValue,
        bondValue,
        plan.targetWeights,
      );
      [navStockValue, navBondValue] = rebalance(
        navStockValue,
        navBondValue,
        plan.targetWeights,
      );
    }

    const portfolioValue = stockValue + bondValue;
    const cashFlowNeutralValue = navStockValue + navBondValue;
    assertFinitePortfolioValues(
      caseId,
      pathIndex,
      marketStep.stepIndex,
      portfolioValue,
      cashFlowNeutralValue,
    );

    wealth.push(portfolioValue);
    cashFlowNeutralValues.push(cashFlowNeutralValue);
    if (marketStep.regime) {
      regimes.push(marketStep.regime);
    }
  }

  return { wealth, cashFlowNeutralValues, regimes };
}

function shouldRebalance(plan: PortfolioPlan, stepIndex: number): boolean {
  return (
    plan.rebalance.kind === "periodic" &&
    stepIndex % plan.rebalance.everySteps === 0
  );
}

function rebalance(
  stockValue: number,
  bondValue: number,
  targetWeights: PortfolioPlan["targetWeights"],
): [stockValue: number, bondValue: number] {
  const portfolioValue = stockValue + bondValue;
  return [
    portfolioValue * targetWeights.stocks,
    portfolioValue * targetWeights.bonds,
  ];
}

function assertFinitePortfolioValues(
  caseId: PortfolioCaseId,
  pathIndex: number,
  stepIndex: number,
  portfolioValue: number,
  cashFlowNeutralValue: number,
): void {
  if (Number.isFinite(portfolioValue) && Number.isFinite(cashFlowNeutralValue)) {
    return;
  }

  throw new PortfolioLabNumericalError(
    caseId,
    "Asset assumptions produced a non-finite portfolio value.",
    {
      pathIndex,
      stepIndex,
      quantity: !Number.isFinite(portfolioValue)
        ? "nominalWealth"
        : "cashFlowNeutralIndex",
    },
  );
}
