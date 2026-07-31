import { describe, expect, it } from "vitest";
import {
  backtestValueAtRisk,
  calculateParametricRiskAttribution,
  calculateVarCvar,
  compareReversedRetirementReturns,
  runRetirementSequence,
  type RetirementInput,
} from "./risk";

describe("VaR and Conditional Value at Risk", () => {
  it("matches a hand-calculated historical tail convention", () => {
    const output = calculateVarCvar({
      contract: "risk-lab/var-cvar@1",
      method: {
        kind: "historical",
        losses: { kind: "positive-loss", values: [1, 2, 3, 4, 5] },
        provenance: { label: "Hand-calculated fixture", kind: "illustrative" },
      },
      confidenceLevel: 0.8,
      holdingPeriods: 1,
      portfolioValue: 100,
    }).result;
    expect(output.valueAtRisk).toBeCloseTo(4.2);
    expect(output.conditionalValueAtRisk).toBe(5);
    expect(output.tailObservationCount).toBe(1);
    expect(output.lossConvention).toBe("positive-values-are-losses");
    expect(output.dataProvenance?.label).toBe("Hand-calculated fixture");
  });

  it("is monotone in confidence and keeps CVaR at or above VaR", () => {
    const risks = [0.9, 0.95, 0.99].map((confidenceLevel) =>
      calculateVarCvar({
        contract: "risk-lab/var-cvar@1",
        method: {
          kind: "historical",
          losses: {
            kind: "positive-loss",
            values: [-3, -1, 0, 1, 2, 4, 7, 9, 12, 18],
          },
        },
        confidenceLevel,
        holdingPeriods: 1,
        portfolioValue: 1,
      }).result,
    );
    expect(risks[1].valueAtRisk).toBeGreaterThanOrEqual(risks[0].valueAtRisk);
    expect(risks[2].valueAtRisk).toBeGreaterThanOrEqual(risks[1].valueAtRisk);
    expect(risks.every((risk) => risk.conditionalValueAtRisk >= risk.valueAtRisk)).toBe(true);
  });

  it("matches the analytical normal formula and deterministic Monte Carlo", () => {
    const parametric = calculateVarCvar({
      contract: "risk-lab/var-cvar@1",
      method: { kind: "parametric-normal", meanReturn: 0, volatility: 0.01 },
      confidenceLevel: 0.95,
      holdingPeriods: 1,
      portfolioValue: 1_000_000,
    }).result;
    expect(parametric.valueAtRisk).toBeCloseTo(16_448.54, 0);
    expect(parametric.conditionalValueAtRisk).toBeGreaterThan(parametric.valueAtRisk);

    const request = {
      contract: "risk-lab/var-cvar@1" as const,
      method: {
        kind: "monte-carlo-normal" as const,
        meanReturn: 0,
        volatility: 0.01,
        seed: 42,
        samples: 5_000,
      },
      confidenceLevel: 0.95,
      holdingPeriods: 1,
      portfolioValue: 1_000_000,
    };
    expect(calculateVarCvar(request)).toEqual(calculateVarCvar(request));
  });

  it("returns zero VaR and CVaR when every sampled outcome is a gain", () => {
    const result = calculateVarCvar({
      contract: "risk-lab/var-cvar@1",
      method: {
        kind: "monte-carlo-normal",
        meanReturn: 0.0002,
        volatility: 0,
        seed: 120,
        samples: 100,
      },
      confidenceLevel: 0.95,
      holdingPeriods: 1,
      portfolioValue: 100_000,
    }).result;

    expect(result.valueAtRisk).toBe(0);
    expect(result.conditionalValueAtRisk).toBe(0);
    expect(result.tailObservationCount).toBe(0);
  });
});

