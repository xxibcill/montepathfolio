import { describe, expect, it } from "vitest";
import { QuantError } from "./core";
import type { ReturnDataset } from "./market-models";
import {
  ALIGNED_FACTOR_DATASET_CONTRACT,
  BLACK_LITTERMAN_REQUEST_CONTRACT,
  BLACK_LITTERMAN_RESULT_CONTRACT,
  CAPM_REQUEST_CONTRACT,
  CAPM_RESULT_CONTRACT,
  CONSTRUCTION_ENGINE_VERSION,
  FACTOR_MODEL_REQUEST_CONTRACT,
  FACTOR_MODEL_RESULT_CONTRACT,
  FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
  KELLY_REQUEST_CONTRACT,
  KELLY_RESULT_CONTRACT,
  MEAN_VARIANCE_REQUEST_CONTRACT,
  MEAN_VARIANCE_RESULT_CONTRACT,
  RISK_PARITY_REQUEST_CONTRACT,
  RISK_PARITY_RESULT_CONTRACT,
  ROLLING_FACTOR_REQUEST_CONTRACT,
  ROLLING_FACTOR_RESULT_CONTRACT,
  alignFactorDatasets,
  runBlackLitterman,
  runCapm,
  runFactorModel,
  runKelly,
  runMeanVariance,
  runPortfolioConstruction,
  runRiskParity,
  runRollingFactorAnalysis,
  solveBinaryKellyBet,
} from "./construction";

function returnDataset(
  assetIds: readonly string[],
  timestamps: readonly string[],
  rows: readonly (readonly number[])[],
  label: string,
): ReturnDataset {
  return {
    contract: "return-dataset@1",
    assetIds,
    timestamps,
    frequency: "monthly",
    returnConvention: "simple",
    rows,
    missingValuePolicy: "reject",
    alignmentPolicy: "intersection",
    provenance: { label, kind: "illustrative" },
  };
}

describe("mean-variance construction", () => {
  it("matches analytical two-asset minimum-variance and tangency weights", () => {
    const envelope = runMeanVariance({
      contract: MEAN_VARIANCE_REQUEST_CONTRACT,
      assetIds: ["Steady", "Growth"],
      expectedReturnsPerPeriod: [0.06, 0.1],
      covariancePerPeriod: [
        [0.04, 0],
        [0, 0.16],
      ],
      riskFreeRatePerPeriod: 0,
      frontierPointCount: 7,
    });

    expect(envelope.result.contract).toBe(MEAN_VARIANCE_RESULT_CONTRACT);
    expect(envelope.provenance.engineVersion).toBe(CONSTRUCTION_ENGINE_VERSION);
    expect(envelope.result.minimumVariance.weights[0]).toBeCloseTo(0.8, 7);
    expect(envelope.result.minimumVariance.weights[1]).toBeCloseTo(0.2, 7);
    expect(envelope.result.maximumSharpe.weights[0]).toBeCloseTo(
      12 / 17,
      7,
    );
    expect(envelope.result.maximumSharpe.weights[1]).toBeCloseTo(
      5 / 17,
      7,
    );
    expect(
      envelope.result.minimumVariance.volatilityContributions.reduce(
        (total, value) => total + value,
        0,
      ),
    ).toBeCloseTo(envelope.result.minimumVariance.volatilityPerPeriod, 10);
    expect(
      envelope.result.maximumSharpe.normalizedRiskContributions.reduce(
        (total, value) => total + value,
        0,
      ),
    ).toBeCloseTo(1, 10);
    envelope.result.efficientFrontier.forEach((point) => {
      expect(point.allocation.weights.every((weight) => weight >= -1e-10)).toBe(
        true,
      );
      expect(point.allocation.weights.reduce((total, weight) => total + weight, 0)).toBeCloseTo(
        1,
        9,
      );
      expect(point.allocation.expectedReturnPerPeriod).toBeCloseTo(
        point.targetReturnPerPeriod,
        8,
      );
    });
    const frontierVariances = envelope.result.efficientFrontier.map(
      (point) => point.allocation.variancePerPeriod,
    );
    expect(frontierVariances).toEqual(
      [...frontierVariances].sort((left, right) => left - right),
    );
  });

  it("stabilizes a singular covariance and reports the ridge", () => {
    const envelope = runMeanVariance({
      contract: MEAN_VARIANCE_REQUEST_CONTRACT,
      assetIds: ["A", "A clone"],
      expectedReturnsPerPeriod: [0.06, 0.06],
      covariancePerPeriod: [
        [0.04, 0.04],
        [0.04, 0.04],
      ],
      frontierPointCount: 3,
    });

    expect(envelope.result.minimumVariance.weights).toEqual([
      expect.closeTo(0.5, 7),
      expect.closeTo(0.5, 7),
    ]);
    expect(envelope.result.diagnostics.minimumVariance.covarianceRidge).toBeGreaterThan(0);
    expect(envelope.warnings.some((warning) => warning.code === "PRECISION")).toBe(
      true,
    );
  });

  it("activates long-only boundaries while preserving target returns", () => {
    const envelope = runMeanVariance({
      contract: MEAN_VARIANCE_REQUEST_CONTRACT,
      assetIds: ["Anchor", "Redundant", "Diversifier"],
      expectedReturnsPerPeriod: [0.04, 0.09, 0.07],
      covariancePerPeriod: [
        [0.01, 0.018, 0],
        [0.018, 0.04, 0],
        [0, 0, 0.09],
      ],
      frontierPointCount: 9,
    });

    expect(envelope.result.minimumVariance.weights[1]).toBeCloseTo(0, 10);
    expect(envelope.result.minimumVariance.weights[0]).toBeCloseTo(0.9, 8);
    expect(envelope.result.minimumVariance.weights[2]).toBeCloseTo(0.1, 8);
    envelope.result.efficientFrontier.forEach((point) => {
      expect(point.allocation.expectedReturnPerPeriod).toBeCloseTo(
        point.targetReturnPerPeriod,
        8,
      );
      expect(Math.min(...point.allocation.weights)).toBeGreaterThanOrEqual(0);
    });
    expect(envelope.warnings.some((warning) => warning.code === "BOUNDARY")).toBe(
      true,
    );
  });

  it("rejects non-positive-semidefinite covariance", () => {
    expect(() =>
      runMeanVariance({
        contract: MEAN_VARIANCE_REQUEST_CONTRACT,
        assetIds: ["A", "B"],
        expectedReturnsPerPeriod: [0.05, 0.07],
        covariancePerPeriod: [
          [1, 2],
          [2, 1],
        ],
      }),
    ).toThrowError(QuantError);
  });
});

