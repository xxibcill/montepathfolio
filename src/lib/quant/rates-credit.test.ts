import { describe, expect, it } from "vitest";
import { mean, populationVariance, QuantError } from "./core";
import {
  CIR_REQUEST_CONTRACT,
  HAZARD_CREDIT_REQUEST_CONTRACT,
  MERTON_CREDIT_REQUEST_CONTRACT,
  NELSON_SIEGEL_FIT_REQUEST_CONTRACT,
  SHORT_RATE_COMPARISON_REQUEST_CONTRACT,
  VASICEK_REQUEST_CONTRACT,
  applyNelsonSiegelShock,
  buildNelsonSiegelNamedShockCurves,
  cirConditionalMoments,
  cirZeroCouponBondAnalytics,
  compareVasicekAndCir,
  evaluateNelsonSiegelYield,
  fitNelsonSiegelCurve,
  mertonStructuralCredit,
  runCirModel,
  runHazardCreditAnalysis,
  runVasicekModel,
  survivalProbability,
  vasicekConditionalMoments,
  vasicekZeroCouponBondAnalytics,
  type CirParameters,
  type NelsonSiegelParameters,
  type VasicekParameters,
} from "./rates-credit";
import { evaluateBlackScholes } from "./derivatives";

const vasicekParameters: VasicekParameters = {
  initialAnnualShortRate: 0.03,
  longRunAnnualMeanRate: 0.04,
  meanReversionSpeedPerYear: 0.7,
  annualVolatility: 0.015,
};

const cirParameters: CirParameters = {
  initialAnnualShortRate: 0.03,
  longRunAnnualMeanRate: 0.04,
  meanReversionSpeedPerYear: 0.7,
  annualVolatility: 0.12,
};

describe("Vasicek lesson", () => {
  it("uses exact, deterministic transitions with stable path prefixes", () => {
    const short = runVasicekModel({
      contract: VASICEK_REQUEST_CONTRACT,
      parameters: vasicekParameters,
      execution: { seed: 42, pathCount: 3, stepCount: 3, stepYears: 0.25 },
      bondMaturitiesYears: [1, 5],
    });
    const long = runVasicekModel({
      contract: VASICEK_REQUEST_CONTRACT,
      parameters: vasicekParameters,
      execution: { seed: 42, pathCount: 5, stepCount: 5, stepYears: 0.25 },
      bondMaturitiesYears: [1, 5],
    });

    expect(short.result.simulationMethod).toBe("exact-gaussian-transition");
    expect(short.result.ratePaths[0]).toEqual(long.result.ratePaths[0].slice(0, 4));
    expect(short.result.ratePaths[2]).toEqual(long.result.ratePaths[2].slice(0, 4));
    expect(short.result.timesYears).toEqual([0, 0.25, 0.5, 0.75]);
    expect(short.provenance.seed).toBe(42);
  });

  it("matches the analytical one-step conditional moments statistically", () => {
    const execution = {
      seed: 91,
      pathCount: 16_000,
      stepCount: 1,
      stepYears: 0.5,
    };
    const simulation = runVasicekModel({
      contract: VASICEK_REQUEST_CONTRACT,
      parameters: vasicekParameters,
      execution,
      bondMaturitiesYears: [],
    });
    const terminalRates = simulation.result.ratePaths.map((path) => path[1]);
    const analytical = vasicekConditionalMoments(
      vasicekParameters.initialAnnualShortRate,
      execution.stepYears,
      vasicekParameters,
    );

    expect(mean(terminalRates)).toBeCloseTo(analytical.mean, 3);
    expect(populationVariance(terminalRates)).toBeCloseTo(analytical.variance, 5);
  });

  it("prices a deterministic zero-coupon bond and reports rate sensitivities", () => {
    const deterministic = { ...vasicekParameters, annualVolatility: 0 };
    const maturityYears = 4;
    const duration =
      (1 - Math.exp(-deterministic.meanReversionSpeedPerYear * maturityYears)) /
      deterministic.meanReversionSpeedPerYear;
    const expectedPrice = Math.exp(
      -deterministic.longRunAnnualMeanRate * maturityYears -
        (deterministic.initialAnnualShortRate -
          deterministic.longRunAnnualMeanRate) *
          duration,
    );
    const analytics = vasicekZeroCouponBondAnalytics(
      deterministic,
      maturityYears,
    );

    expect(analytics.pricePerUnitFace).toBeCloseTo(expectedPrice, 12);
    expect(analytics.shortRateDurationYears).toBeCloseTo(duration, 12);
    expect(analytics.shortRateConvexityYearsSquared).toBeCloseTo(
      duration ** 2,
      12,
    );

    const bump = 1e-5;
    const up = vasicekZeroCouponBondAnalytics(
      { ...deterministic, initialAnnualShortRate: 0.03 + bump },
      maturityYears,
    ).pricePerUnitFace;
    const down = vasicekZeroCouponBondAnalytics(
      { ...deterministic, initialAnnualShortRate: 0.03 - bump },
      maturityYears,
    ).pricePerUnitFace;
    expect(-(up - down) / (2 * bump * analytics.pricePerUnitFace)).toBeCloseTo(
      duration,
      6,
    );
  });

  it("surfaces negative-rate observations and rejects unsupported contracts", () => {
    const simulation = runVasicekModel({
      contract: VASICEK_REQUEST_CONTRACT,
      parameters: {
        ...vasicekParameters,
        initialAnnualShortRate: -0.01,
        longRunAnnualMeanRate: -0.005,
      },
      execution: { seed: 1, pathCount: 20, stepCount: 4, stepYears: 0.25 },
      bondMaturitiesYears: [],
    });
    expect(simulation.result.negativeRateObservationFraction).toBeGreaterThan(0);
    expect(simulation.warnings.some((warning) => warning.code === "BOUNDARY")).toBe(
      true,
    );

    expect(() =>
      runVasicekModel({
        contract: "vasicek/request@999" as typeof VASICEK_REQUEST_CONTRACT,
        parameters: vasicekParameters,
        execution: { seed: 1, pathCount: 1, stepCount: 1, stepYears: 1 },
        bondMaturitiesYears: [],
      }),
    ).toThrow(QuantError);
  });
});