describe("risk attribution and backtesting", () => {
  it("makes component contributions add back to parametric VaR", () => {
    const attribution = calculateParametricRiskAttribution({
      contract: "risk-lab/parametric-attribution@1",
      weights: [0.6, 0.4],
      covariance: [[0.04, 0.006], [0.006, 0.01]],
      portfolioValue: 100_000,
      confidenceLevel: 0.95,
    });
    expect(attribution.contributionSum).toBeCloseTo(attribution.valueAtRisk, 8);
  });

  it("rejects asymmetric and indefinite covariance inputs", () => {
    const request = {
      contract: "risk-lab/parametric-attribution@1" as const,
      weights: [0.5, 0.5],
      portfolioValue: 100_000,
      confidenceLevel: 0.95,
    };
    expect(() =>
      calculateParametricRiskAttribution({
        ...request,
        covariance: [[1, 0.5], [0.4, 1]],
      }),
    ).toThrow(/symmetric/);
    expect(() =>
      calculateParametricRiskAttribution({
        ...request,
        covariance: [[1, 2], [2, 1]],
      }),
    ).toThrow(/positive semidefinite/);
  });

  it("uses only observations before each backtest point", () => {
    const result = backtestValueAtRisk({
      contract: "risk-lab/var-backtest@1",
      returns: [0.01, 0.02, -0.01, 0, -0.03, 0.01, -0.05, 0.02],
      estimationWindow: 4,
      confidenceLevel: 0.95,
      portfolioValue: 100,
      method: "historical",
      timestamps: [
        "2025-01-01",
        "2025-02-01",
        "2025-03-01",
        "2025-04-01",
        "2025-05-01",
        "2025-06-01",
        "2025-07-01",
        "2025-08-01",
      ],
      provenance: { label: "Backtest fixture", kind: "illustrative" },
    });
    expect(result.points[0].estimationStartIndex).toBe(0);
    expect(result.points[0].estimationEndIndex).toBe(3);
    expect(result.points[0].testIndex).toBe(4);
    expect(result.points.every((point) => point.estimationEndIndex < point.testIndex)).toBe(true);
    expect(result.points[0].testTimestamp).toBe("2025-05-01");
    expect(result.dataProvenance?.label).toBe("Backtest fixture");
  });

  it("rejects backtests above the declared observation limit", () => {
    expect(() =>
      backtestValueAtRisk({
        contract: "risk-lab/var-backtest@1",
        returns: Array(50_001).fill(0),
        estimationWindow: 20,
        confidenceLevel: 0.95,
        portfolioValue: 100,
        method: "historical",
      }),
    ).toThrow(/observation limit/i);
  });

  it("rejects unsupported risk contracts", () => {
    expect(() =>
      calculateParametricRiskAttribution({
        contract: "risk-lab/parametric-attribution@999" as "risk-lab/parametric-attribution@1",
        weights: [1],
        covariance: [[1]],
        portfolioValue: 100,
        confidenceLevel: 0.95,
      }),
    ).toThrow(/Unsupported/);
    expect(() =>
      backtestValueAtRisk({
        contract: "risk-lab/var-backtest@999" as "risk-lab/var-backtest@1",
        returns: [0, 0, 0],
        estimationWindow: 2,
        confidenceLevel: 0.95,
        portfolioValue: 100,
        method: "historical",
      }),
    ).toThrow(/Unsupported/);
  });

  it("keeps boundary Kupiec statistics finite and informative", () => {
    const result = backtestValueAtRisk({
      contract: "risk-lab/var-backtest@1",
      returns: Array(10).fill(0),
      estimationWindow: 5,
      confidenceLevel: 0.95,
      portfolioValue: 100,
      method: "historical",
    });
    expect(result.breaches).toBe(0);
    expect(result.kupiecLikelihoodRatio).toBeCloseTo(-2 * 5 * Math.log(0.95));
    expect(result.kupiecLikelihoodRatio).toBeGreaterThan(0);
  });
});