describe("CAPM", () => {
  it("recovers beta, alpha, the security-market line, and portfolio beta", () => {
    const riskFree = 0.005;
    const market = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
    const rows = market.map((marketReturn) => [
      riskFree + 0.002 + 1.5 * (marketReturn - riskFree),
      riskFree - 0.001 + 0.5 * (marketReturn - riskFree),
    ]);
    const envelope = runCapm({
      contract: CAPM_REQUEST_CONTRACT,
      assetIds: ["High beta", "Low beta"],
      assetReturnsPerPeriod: rows,
      marketReturnsPerPeriod: market,
      riskFreeRatePerPeriod: riskFree,
      portfolioWeights: [0.25, 0.75],
    });

    expect(envelope.result.contract).toBe(CAPM_RESULT_CONTRACT);
    expect(envelope.result.assets[0].beta).toBeCloseTo(1.5, 12);
    expect(envelope.result.assets[0].alphaPerPeriod).toBeCloseTo(0.002, 12);
    expect(envelope.result.assets[1].beta).toBeCloseTo(0.5, 12);
    expect(envelope.result.assets[1].alphaPerPeriod).toBeCloseTo(-0.001, 12);
    expect(envelope.result.assets[0].rSquared).toBeCloseTo(1, 12);
    expect(envelope.result.portfolio?.beta).toBeCloseTo(0.75, 12);
    expect(envelope.result.securityMarketLine.interceptPerPeriod).toBe(riskFree);
    expect(envelope.warnings[0].code).toBe("ASSUMPTION");
  });
});