describe("CIR lesson", () => {
  it("keeps every simulated short rate nonnegative and is reproducible", () => {
    const request = {
      contract: CIR_REQUEST_CONTRACT,
      parameters: cirParameters,
      execution: { seed: 8, pathCount: 1_000, stepCount: 24, stepYears: 1 / 12 },
      bondMaturitiesYears: [2, 10],
    } as const;
    const first = runCirModel(request);
    const second = runCirModel(request);

    expect(first.result.simulationMethod).toBe(
      "noncentral-chi-square-transition",
    );
    expect(first.result.ratePaths).toEqual(second.result.ratePaths);
    expect(first.result.ratePaths.flat().every((rate) => rate >= 0)).toBe(true);
  });

  it("reports a Feller warning without altering the requested parameters", () => {
    const violating: CirParameters = {
      ...cirParameters,
      meanReversionSpeedPerYear: 0.5,
      longRunAnnualMeanRate: 0.02,
      annualVolatility: 0.4,
    };
    const result = runCirModel({
      contract: CIR_REQUEST_CONTRACT,
      parameters: violating,
      execution: { seed: 3, pathCount: 10, stepCount: 2, stepYears: 0.25 },
      bondMaturitiesYears: [],
    });

    expect(result.result.fellerConditionSatisfied).toBe(false);
    expect(result.result.parameters).toEqual(violating);
    expect(result.warnings.some((warning) => warning.code === "BOUNDARY")).toBe(
      true,
    );
  });

  it("matches CIR one-step moments and the zero-volatility bond limit", () => {
    const stepYears = 0.5;
    const simulation = runCirModel({
      contract: CIR_REQUEST_CONTRACT,
      parameters: cirParameters,
      execution: { seed: 77, pathCount: 16_000, stepCount: 1, stepYears },
      bondMaturitiesYears: [],
    });
    const terminalRates = simulation.result.ratePaths.map((path) => path[1]);
    const analytical = cirConditionalMoments(
      cirParameters.initialAnnualShortRate,
      stepYears,
      cirParameters,
    );
    expect(mean(terminalRates)).toBeCloseTo(analytical.mean, 3);
    expect(populationVariance(terminalRates)).toBeCloseTo(analytical.variance, 5);

    const deterministic = { ...cirParameters, annualVolatility: 0 };
    const maturityYears = 3;
    const loading =
      (1 - Math.exp(-deterministic.meanReversionSpeedPerYear * maturityYears)) /
      deterministic.meanReversionSpeedPerYear;
    const expectedPrice = Math.exp(
      -deterministic.longRunAnnualMeanRate * maturityYears -
        (deterministic.initialAnnualShortRate -
          deterministic.longRunAnnualMeanRate) *
          loading,
    );
    expect(
      cirZeroCouponBondAnalytics(deterministic, maturityYears).pricePerUnitFace,
    ).toBeCloseTo(expectedPrice, 12);
  });
});