describe("retirement and sequence of returns", () => {
  const zeroReturnInput: RetirementInput = {
    contract: "portfolio-lab/retirement-sequence@1",
    initialCapital: 100,
    annualContribution: 0,
    accumulationYears: 0,
    retirementYears: 1,
    periodsPerYear: 12,
    annualInflationRate: 0,
    withdrawalPolicy: { kind: "fixed-real", annualAmount: 12 },
    returnPaths: [Array(12).fill(0)],
  };

  it("reconciles a deterministic zero-return cash-flow ledger exactly", () => {
    const output = runRetirementSequence(zeroReturnInput).result;
    expect(output.paths[0].bequest).toBeCloseTo(88, 12);
    expect(output.paths[0].realSpending).toEqual(Array(12).fill(1));
    expect(output.depletionProbability).toBe(0);
    expect(output.eventOrder).toBe("return->cash-flow->record");
  });

  it("never carries negative wealth after depletion", () => {
    const output = runRetirementSequence({
      ...zeroReturnInput,
      initialCapital: 5,
      withdrawalPolicy: { kind: "fixed-real", annualAmount: 12 },
    }).result.paths[0];
    expect(output.failurePeriod).toBe(5);
    expect(output.wealth.every((wealth) => wealth >= 0)).toBe(true);
    expect(output.bequest).toBe(0);
  });

  it("inflates the first guardrail withdrawal across accumulation years", () => {
    const output = runRetirementSequence({
      ...zeroReturnInput,
      initialCapital: 1_000,
      accumulationYears: 2,
      retirementYears: 1,
      periodsPerYear: 1,
      annualInflationRate: 0.1,
      withdrawalPolicy: {
        kind: "guardrails",
        initialAnnualAmount: 100,
        lowerWithdrawalRate: 0.01,
        upperWithdrawalRate: 0.5,
        adjustmentRate: 0.1,
      },
      returnPaths: [[0, 0, 0]],
    }).result.paths[0];
    expect(output.nominalSpending[0]).toBeCloseTo(121, 12);
    expect(output.realSpending[0]).toBeCloseTo(100, 12);
  });

  it("caps guardrail spending after converting the annual amount to a period", () => {
    const output = runRetirementSequence({
      ...zeroReturnInput,
      withdrawalPolicy: {
        kind: "guardrails",
        initialAnnualAmount: 1_200,
        lowerWithdrawalRate: 0.01,
        upperWithdrawalRate: 0.5,
        adjustmentRate: 0,
      },
    }).result.paths[0];

    expect(output.nominalSpending[0]).toBe(100);
    expect(output.failurePeriod).toBe(1);
    expect(output.bequest).toBe(0);
  });

  it("teaches sequence risk with the exact same return multiset", () => {
    const comparison = compareReversedRetirementReturns({
      ...zeroReturnInput,
      retirementYears: 2,
      periodsPerYear: 1,
      withdrawalPolicy: { kind: "fixed-real", annualAmount: 10 },
      returnPaths: [[-0.4, 0.5]],
    });
    expect(comparison.sameReturnMultiset).toBe(true);
    expect(comparison.endingWealthDifference).not.toBe(0);
  });

  it("ignores observations beyond the requested reversal horizon", () => {
    const comparison = compareReversedRetirementReturns({
      ...zeroReturnInput,
      retirementYears: 2,
      periodsPerYear: 1,
      withdrawalPolicy: { kind: "fixed-real", annualAmount: 10 },
      returnPaths: [[-0.4, 0.5, 99]],
    });
    expect(comparison.forward.paths[0].wealth).toHaveLength(3);
    expect(comparison.reversed.paths[0].wealth).toHaveLength(3);
    expect(comparison.sameReturnMultiset).toBe(true);
  });

  it("applies asset returns, withdrawals, and periodic rebalancing in order", () => {
    const common = {
      contract: "portfolio-lab/retirement-sequence@1" as const,
      initialCapital: 100,
      annualContribution: 0,
      accumulationYears: 0,
      retirementYears: 1,
      periodsPerYear: 2,
      annualInflationRate: 0,
      withdrawalPolicy: { kind: "fixed-real" as const, annualAmount: 0 },
      assetReturnPaths: [[
        [1, 0],
        [1, 0],
      ]],
      targetWeights: [0.5, 0.5],
    };
    const never = runRetirementSequence({
      ...common,
      rebalance: { kind: "never" as const },
    }).result;
    const periodic = runRetirementSequence({
      ...common,
      rebalance: { kind: "periodic" as const, everyPeriods: 1 },
    }).result;
    expect(never.paths[0].bequest).toBe(250);
    expect(periodic.paths[0].bequest).toBe(225);
    expect(periodic.paths[0].endingHoldings).toEqual([112.5, 112.5]);
    expect(periodic.accountingMode).toBe("multi-asset");
    expect(periodic.eventOrder).toBe("return->cash-flow->rebalance->record");
  });

  it("reverses multi-asset period rows without changing the return set", () => {
    const comparison = compareReversedRetirementReturns({
      contract: "portfolio-lab/retirement-sequence@1",
      initialCapital: 100,
      annualContribution: 0,
      accumulationYears: 0,
      retirementYears: 2,
      periodsPerYear: 1,
      annualInflationRate: 0,
      withdrawalPolicy: { kind: "percentage", annualRate: 0.1 },
      assetReturnPaths: [[[-0.4, 0.1], [0.5, 0.02]]],
      targetWeights: [0.6, 0.4],
      rebalance: { kind: "periodic", everyPeriods: 1 },
    });
    expect(comparison.sameReturnMultiset).toBe(true);
    expect(comparison.forward.paths[0].wealth).toHaveLength(3);
    expect(comparison.reversed.paths[0].wealth).toHaveLength(3);
  });
});