describe("factor regression and scenarios", () => {
  it("recovers synthetic exposures and decomposes portfolio scenario and risk", () => {
    const factors = [-0.02, -0.01, 0, 0.01, 0.02, 0.03];
    const assetRows = factors.map((factor, index) => [
      0.01 + 2 * factor + (index % 2 === 0 ? 0.001 : -0.001),
      -0.005 + 0.5 * factor + (index % 3 === 0 ? 0.0005 : -0.00025),
    ]);
    const envelope = runFactorModel({
      contract: FACTOR_MODEL_REQUEST_CONTRACT,
      assetIds: ["Cyclical", "Defensive"],
      factorIds: ["Market"],
      assetReturnsPerPeriod: assetRows,
      factorReturnsPerPeriod: factors.map((factor) => [factor]),
      portfolioWeights: [0.4, 0.6],
      scenario: {
        label: "Market jumps",
        factorShocksPerPeriod: [0.03],
      },
    });

    expect(envelope.result.contract).toBe(FACTOR_MODEL_RESULT_CONTRACT);
    expect(envelope.result.assets[0].exposures[0]).toBeCloseTo(2, 1);
    expect(envelope.result.assets[1].exposures[0]).toBeCloseTo(0.5, 1);
    expect(envelope.result.assets[0].scenarioReturnChangePerPeriod).toBeCloseTo(
      0.06,
      2,
    );
    const assetRisk = envelope.result.assets[0].riskAttribution;
    expect(
      assetRisk.factorVolatilityContributionsPerPeriod.reduce(
        (total, value) => total + value,
        0,
      ) + assetRisk.residualVolatilityContributionPerPeriod,
    ).toBeCloseTo(assetRisk.totalVolatilityPerPeriod, 9);
    expect(envelope.result.portfolio?.factorExposures[0]).toBeCloseTo(1.1, 1);
    expect(envelope.result.portfolio?.scenarioReturnChangePerPeriod).toBeCloseTo(
      0.033,
      2,
    );
    const portfolio = envelope.result.portfolio;
    expect(portfolio).not.toBeNull();
    if (portfolio) {
      const modeledVolatilityContributions =
        portfolio.factorVolatilityContributionsPerPeriod.reduce(
          (total, value) => total + value,
          0,
        ) + portfolio.idiosyncraticVolatilityContributionPerPeriod;
      expect(modeledVolatilityContributions).toBeCloseTo(
        portfolio.allocation.volatilityPerPeriod,
        9,
      );
    }
  });
});