describe("Vasicek and CIR comparison", () => {
  it("aligns fan and bond outputs on the same deterministic contract", () => {
    const shared = {
      initialAnnualShortRate: 0.03,
      longRunAnnualMeanRate: 0.04,
      meanReversionSpeedPerYear: 0.7,
      annualVolatility: 0,
    };
    const comparison = compareVasicekAndCir({
      contract: SHORT_RATE_COMPARISON_REQUEST_CONTRACT,
      vasicekParameters: shared,
      cirParameters: shared,
      execution: {
        seed: 12,
        pathCount: 4,
        stepCount: 8,
        stepYears: 0.25,
      },
      bondMaturitiesYears: [1, 5, 10],
    });

    expect(
      comparison.result.rateFanComparison.every(
        (point) => point.cirMinusVasicekMedianAnnualRate === 0,
      ),
    ).toBe(true);
    expect(
      comparison.result.bondComparison.every(
        (point) =>
          Math.abs(point.cirMinusVasicekPricePerUnitFace) < 1e-12 &&
          Math.abs(point.cirMinusVasicekZeroYield ?? 0) < 1e-12,
      ),
    ).toBe(true);
    expect(comparison.result.diagnostics.cirMinimumSimulatedAnnualRate).toBe(
      0.03,
    );
    expect(comparison.provenance.seed).toBe(12);
  });
});