describe("factor dataset alignment and rolling exposure analysis", () => {
  const timestamps = Array.from(
    { length: 9 },
    (_, index) => `2025-${String(index + 1).padStart(2, "0")}-01`,
  );
  const factors = [-0.03, 0.01, -0.01, 0.03, 0, 0.02, -0.02, 0.04, -0.04];

  it("intersects timestamps, selects named columns, and preserves source indexes", () => {
    const assets = returnDataset(
      ["A", "B"],
      timestamps.slice(0, 6),
      timestamps.slice(0, 6).map((_, index) => [index / 100, index / 50]),
      "asset fixture",
    );
    const factorTimestamps = timestamps.slice(2, 8);
    const factorDataset = returnDataset(
      ["Market", "Value"],
      factorTimestamps,
      factorTimestamps.map((_, index) => [
        index / 10,
        index === 0 ? 0 : -index / 20,
      ]),
      "factor fixture",
    );
    const aligned = alignFactorDatasets({
      contract: FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
      assetReturns: assets,
      factorReturns: factorDataset,
      assetIds: ["B"],
      factorIds: ["Value"],
    });

    expect(aligned.contract).toBe(ALIGNED_FACTOR_DATASET_CONTRACT);
    expect(aligned.timestamps).toEqual(timestamps.slice(2, 6));
    expect(aligned.assetIds).toEqual(["B"]);
    expect(aligned.factorIds).toEqual(["Value"]);
    expect(aligned.assetReturnsPerPeriod).toEqual([[0.04], [0.06], [0.08], [0.1]]);
    expect(aligned.factorReturnsPerPeriod).toEqual([[0], [-0.05], [-0.1], [-0.15]]);
    expect(aligned.alignment.assetSourceRowIndexes).toEqual([2, 3, 4, 5]);
    expect(aligned.alignment.factorSourceRowIndexes).toEqual([0, 1, 2, 3]);
    expect(aligned.alignment.droppedAssetObservationCount).toBe(2);
    expect(aligned.alignment.droppedFactorObservationCount).toBe(2);
  });

  it("rejects incompatible return conventions before fitting", () => {
    const assets = returnDataset(
      ["A"],
      timestamps,
      factors.map((factor) => [factor]),
      "assets",
    );
    const logFactors = {
      ...returnDataset(
        ["Market"],
        timestamps,
        factors.map((factor) => [factor]),
        "factors",
      ),
      returnConvention: "log" as const,
    };

    expect(() => alignFactorDatasets({
      contract: FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
      assetReturns: assets,
      factorReturns: logFactors,
    })).toThrowError(/arithmetic simple returns/);
  });

  it("reports no-look-ahead indexes plus additive return, risk, and shock attribution", () => {
    const assetRows = factors.map((factor, index) => [
      0.01 + 2 * factor + (index >= 5 ? 0.004 : 0),
      -0.002 + 0.5 * factor,
    ]);
    const dataset = alignFactorDatasets({
      contract: FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
      assetReturns: returnDataset(["A", "B"], timestamps, assetRows, "assets"),
      factorReturns: returnDataset(
        ["Market"],
        timestamps,
        factors.map((factor) => [factor]),
        "factors",
      ),
    });
    const envelope = runRollingFactorAnalysis({
      contract: ROLLING_FACTOR_REQUEST_CONTRACT,
      dataset,
      estimationWindowObservations: 5,
      testWindowObservations: 2,
      stepObservations: 1,
      portfolioWeights: [0.25, 0.75],
      scenario: {
        label: "Market down",
        factorShocksPerPeriod: [-0.1],
      },
    });

    expect(envelope.result.contract).toBe(ROLLING_FACTOR_RESULT_CONTRACT);
    expect(envelope.result.lookAheadGuard).toBe(
      "estimation-end-strictly-before-test-start",
    );
    expect(envelope.result.windows).toHaveLength(3);
    const first = envelope.result.windows[0];
    expect(first.estimation).toMatchObject({
      startIndex: 0,
      endIndex: 4,
      observationCount: 5,
    });
    expect(first.test).toMatchObject({
      startIndex: 5,
      endIndex: 6,
      observationCount: 2,
    });
    expect(first.estimation.endIndex).toBeLessThan(first.test.startIndex);
    expect(first.assets[0].exposures[0]).toBeCloseTo(2, 12);
    expect(first.assets[0].returnAttribution.residualContributionPerPeriod).toBeCloseTo(
      0.004,
      12,
    );
    const assetAttribution = first.assets[0].returnAttribution;
    expect(
      assetAttribution.interceptContributionPerPeriod +
        assetAttribution.factorContributionsPerPeriod[0] +
        assetAttribution.residualContributionPerPeriod,
    ).toBeCloseTo(assetAttribution.realizedMeanReturnPerPeriod, 12);
    const assetRisk = first.assets[0].riskAttribution;
    expect(
      assetRisk.factorVolatilityContributionsPerPeriod.reduce(
        (total, value) => total + value,
        0,
      ) + assetRisk.residualVolatilityContributionPerPeriod,
    ).toBeCloseTo(assetRisk.totalVolatilityPerPeriod, 12);
    expect(first.assets[0].scenarioContributionsPerPeriod?.[0]).toBeCloseTo(
      -0.2,
      12,
    );
    expect(first.portfolio?.exposures[0]).toBeCloseTo(0.875, 12);
    expect(first.portfolio?.scenarioReturnChangePerPeriod).toBeCloseTo(-0.0875, 12);
    const portfolioAttribution = first.portfolio?.returnAttribution;
    expect(portfolioAttribution).toBeDefined();
    if (portfolioAttribution) {
      expect(
        portfolioAttribution.interceptContributionPerPeriod +
          portfolioAttribution.factorContributionsPerPeriod[0] +
          portfolioAttribution.residualContributionPerPeriod,
      ).toBeCloseTo(portfolioAttribution.realizedMeanReturnPerPeriod, 12);
    }
  });

  it("keeps an earlier exposure unchanged when only later observations change", () => {
    const makeAligned = (assetRows: readonly (readonly number[])[]) =>
      alignFactorDatasets({
        contract: FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
        assetReturns: returnDataset(["A"], timestamps, assetRows, "assets"),
        factorReturns: returnDataset(
          ["Market"],
          timestamps,
          factors.map((factor) => [factor]),
          "factors",
        ),
      });
    const baseRows = factors.map((factor) => [0.01 + 1.25 * factor]);
    const revisedRows = baseRows.map((row) => [...row]);
    revisedRows[5][0] += 0.25;
    const run = (dataset: ReturnType<typeof makeAligned>) =>
      runRollingFactorAnalysis({
        contract: ROLLING_FACTOR_REQUEST_CONTRACT,
        dataset,
        estimationWindowObservations: 5,
      }).result;
    const base = run(makeAligned(baseRows));
    const revised = run(makeAligned(revisedRows));

    expect(base.windows[0].assets[0].exposures).toEqual(
      revised.windows[0].assets[0].exposures,
    );
    expect(base.windows[0].assets[0].riskAttribution).toEqual(
      revised.windows[0].assets[0].riskAttribution,
    );
    expect(base.windows[1].assets[0].exposures[0]).not.toBeCloseTo(
      revised.windows[1].assets[0].exposures[0],
      6,
    );
  });
});

describe("equal-risk-contribution risk parity", () => {
  it("uses inverse volatility for two uncorrelated equal-budget assets", () => {
    const envelope = runRiskParity({
      contract: RISK_PARITY_REQUEST_CONTRACT,
      assetIds: ["Low vol", "High vol"],
      expectedReturnsPerPeriod: [0.05, 0.08],
      covariancePerPeriod: [
        [0.01, 0],
        [0, 0.04],
      ],
    });

    expect(envelope.result.contract).toBe(RISK_PARITY_RESULT_CONTRACT);
    expect(envelope.result.allocation.weights[0]).toBeCloseTo(2 / 3, 8);
    expect(envelope.result.allocation.weights[1]).toBeCloseTo(1 / 3, 8);
    expect(envelope.result.achievedRiskBudgets[0]).toBeCloseTo(0.5, 8);
    expect(envelope.result.achievedRiskBudgets[1]).toBeCloseTo(0.5, 8);
    expect(envelope.result.diagnostics.converged).toBe(true);
  });

  it("honors non-equal requested risk budgets", () => {
    const envelope = runRiskParity({
      contract: RISK_PARITY_REQUEST_CONTRACT,
      assetIds: ["A", "B"],
      expectedReturnsPerPeriod: [0.05, 0.08],
      covariancePerPeriod: [
        [0.02, 0.004],
        [0.004, 0.05],
      ],
      riskBudgets: [3, 1],
    });

    expect(envelope.result.requestedRiskBudgets).toEqual([0.75, 0.25]);
    expect(envelope.result.achievedRiskBudgets[0]).toBeCloseTo(0.75, 7);
    expect(envelope.result.achievedRiskBudgets[1]).toBeCloseTo(0.25, 7);
  });
});

describe("Kelly construction", () => {
  it("solves full, half, and quarter continuous Kelly with explicit caps", () => {
    const envelope = runKelly({
      contract: KELLY_REQUEST_CONTRACT,
      assetIds: ["Risky asset"],
      expectedExcessReturnsPerPeriod: [0.08],
      covariancePerPeriod: [[0.04]],
      kellyFraction: 0.25,
      maxTotalAllocation: 1,
      maxAssetAllocations: [0.8],
      ruinFloorWealthFraction: 0.5,
      drawdownThresholdFraction: 0.2,
      drawdownHorizonPeriods: 12,
    });

    expect(envelope.result.contract).toBe(KELLY_RESULT_CONTRACT);
    expect(envelope.result.requested.allocations[0]).toBeCloseTo(0.5, 8);
    expect(envelope.result.fullHalfQuarter.map((item) => item.allocations[0])).toEqual([
      expect.closeTo(0.8, 8),
      expect.closeTo(0.8, 8),
      expect.closeTo(0.5, 8),
    ]);
    expect(envelope.result.requested.approximateLogGrowthPerPeriod).toBeCloseTo(
      0.035,
      10,
    );
    expect(
      envelope.result.requested.approximateInfiniteHorizonRuinProbability,
    ).toBeGreaterThanOrEqual(0);
    expect(
      envelope.result.requested.approximateInfiniteHorizonRuinProbability,
    ).toBeLessThanOrEqual(1);
    expect(
      envelope.result.requested.approximateInitialCapitalDrawdownProbability,
    ).toBeGreaterThanOrEqual(0);
    expect(
      envelope.result.requested.approximateInitialCapitalDrawdownProbability,
    ).toBeLessThanOrEqual(1);
    expect(envelope.warnings.some((warning) => warning.code === "ASSUMPTION")).toBe(
      true,
    );
  });

  it("provides the exact classic binary-bet fixture", () => {
    const full = solveBinaryKellyBet({
      winProbability: 0.6,
      netProfitOnWin: 1,
    });
    const half = solveBinaryKellyBet({
      winProbability: 0.6,
      netProfitOnWin: 1,
      kellyFraction: 0.5,
    });

    expect(full.unconstrainedFullKellyFraction).toBeCloseTo(0.2, 12);
    expect(full.fullKellyStakeFraction).toBeCloseTo(0.2, 12);
    expect(half.requestedStakeFraction).toBeCloseTo(0.1, 12);
    expect(full.expectedLogGrowthPerBet).toBeGreaterThan(
      half.expectedLogGrowthPerBet,
    );
  });
});