describe("Nelson-Siegel lesson", () => {
  const parameters: NelsonSiegelParameters = {
    levelAnnualYield: 0.045,
    slopeAnnualYield: -0.025,
    curvatureAnnualYield: 0.018,
    decayYears: 2.25,
  };
  const maturitiesYears = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];

  it("recovers synthetic factors with fixed and fitted decay", () => {
    const observedAnnualYields = maturitiesYears.map((maturity) =>
      evaluateNelsonSiegelYield(parameters, maturity),
    );
    const fixed = fitNelsonSiegelCurve({
      contract: NELSON_SIEGEL_FIT_REQUEST_CONTRACT,
      maturitiesYears,
      observedAnnualYields,
      fixedDecayYears: parameters.decayYears,
    });
    expect(fixed.result.parameters.levelAnnualYield).toBeCloseTo(
      parameters.levelAnnualYield,
      10,
    );
    expect(fixed.result.parameters.slopeAnnualYield).toBeCloseTo(
      parameters.slopeAnnualYield,
      10,
    );
    expect(fixed.result.parameters.curvatureAnnualYield).toBeCloseTo(
      parameters.curvatureAnnualYield,
      10,
    );
    expect(fixed.result.rmseAnnualYield).toBeLessThan(1e-10);

    const fitted = fitNelsonSiegelCurve({
      contract: NELSON_SIEGEL_FIT_REQUEST_CONTRACT,
      maturitiesYears,
      observedAnnualYields,
    });
    expect(fitted.result.parameters.decayYears).toBeCloseTo(
      parameters.decayYears,
      3,
    );
    expect(fitted.result.rmseAnnualYield).toBeLessThan(1e-8);
  });

  it("applies named shocks with teachable factor meanings", () => {
    const parallel = applyNelsonSiegelShock(parameters, {
      name: "parallel-up",
      annualYieldMagnitude: 0.01,
    });
    for (const maturity of maturitiesYears) {
      expect(
        evaluateNelsonSiegelYield(parallel, maturity) -
          evaluateNelsonSiegelYield(parameters, maturity),
      ).toBeCloseTo(0.01, 12);
    }

    const steep = applyNelsonSiegelShock(parameters, {
      name: "steepening",
      annualYieldMagnitude: 0.01,
    });
    const shortChange =
      evaluateNelsonSiegelYield(steep, 0.01) -
      evaluateNelsonSiegelYield(parameters, 0.01);
    const longChange =
      evaluateNelsonSiegelYield(steep, 100) -
      evaluateNelsonSiegelYield(parameters, 100);
    expect(shortChange).toBeLessThan(longChange);

    const curved = applyNelsonSiegelShock(parameters, {
      name: "more-curvature",
      annualYieldMagnitude: 0.01,
    });
    expect(curved.curvatureAnnualYield).toBeCloseTo(
      parameters.curvatureAnnualYield + 0.01,
    );
  });

  it("builds parallel, steepen, flatten, and curvature curve scenarios", () => {
    const curves = buildNelsonSiegelNamedShockCurves(
      parameters,
      [0.01, 2, 100],
      0.01,
    );
    expect(curves.map((curve) => curve.name)).toEqual([
      "parallel",
      "steepen",
      "flatten",
      "curvature",
    ]);
    expect(
      curves[0].curve.every((point) =>
        Math.abs(point.annualYieldChange - 0.01) < 1e-12,
      ),
    ).toBe(true);
    expect(curves[1].curve[0].annualYieldChange).toBeLessThan(0);
    expect(curves[2].curve[0].annualYieldChange).toBeGreaterThan(0);
    expect(curves[3].curve[1].annualYieldChange).toBeGreaterThan(
      curves[3].curve[0].annualYieldChange,
    );
    expect(curves[3].curve[1].annualYieldChange).toBeGreaterThan(
      curves[3].curve[2].annualYieldChange,
    );
  });
});

describe("hazard-rate credit lesson", () => {
  it("matches constant and piecewise survival identities", () => {
    const constant = { kind: "constant", annualHazardRate: 0.03 } as const;
    expect(survivalProbability(constant, 4)).toBeCloseTo(Math.exp(-0.12), 12);

    const piecewise = {
      kind: "piecewise-constant",
      segments: [
        { startYears: 0, annualHazardRate: 0.01 },
        { startYears: 2, annualHazardRate: 0.03 },
      ],
    } as const;
    expect(survivalProbability(piecewise, 5)).toBeCloseTo(Math.exp(-0.11), 12);
  });

  it("reconciles interval default probabilities, expected loss, and recovery", () => {
    const analysis = runHazardCreditAnalysis({
      contract: HAZARD_CREDIT_REQUEST_CONTRACT,
      hazardCurve: { kind: "constant", annualHazardRate: 0.02 },
      evaluationTimesYears: [1, 3, 5],
      exposureAtDefault: 100,
      recoveryFraction: 0.4,
    });
    const finalPoint = analysis.result.curvePoints.at(-1)!;
    const intervalDefaults = analysis.result.curvePoints.reduce(
      (total, point) => total + point.intervalDefaultProbability,
      0,
    );

    expect(intervalDefaults).toBeCloseTo(finalPoint.cumulativeDefaultProbability, 12);
    expect(finalPoint.expectedLoss).toBeCloseTo(
      100 * 0.6 * finalPoint.cumulativeDefaultProbability,
      12,
    );
    expect(finalPoint.expectedRecovery).toBeCloseTo(
      100 * 0.4 * finalPoint.cumulativeDefaultProbability,
      12,
    );
    expect(finalPoint.survivalProbability).toBeGreaterThanOrEqual(0);
    expect(finalPoint.survivalProbability).toBeLessThanOrEqual(1);
  });

  it("prices risky scheduled principal and recovery cash flows exactly", () => {
    const annualHazardRate = 0.02;
    const continuouslyCompoundedRiskFreeRate = 0.03;
    const maturityYears = 2;
    const recoveryFraction = 0.4;
    const faceValue = 100;
    const result = runHazardCreditAnalysis({
      contract: HAZARD_CREDIT_REQUEST_CONTRACT,
      hazardCurve: { kind: "constant", annualHazardRate },
      evaluationTimesYears: [maturityYears],
      exposureAtDefault: faceValue,
      recoveryFraction,
      bond: {
        faceValue,
        annualCouponRate: 0,
        couponFrequencyPerYear: 1,
        maturityYears,
        continuouslyCompoundedRiskFreeRate,
      },
    });
    const combinedRate = annualHazardRate + continuouslyCompoundedRiskFreeRate;
    const expectedScheduled = faceValue * Math.exp(-combinedRate * maturityYears);
    const expectedRecovery =
      recoveryFraction *
      faceValue *
      (annualHazardRate / combinedRate) *
      (1 - Math.exp(-combinedRate * maturityYears));

    expect(result.result.bondValuation!.scheduledPresentValue).toBeCloseTo(
      expectedScheduled,
      12,
    );
    expect(result.result.bondValuation!.recoveryPresentValue).toBeCloseTo(
      expectedRecovery,
      12,
    );
    expect(result.result.bondValuation!.price).toBeCloseTo(
      expectedScheduled + expectedRecovery,
      12,
    );
  });
});