describe("Black-Litterman", () => {
  const baseRequest = {
    contract: BLACK_LITTERMAN_REQUEST_CONTRACT,
    assetIds: ["Bonds", "Stocks"],
    covariancePerPeriod: [
      [0.04, 0],
      [0, 0.09],
    ],
    marketWeights: [0.6, 0.4],
    riskAversion: 2.5,
    tau: 0.05,
    riskFreeRatePerPeriod: 0.01,
  } as const;

  it("starts from market equilibrium, incorporates a view, and reuses allocation", () => {
    const envelope = runBlackLitterman({
      ...baseRequest,
      views: [{
        id: "stocks-up",
        kind: "absolute",
        assetId: "Stocks",
        expectedReturnPerPeriod: 0.16,
        confidence: 0.75,
      }],
    });

    expect(envelope.result.contract).toBe(BLACK_LITTERMAN_RESULT_CONTRACT);
    expect(envelope.result.equilibriumReturnsPerPeriod).toEqual([
      expect.closeTo(0.07, 10),
      expect.closeTo(0.1, 10),
    ]);
    expect(envelope.result.priorOptimalAllocation.weights[0]).toBeCloseTo(
      baseRequest.marketWeights[0],
      7,
    );
    expect(envelope.result.priorOptimalAllocation.weights[1]).toBeCloseTo(
      baseRequest.marketWeights[1],
      7,
    );
    expect(envelope.result.posteriorReturnsPerPeriod[1]).toBeGreaterThan(
      envelope.result.equilibriumReturnsPerPeriod[1],
    );
    expect(envelope.result.posteriorOptimalAllocation.weights[1]).toBeGreaterThan(
      envelope.result.priorOptimalAllocation.weights[1],
    );
    const contribution =
      envelope.result.views[0].assetReturnContributionsPerPeriod[1];
    expect(contribution).toBeCloseTo(
      envelope.result.posteriorReturnsPerPeriod[1] -
        envelope.result.equilibriumReturnsPerPeriod[1],
      10,
    );
  });

  it("moves posterior returns farther when confidence is higher", () => {
    const run = (confidence: number) =>
      runBlackLitterman({
        ...baseRequest,
        views: [{
          id: "stocks-up",
          kind: "absolute" as const,
          assetId: "Stocks",
          expectedReturnPerPeriod: 0.16,
          confidence,
        }],
      }).result;
    const low = run(0.2);
    const high = run(0.8);
    const prior = low.equilibriumReturnsPerPeriod[1];

    expect(high.posteriorReturnsPerPeriod[1] - prior).toBeGreaterThan(
      low.posteriorReturnsPerPeriod[1] - prior,
    );
  });
});

describe("construction lab seam", () => {
  it("dispatches versioned requests and returns structured-clone-safe data", () => {
    const envelope = runPortfolioConstruction({
      contract: RISK_PARITY_REQUEST_CONTRACT,
      assetIds: ["A", "B"],
      expectedReturnsPerPeriod: [0.04, 0.07],
      covariancePerPeriod: [
        [0.02, 0],
        [0, 0.05],
      ],
    });
    const cloned = structuredClone(envelope);

    expect(cloned.result.contract).toBe(RISK_PARITY_RESULT_CONTRACT);
    expect(cloned.provenance.inputContract).toBe(RISK_PARITY_REQUEST_CONTRACT);
  });

  it("rejects an unknown contract at runtime", () => {
    expect(() =>
      runPortfolioConstruction({ contract: "future-contract" } as never),
    ).toThrowError(/Unsupported portfolio-construction request contract/);
  });
});