describe("Merton structural-credit lesson", () => {
  it("matches the Black-Scholes fixture and balance-sheet identities", () => {
    const analysis = mertonStructuralCredit({
      contract: MERTON_CREDIT_REQUEST_CONTRACT,
      assetValue: 100,
      debtFaceValue: 100,
      maturityYears: 1,
      continuouslyCompoundedRiskFreeRate: 0.05,
      annualAssetVolatility: 0.2,
      physicalExpectedAssetReturn: 0.08,
    });
    const result = analysis.result;
    const equityOption = evaluateBlackScholes({
      optionType: "call",
      spot: 100,
      strike: 100,
      timeToMaturityYears: 1,
      riskFreeRate: 0.05,
      volatility: 0.2,
      dividendYield: 0,
    });
    const guaranteePut = evaluateBlackScholes({
      optionType: "put",
      spot: 100,
      strike: 100,
      timeToMaturityYears: 1,
      riskFreeRate: 0.05,
      volatility: 0.2,
      dividendYield: 0,
    });

    expect(result.equityValue).toBeCloseTo(10.4506, 3);
    expect(result.equityValue).toBe(equityOption.price);
    expect(result.equityDeltaToAssetValue).toBe(equityOption.greeks.delta);
    expect(result.debtGuaranteePutValue).toBe(guaranteePut.price);
    expect(result.equityValue + result.riskyDebtValue).toBeCloseTo(100, 10);
    expect(
      result.riskyDebtValue + result.debtGuaranteePutValue,
    ).toBeCloseTo(result.defaultFreeDebtValue, 10);
    expect(result.physicalDefaultProbability).not.toBe(
      result.riskNeutralDefaultProbability,
    );
    expect(result.physicalDefaultProbability).toBeGreaterThanOrEqual(0);
    expect(result.physicalDefaultProbability).toBeLessThanOrEqual(1);
    expect(result.annualCreditSpread).toBeGreaterThanOrEqual(0);
  });

  it("handles the deterministic volatility limit without infinities", () => {
    const safeDebt = mertonStructuralCredit({
      contract: MERTON_CREDIT_REQUEST_CONTRACT,
      assetValue: 150,
      debtFaceValue: 100,
      maturityYears: 1,
      continuouslyCompoundedRiskFreeRate: 0.03,
      annualAssetVolatility: 0,
      physicalExpectedAssetReturn: 0.06,
    });
    expect(safeDebt.result.riskNeutralDefaultProbability).toBe(0);
    expect(safeDebt.result.distanceToDefault).toBeNull();
    expect(safeDebt.result.riskyDebtValue).toBeCloseTo(100 * Math.exp(-0.03), 12);
    expect(safeDebt.result.annualCreditSpread).toBeCloseTo(0, 12);
    expect(safeDebt.warnings.some((warning) => warning.code === "BOUNDARY")).toBe(
      true,
    );
  });
});
