import {
  CAPM_REQUEST_CONTRACT,
  FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
  FACTOR_MODEL_REQUEST_CONTRACT,
  KELLY_REQUEST_CONTRACT,
  MEAN_VARIANCE_REQUEST_CONTRACT,
  ROLLING_FACTOR_REQUEST_CONTRACT,
  RISK_PARITY_REQUEST_CONTRACT,
  BLACK_LITTERMAN_REQUEST_CONTRACT,
  alignFactorDatasets,
  runBlackLitterman,
  runCapm,
  runFactorModel,
  runKelly,
  runMeanVariance,
  runRollingFactorAnalysis,
  runRiskParity,
} from "../lib/quant/construction";
import {
  BINOMIAL_TREE_REQUEST_CONTRACT,
  BLACK_SCHOLES_REQUEST_CONTRACT,
  BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT,
  EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT,
  HESTON_REQUEST_CONTRACT,
  MONTE_CARLO_REQUEST_CONTRACT,
  STRATEGY_VALUATION_REQUEST_CONTRACT,
  compareEuropeanPricingMethods,
  buildBlackScholesSurface,
  createBullCallSpread,
  createCoveredCall,
  createIronCondor,
  createProtectivePut,
  createStraddle,
  createStrangle,
  optionPayoff,
  priceBinomialTree,
  priceBlackScholes,
  priceHestonMonteCarlo,
  priceMonteCarloOption,
  valueOptionStrategy,
  type MonteCarloOptionRequest,
  type SingleAssetPayoffSpec,
} from "../lib/quant/derivatives";
import {
  CIR_REQUEST_CONTRACT,
  HAZARD_CREDIT_REQUEST_CONTRACT,
  MERTON_CREDIT_REQUEST_CONTRACT,
  NELSON_SIEGEL_FIT_REQUEST_CONTRACT,
  SHORT_RATE_COMPARISON_REQUEST_CONTRACT,
  buildNelsonSiegelNamedShockCurves,
  compareVasicekAndCir,
  evaluateNelsonSiegelCurve,
  fitNelsonSiegelCurve,
  mertonStructuralCredit,
  runCirModel,
  runHazardCreditAnalysis,
} from "../lib/quant/rates-credit";
import {
  QuantError,
  correlation,
  createSemanticRandom,
  mean,
  populationVariance,
  quantile,
  type ModelEnvelope,
} from "../lib/quant/core";
import {
  STUDENT_T_INNOVATIONS_REQUEST_CONTRACT,
  fitGarch,
  fitOrderedRegimes,
  runCopula,
  runGarch,
  runHistoricalBootstrap,
  runMertonJumpDiffusion,
  runStudentTInnovations,
  type GarchParameters,
  type ReturnDataset,
} from "../lib/quant/market-models";
import {
  PORTFOLIO_LAB_V2_CONTRACT,
  PORTFOLIO_LAB_V2_MODEL_CONTRACT,
  type PortfolioLabV2Case,
  type PortfolioLabV2Request,
} from "../lib/portfolio-lab/advanced-contracts";
import { runPortfolioLabV2 } from "../lib/portfolio-lab/advanced-runner";
import {
  backtestValueAtRisk,
  calculateParametricRiskAttribution,
  calculateVarCvar,
  compareReversedRetirementReturns,
  runRetirementSequence,
  type RetirementRebalancePolicy,
  type WithdrawalPolicy,
} from "../lib/quant/risk";
import {
  fitOrnsteinUhlenbeck,
  runAgentMarket,
  runAlmgrenChriss,
  runLimitOrderBook,
  runOrnsteinUhlenbeck,
} from "../lib/quant/trading";
import type {
  LessonMetric,
  LessonChartAxes,
  LessonCalibrationSnapshot,
  LessonOutput,
  LessonSeries,
} from "./lesson-types";
import type { LessonDataAttachment } from "./lesson-worker-protocol";
import {
  parseImportedFactorDataset,
  parseImportedReturnDataset,
} from "./imported-datasets";
import {
  validateLessonValues,
  type LessonValues,
} from "./lesson-values";

type Values = LessonValues;
type Runner = (
  values: Values,
  attachment?: LessonDataAttachment,
  calibrationSnapshot?: LessonCalibrationSnapshot,
) => LessonOutput;

const runners: Readonly<Record<string, Runner>> = {
  "jump-diffusion": runJumpDiffusionLesson,
  garch: runGarchLesson,
  "historical-bootstrap": runBootstrapLesson,
  "retirement-sequence": runRetirementLesson,
  "regime-calibration": runRegimeLesson,
  "student-t": runStudentTLesson,
  copulas: runCopulaLesson,
  "composite-market": runCompositeLesson,
  "var-cvar": runVarLesson,
  "risk-backtesting": runBacktestingLesson,
  "mean-variance": runMeanVarianceLesson,
  capm: runCapmLesson,
  "factor-models": runFactorLesson,
  "risk-parity": runRiskParityLesson,
  kelly: runKellyLesson,
  "black-litterman": runBlackLittermanLesson,
  "black-scholes": runBlackScholesLesson,
  "binomial-tree": runBinomialLesson,
  "monte-carlo-options": runMonteCarloOptionLesson,
  heston: runHestonLesson,
  "strategy-builder": runStrategyLesson,
  vasicek: runVasicekLesson,
  cir: runCirLesson,
  "nelson-siegel": runNelsonSiegelLesson,
  "hazard-credit": runHazardLesson,
  "merton-credit": runMertonCreditLesson,
  "ornstein-uhlenbeck": runOuLesson,
  "order-book": runOrderBookLesson,
  "agent-market": runAgentMarketLesson,
  "optimal-execution": runExecutionLesson,
};

const PRIMARY_CHART_AXES: Readonly<Record<string, LessonChartAxes>> = {
  "jump-diffusion": { xLabel: "Simulation step", xUnit: "months", yLabel: "Asset price", yUnit: "currency" },
  garch: { xLabel: "Simulation step", yLabel: "Conditional variance", yUnit: "return² per step" },
  "historical-bootstrap": { xLabel: "Sampled period", yLabel: "Wealth index", yUnit: "start = 1" },
  "retirement-sequence": { xLabel: "Plan period", xUnit: "months", yLabel: "Portfolio wealth", yUnit: "currency" },
  "regime-calibration": { xLabel: "Observation", xUnit: "index", yLabel: "Ordered regime", yUnit: "0 bear · 1 sideways · 2 bull" },
  "student-t": { xLabel: "Cumulative probability", yLabel: "Innovation quantile", yUnit: "standard deviations" },
  copulas: { xLabel: "Asset A innovation", yLabel: "Asset B innovation", xUnit: "standard deviations", yUnit: "standard deviations" },
  "composite-market": { xLabel: "Simulation step", xUnit: "months", yLabel: "Portfolio wealth", yUnit: "currency" },
  "var-cvar": { xLabel: "Method", xUnit: "category index", yLabel: "Loss", yUnit: "currency" },
  "risk-backtesting": { xLabel: "Test observation", xUnit: "index", yLabel: "Loss / VaR", yUnit: "currency" },
  "mean-variance": { xLabel: "Portfolio volatility", xUnit: "fraction per period", yLabel: "Expected return", yUnit: "fraction per period" },
  capm: { xLabel: "Beta", yLabel: "Expected return", yUnit: "fraction per period" },
  "factor-models": { xLabel: "Out-of-sample observation", xUnit: "index", yLabel: "Factor loading", yUnit: "beta" },
  "risk-parity": { xLabel: "Asset", xUnit: "category index", yLabel: "Portfolio fraction" },
  kelly: { xLabel: "Kelly fraction", yLabel: "Modeled fraction per period" },
  "black-litterman": { xLabel: "Asset", xUnit: "category index", yLabel: "Expected return", yUnit: "fraction per period" },
  "black-scholes": { xLabel: "Underlying spot", yLabel: "Call value", xUnit: "currency", yUnit: "currency" },
  "binomial-tree": { xLabel: "Time", xUnit: "years", yLabel: "Exercise boundary spot", yUnit: "currency" },
  "monte-carlo-options": { xLabel: "Time", xUnit: "years", yLabel: "Simulated asset price", yUnit: "currency" },
  heston: { xLabel: "Time", xUnit: "years", yLabel: "Spot price", yUnit: "currency" },
  "strategy-builder": { xLabel: "Terminal spot", xUnit: "currency", yLabel: "Payoff / profit", yUnit: "currency" },
  vasicek: { xLabel: "Time", xUnit: "years", yLabel: "Annual short rate", yUnit: "fraction" },
  cir: { xLabel: "Time", xUnit: "years", yLabel: "Annual short rate", yUnit: "fraction" },
  "nelson-siegel": { xLabel: "Maturity", xUnit: "years", yLabel: "Annual zero yield", yUnit: "fraction" },
  "hazard-credit": { xLabel: "Time", xUnit: "years", yLabel: "Probability", yUnit: "fraction" },
  "merton-credit": { xLabel: "Firm asset value", xUnit: "currency", yLabel: "Claim payoff", yUnit: "currency" },
  "ornstein-uhlenbeck": { xLabel: "Time", xUnit: "years", yLabel: "Modeled spread", yUnit: "spread units" },
  "order-book": { xLabel: "Limit price", xUnit: "currency", yLabel: "Signed depth", yUnit: "units" },
  "agent-market": { xLabel: "Market step", yLabel: "Scenario price", yUnit: "currency" },
  "optimal-execution": { xLabel: "Execution time", xUnit: "horizon fraction", yLabel: "Shares remaining", yUnit: "shares" },
};

export function runLesson(
  id: string,
  values: Readonly<Record<string, number>>,
  attachment?: LessonDataAttachment,
  calibrationSnapshot?: LessonCalibrationSnapshot,
): LessonOutput {
  const validatedValues = validateLessonValues(id, values);
  const runner = runners[id];
  if (!runner) throw new Error(`Lesson ${id} has no calculation runner.`);
  const output = runner(
    validatedValues,
    attachment,
    calibrationSnapshot,
  );
  const chartAxes = output.chartAxes ?? PRIMARY_CHART_AXES[id];
  if (!chartAxes) throw new Error(`No chart semantics are registered for ${id}.`);
  return { ...output, chartAxes };
}

function runJumpDiffusionLesson(values: Values): LessonOutput {
  const baseInput = {
    contract: "market-model/merton-jump-diffusion@1" as const,
    initialPrices: [100],
    assets: [{ annualDrift: values.drift, annualVolatility: values.volatility }],
    correlation: [[1]],
    execution: {
      seed: 20260731,
      paths: 2_000,
      steps: 120,
      stepYears: 1 / 12,
      samplePaths: 8,
    },
  };
  const jumped = runMertonJumpDiffusion({
    ...baseInput,
    jumps: [{
      annualIntensity: values.jumpIntensity,
      meanLogJump: values.meanJump,
      logJumpVolatility: 0.12,
    }],
  });
  const baseline = runMertonJumpDiffusion({
    ...baseInput,
    jumps: [{ annualIntensity: 0, meanLogJump: values.meanJump, logJumpVolatility: 0.12 }],
  });
  const terminals = jumped.result.terminalPrices.map((row) => row[0]);
  const baselineTerminals = baseline.result.terminalPrices.map((row) => row[0]);
  const firstPathJumpMarkers = jumped.result.sampledJumpEvents
    .filter((event) => event.pathIndex === 0 && event.assetIndex === 0)
    .map((event) => ({
      x: event.stepIndex,
      y: jumped.result.sampledPricePaths[0][0][event.stepIndex],
      label: `${event.count} jump${event.count === 1 ? "" : "s"}; aggregate log move ${fixed(event.aggregateLogJump, 3)}`,
    }));
  const tailProbabilities = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5];
  return outputFromEnvelope(jumped, {
    headline: "Rare jumps widen the left tail without shifting diffusion draws.",
    explanation: `The median terminal price is ${money(quantile(terminals, 0.5))}; the paired no-jump median is ${money(quantile(baselineTerminals, 0.5))}. Arrival and size draws use separate semantic addresses.`,
    metrics: [
      metric("Median terminal", money(quantile(terminals, 0.5)), "Across 2,000 ten-year paths"),
      metric("5th percentile", money(quantile(terminals, 0.05)), "A tail outcome, not a forecast", "caution"),
      metric("Empirical arrivals", fixed(jumped.result.diagnostics.empiricalAnnualJumpCounts[0], 2), "Per simulated year"),
      metric("95% loss CVaR", percentage(jumped.result.diagnostics.terminalLoss95Cvar[0]), "Mean positive terminal loss at or beyond VaR", "caution"),
    ],
    series: [
      pathSeries("Jump diffusion", jumped.result.sampledPricePaths[0][0], "vermilion"),
      pathSeries("Paired GBM", baseline.result.sampledPricePaths[0][0], "forest"),
      ...(firstPathJumpMarkers.length > 0
        ? [{
            name: "Jump events",
            tone: "ochre" as const,
            style: "points" as const,
            points: firstPathJumpMarkers,
          }]
        : []),
    ],
    additionalCharts: [{
      title: "Jump diffusion versus GBM terminal-price tails",
      xLabel: "Cumulative probability",
      yLabel: "Terminal price quantile",
      yUnit: "currency",
      series: [
        quantileSeries("Jump diffusion", terminals, tailProbabilities, "vermilion"),
        quantileSeries("Paired GBM", baselineTerminals, tailProbabilities, "forest"),
      ],
    }],
    diagnostics: [
      `Jump markers retained: ${jumped.result.sampledJumpEvents.length}`,
      `Crash-path frequency: ${percentage(jumped.result.diagnostics.probabilityOfAnyCrash)}`,
      `Mean maximum drawdown: ${percentage(jumped.result.diagnostics.meanMaximumDrawdown[0])}; conditional on at least one jump: ${jumped.result.diagnostics.jumpConditionedMeanMaximumDrawdown[0] === null ? "not observed" : percentage(jumped.result.diagnostics.jumpConditionedMeanMaximumDrawdown[0])}`,
      `Compensated expected growth benchmark: ${fixed(jumped.result.diagnostics.compensatedMeanGrowth[0], 3)}×`,
      values.jumpIntensity === 0
        ? "Limiting check active: zero intensity is path-for-path GBM."
        : "Diffusion, arrival, and size streams are isolated.",
    ],
    compactSummary: {
      medianTerminal: quantile(terminals, 0.5),
      percentile05: quantile(terminals, 0.05),
      empiricalAnnualJumpCount: jumped.result.diagnostics.empiricalAnnualJumpCounts[0],
      terminalLoss95VaR: jumped.result.diagnostics.terminalLoss95VaR[0],
      terminalLoss95Cvar: jumped.result.diagnostics.terminalLoss95Cvar[0],
      jumpConditionedMeanMaximumDrawdown:
        jumped.result.diagnostics.jumpConditionedMeanMaximumDrawdown[0] ?? "not-observed",
    },
  });
}

function runGarchLesson(
  values: Values,
  attachment?: LessonDataAttachment,
  storedSnapshot?: LessonCalibrationSnapshot,
): LessonOutput {
  const storedGarchSnapshot =
    storedSnapshot?.modelContract === "market-model/garch-1-1@1"
      ? storedSnapshot
      : null;
  const calibrationDataset =
    attachment || !storedGarchSnapshot
      ? attachment
        ? parseImportedReturnDataset(attachment, {
            frequency: "monthly",
            returnConvention: "simple",
          })
        : illustrativeReturnDataset(240)
      : null;
  const calibration = storedGarchSnapshot ?? fitGarch(calibrationDataset!, 0);
  const parameters: GarchParameters = attachment || storedGarchSnapshot
    ? calibration.estimates
    : {
        omega: values.omega,
        alpha: values.alpha,
        beta: values.beta,
        meanReturn: 0.00025,
      };
  const envelope = runGarch({
    contract: "market-model/garch-1-1@1",
    parameters,
    initialVariance:
      parameters.alpha + parameters.beta < 1
        ? "unconditional"
        : parameters.omega,
    innovation: {
      kind: "student-t",
      degreesOfFreedom: values.degreesOfFreedom,
    },
    execution: { seed: 405, paths: 40, steps: 120, samplePaths: 8 },
  });
  const { result } = envelope;
  const initialVariance = result.sampledConditionalVariances[0][0];
  const constantVariance = runGarch({
    contract: "market-model/garch-1-1@1",
    parameters: {
      omega: initialVariance,
      alpha: 0,
      beta: 0,
      meanReturn: parameters.meanReturn,
    },
    initialVariance,
    innovation: {
      kind: "student-t",
      degreesOfFreedom: values.degreesOfFreedom,
    },
    execution: { seed: 405, paths: 40, steps: 120, samplePaths: 8 },
  }).result;
  const parameterSource = attachment
    ? `Parameters were fitted from ${attachment.filename}. `
    : storedGarchSnapshot
      ? "Parameters were restored from the saved immutable calibration snapshot. "
      : "The sliders supply the simulation parameters. ";
  const output = outputFromEnvelope(envelope, {
    headline: "Variance clusters because shocks feed the next step.",
    explanation: `${parameterSource}Persistence is ${fixed(result.diagnostics.persistence, 3)}. ${result.diagnostics.unconditionalVariance === null ? "No finite unconditional variance exists." : `The stationary unconditional variance is ${fixed(result.diagnostics.unconditionalVariance, 6)} per step.`}`,
    metrics: [
      metric("α + β", fixed(result.diagnostics.persistence, 3), "Conditional-variance persistence", result.diagnostics.persistence >= 1 ? "caution" : "neutral"),
      metric("Initial volatility", percentage(Math.sqrt(result.sampledConditionalVariances[0][0])), "Per-step standard deviation"),
      metric("20-step cone", percentage(Math.sqrt(result.volatilityCone[19].expectedVariance)), "Expected per-step volatility"),
      metric("Innovation", `t(${Math.round(values.degreesOfFreedom)})`, "Standardized to unit variance"),
    ],
    series: [
      pathSeries("Conditional variance", result.sampledConditionalVariances[0], "vermilion"),
      {
        name: "Expected variance cone",
        tone: "forest",
        points: result.volatilityCone.map((point) => ({ x: point.step, y: point.expectedVariance })),
      },
    ],
    additionalCharts: [{
      title: "GARCH versus paired constant-volatility wealth path",
      xLabel: "Simulation step",
      yLabel: "Wealth index",
      yUnit: "start = 1",
      series: [
        pathSeries("GARCH wealth index", cumulativeGrowth(result.sampledReturns[0]), "vermilion"),
        pathSeries("Constant-volatility wealth index", cumulativeGrowth(constantVariance.sampledReturns[0]), "forest"),
      ],
    }],
    diagnostics: [
      `Initial variance policy: ${result.diagnostics.initialVariancePolicy}`,
      `Calibration: ${calibration.fittingMethod} · converged ${String(calibration.convergence.converged)} · ${calibration.sampleStart} to ${calibration.sampleEnd}`,
      `Data provenance: ${calibration.dataProvenance.label} (${calibration.dataProvenance.kind})`,
      parameters.alpha === 0 && parameters.beta === 0
        ? "Limiting check active: variance is constant at ω."
        : "Recursion order uses the prior innovation and prior variance.",
    ],
    compactSummary: {
      persistence: result.diagnostics.persistence,
      unconditionalVariance: result.diagnostics.unconditionalVariance ?? "undefined",
      innovationDegreesOfFreedom: values.degreesOfFreedom,
      calibrationKind: calibration.dataProvenance.kind,
      fittedOmega: calibration.estimates.omega,
      fittedAlpha: calibration.estimates.alpha,
      fittedBeta: calibration.estimates.beta,
    },
    ...(attachment || storedGarchSnapshot
      ? {
          calibrationSnapshot: calibration as Extract<
            LessonCalibrationSnapshot,
            { readonly modelContract: "market-model/garch-1-1@1" }
          >,
        }
      : {}),
  });
  return attachment || storedGarchSnapshot
    ? {
        ...output,
        provenance: [
          ...output.provenance,
          ...(attachment ? [`User dataset: ${attachment.filename}`] : []),
          `Calibration snapshot: ${calibration.contract}`,
        ],
      }
    : output;
}

function runBootstrapLesson(
  values: Values,
  attachment?: LessonDataAttachment,
): LessonOutput {
  const dataset = attachment
    ? parseImportedReturnDataset(attachment, {
        frequency: "monthly",
        returnConvention: "simple",
      })
    : illustrativeReturnDataset(72);
  const method = Math.round(values.bootstrapMethod) === 0
    ? ({ kind: "iid" } as const)
    : ({ kind: "moving-block", blockSize: Math.round(values.blockSize) } as const);
  const envelope = runHistoricalBootstrap({
    contract: "market-model/historical-bootstrap@1",
    dataset,
    method,
    seed: 88,
    paths: 12,
    steps: Math.round(values.steps),
    samplePaths: 4,
  });
  const sourceIndexes = envelope.result.sampledSourceIndexes[0];
  const cumulative = cumulativeGrowth(
    envelope.result.sampledRows[0].map((row) => row[0]),
  );
  const output = outputFromEnvelope(envelope, {
    headline: method.kind === "iid"
      ? "IID resampling preserves rows but deliberately forgets their order."
      : "Moving blocks preserve local order while resampling history.",
    explanation: `The first sampled source indexes are ${sourceIndexes.slice(0, 9).join(" → ")}. Every return row remains an observed row from the provenance-labelled ${attachment ? "user dataset" : "illustrative dataset"}.`,
    metrics: [
      metric("Source rows", String(dataset.rows.length), "Aligned two-asset observations"),
      metric("Method", method.kind === "iid" ? "IID rows" : "Moving block", method.kind === "iid" ? "Order is not retained" : `${Math.round(values.blockSize)} consecutive rows`),
      metric("Sample length", String(Math.round(values.steps)), "Rows in each path"),
      metric("Replacement", "Yes", "A source row may appear more than once"),
    ],
    series: [pathSeries("Bootstrapped wealth index", cumulative, "forest")],
    table: {
      caption: "First twelve sampled source rows",
      columns: ["Path step", "Source row", ...dataset.assetIds.map((id) => `${id} return`)],
      rows: envelope.result.sampledRows[0].slice(0, 12).map((row, index) => [
        String(index + 1),
        String(sourceIndexes[index]),
        ...row.map(percentage),
      ]),
    },
    diagnostics: [
      `Provenance: ${envelope.result.provenance.sourceLabel}`,
      `Source window: ${envelope.result.provenance.sampleStart} to ${envelope.result.provenance.sampleEnd}`,
      method.kind === "iid"
        ? "Each step draws a source row independently with replacement."
        : "Within-block ordering is invariant and covered by a source-index test.",
    ],
    compactSummary: {
      sourceRows: dataset.rows.length,
      method: method.kind,
      blockSize: method.kind === "moving-block" ? method.blockSize : 1,
      sampledSteps: values.steps,
      dataKind: dataset.provenance.kind,
    },
  });
  return attachment
    ? { ...output, provenance: [...output.provenance, `User dataset: ${attachment.filename}`] }
    : output;
}

function runRetirementLesson(values: Values): LessonOutput {
  const years = Math.round(values.years);
  const accumulationYears = Math.round(values.accumulationYears);
  const assetReturnPaths = buildRetirementAssetReturnPaths(
    500,
    (years + accumulationYears) * 12,
  );
  const policyIndex = Math.round(values.withdrawalPolicy);
  const withdrawalPolicy: WithdrawalPolicy =
    policyIndex === 1
      ? { kind: "percentage", annualRate: values.withdrawalRate }
      : policyIndex === 2
        ? {
            kind: "guardrails",
            initialAnnualAmount: values.annualWithdrawal,
            lowerWithdrawalRate: 0.035,
            upperWithdrawalRate: 0.06,
            adjustmentRate: 0.1,
          }
        : { kind: "fixed-real", annualAmount: values.annualWithdrawal };
  const rebalance: RetirementRebalancePolicy =
    Math.round(values.rebalanceMonths) === 0
      ? { kind: "never" }
      : { kind: "periodic", everyPeriods: Math.round(values.rebalanceMonths) };
  const input = {
    contract: "portfolio-lab/retirement-sequence@1" as const,
    initialCapital: values.initialCapital,
    annualContribution: values.annualContribution,
    accumulationYears,
    retirementYears: years,
    periodsPerYear: 12,
    annualInflationRate: values.inflation,
    withdrawalPolicy,
    assetReturnPaths,
    targetWeights: [values.stockAllocation, 1 - values.stockAllocation],
    rebalance,
    samplePaths: 24,
  };
  const envelope = runRetirementSequence(input);
  const reversed = compareReversedRetirementReturns(
    { ...input, assetReturnPaths: [assetReturnPaths[0]] },
    0,
  );
  return outputFromEnvelope(envelope, {
    headline: "Withdrawals make return order matter.",
    explanation: `The same first-path return multiset changes ending wealth by ${money(Math.abs(reversed.endingWealthDifference))} when reversed. Across all illustrative paths, depletion frequency is ${percentage(envelope.result.depletionProbability)}.`,
    metrics: [
      metric("Depletion probability", percentage(envelope.result.depletionProbability), "Wealth reaches zero before the horizon", envelope.result.depletionProbability > 0.2 ? "caution" : "neutral"),
      metric("Median bequest", money(envelope.result.medianBequest), "Nominal wealth after the final period"),
      metric("Median real spending", money(envelope.result.medianRealSpending * 12), "Annualized time-zero purchasing power"),
      metric("Order effect", money(reversed.endingWealthDifference), "Forward minus reversed ending wealth"),
    ],
    series: [
      pathSeries("Forward return order", reversed.forward.paths[0].wealth, "forest"),
      pathSeries("Reversed return order", reversed.reversed.paths[0].wealth, "vermilion"),
    ],
    diagnostics: [
      `Cash-flow order: ${envelope.result.eventOrder}`,
      `Policy: ${withdrawalPolicy.kind} · allocation: ${percentage(values.stockAllocation)} stocks / ${percentage(1 - values.stockAllocation)} bonds`,
      `Rebalancing: ${rebalance.kind === "never" ? "never" : `every ${rebalance.everyPeriods} months`}`,
      "Forward and reversed experiments contain the exact same multi-asset retirement return rows.",
      "Wealth is floored at zero; no path silently borrows after depletion.",
    ],
    compactSummary: {
      depletionProbability: envelope.result.depletionProbability,
      medianBequest: envelope.result.medianBequest,
      sequenceEndingWealthDifference: reversed.endingWealthDifference,
      stockAllocation: values.stockAllocation,
      withdrawalPolicy: withdrawalPolicy.kind,
    },
  });
}

function runRegimeLesson(
  values: Values,
  attachment?: LessonDataAttachment,
  storedSnapshot?: LessonCalibrationSnapshot,
): LessonOutput {
  const storedRegimeSnapshot =
    storedSnapshot?.modelContract === "market-model/ordered-regimes@1"
      ? storedSnapshot
      : null;
  const dataset =
    attachment || !storedRegimeSnapshot
      ? attachment
        ? parseImportedReturnDataset(attachment, {
            frequency: "monthly",
            returnConvention: "log",
          })
        : syntheticRegimeDataset(
            Math.round(values.observations),
            values.persistence,
          )
      : null;
  const snapshot = storedRegimeSnapshot ?? fitOrderedRegimes(dataset!);
  const observationCount = snapshot.estimates.statePath.length;
  const counts = snapshot.estimates.statePath.reduce(
    (totals, state) => {
      totals[state] += 1;
      return totals;
    },
    [0, 0, 0],
  );
  return {
    resultContract: snapshot.modelContract,
    headline: "Regime labels are fitted constructs with recorded provenance.",
    explanation: `The transparent classifier found mean returns ${snapshot.estimates.means.map((value) => percentage(value)).join(", ")} for bear, sideways, and bull bins.`,
    metrics: [
      metric("Bear occupancy", percentage(counts[0] / observationCount), "Ordered low-return group"),
      metric("Sideways occupancy", percentage(counts[1] / observationCount), "Ordered middle group"),
      metric("Bull occupancy", percentage(counts[2] / observationCount), "Ordered high-return group"),
      metric("Fit iterations", String(snapshot.convergence.iterations), "Transparent one-pass classifier"),
    ],
    series: [
      {
        name: "Classified state",
        tone: "ochre",
        style: "step",
        points: snapshot.estimates.statePath.map((state, index) => ({ x: index, y: state })),
      },
    ],
    table: {
      caption: "One-step transition matrix",
      columns: ["From / to", "Bear", "Sideways", "Bull"],
      rows: snapshot.estimates.transitionMatrix.map((row, index) => [
        snapshot.estimates.regimeLabels[index],
        ...row.map(percentage),
      ]),
    },
    diagnostics: [
      `Method: ${snapshot.fittingMethod}`,
      `Sample: ${snapshot.sampleStart} to ${snapshot.sampleEnd} · ${snapshot.observationFrequency} ${snapshot.returnConvention} returns`,
      `Converged: ${String(snapshot.convergence.converged)}`,
    ],
    warnings: [...snapshot.warnings],
    provenance: [
      `Data: ${snapshot.dataProvenance.label}`,
      `Kind: ${snapshot.dataProvenance.kind}`,
      `Schema: calibration-snapshot@1`,
      ...(attachment ? [`User dataset: ${attachment.filename}`] : []),
    ],
    compactSummary: {
      observations: observationCount,
      fittedBearMean: snapshot.estimates.means[0],
      fittedBullMean: snapshot.estimates.means[2],
      dataKind: snapshot.dataProvenance.kind,
    },
    ...(attachment || storedRegimeSnapshot
      ? {
          calibrationSnapshot: snapshot as Extract<
            LessonCalibrationSnapshot,
            { readonly modelContract: "market-model/ordered-regimes@1" }
          >,
        }
      : {}),
  };
}

function runStudentTLesson(values: Values): LessonOutput {
  const sampleCount = Math.round(values.samples);
  const degrees = Math.round(values.degreesOfFreedom);
  const output = runStudentTInnovations({
    contract: STUDENT_T_INNOVATIONS_REQUEST_CONTRACT,
    degreesOfFreedom: degrees,
    seed: 715,
    samples: sampleCount,
    tailThreshold: 2.5,
  });
  const normal = output.result.normalInnovations;
  const student = output.result.standardizedStudentTInnovations;
  const diagnostics = output.result.diagnostics;
  const probabilities = Array.from({ length: 41 }, (_, index) => 0.01 + index * 0.0245);
  return {
    resultContract: output.result.contract,
    headline: "Standardization holds variance steady while tail frequency changes.",
    explanation: `The fixed sample produces ${percentage(diagnostics.studentTTailProbability)} observations beyond ±2.5σ under t(${degrees}), versus ${percentage(diagnostics.normalTailProbability)} under the normal comparison.`,
    metrics: [
      metric("Normal variance", fixed(diagnostics.normalVariance, 3), "Target variance = 1"),
      metric("Student-t variance", fixed(diagnostics.studentTVariance, 3), "Standardized target variance = 1"),
      metric("Normal extremes", percentage(diagnostics.normalTailProbability), "|innovation| > 2.5"),
      metric("Student-t extremes", percentage(diagnostics.studentTTailProbability), "|innovation| > 2.5", "caution"),
    ],
    series: [
      quantileSeries("Normal quantiles", normal, probabilities, "forest"),
      quantileSeries(`t(${degrees}) quantiles`, student, probabilities, "vermilion"),
    ],
    diagnostics: [
      `Degrees of freedom: ${degrees}`,
      `Variance scale: √((${degrees}−2)/${degrees})`,
      "Normal and Student-t draws share the same inverse-normal uniform numerator; only the t scale mixture is added.",
      "The innovation distribution is separate from the price process.",
    ],
    warnings: output.warnings.map((warning) => warning.message),
    provenance: [
      `Engine: ${output.provenance.engineVersion}`,
      `Request: ${output.provenance.inputContract}`,
      "Seed: 715",
      "Preset: illustrative",
    ],
    compactSummary: {
      degreesOfFreedom: degrees,
      normalVariance: diagnostics.normalVariance,
      studentTVariance: diagnostics.studentTVariance,
      studentExtremeProbability: diagnostics.studentTTailProbability,
    },
  };
}

function runCopulaLesson(values: Values): LessonOutput {
  const request = {
    contract: "market-model/copula@1" as const,
    correlation: [[1, values.correlation], [values.correlation, 1]],
    seed: 91,
    samples: Math.round(values.samples),
  };
  const gaussian = runCopula({ ...request, kind: "gaussian" });
  const student = runCopula({
    ...request,
    kind: "student-t",
    degreesOfFreedom: Math.round(values.degreesOfFreedom),
  });
  const gaussianLosses = gaussian.result.standardizedInnovations.map((row) =>
    Math.max(0, -(row[0] + row[1]) / 2),
  );
  const studentLosses = student.result.standardizedInnovations.map((row) =>
    Math.max(0, -(row[0] + row[1]) / 2),
  );
  const gaussianVar = quantile(gaussianLosses, 0.95);
  const studentVar = quantile(studentLosses, 0.95);
  const gaussianCvar = mean(gaussianLosses.filter((loss) => loss >= gaussianVar));
  const studentCvar = mean(studentLosses.filter((loss) => loss >= studentVar));
  const lossProbabilities = [0.5, 0.75, 0.9, 0.95, 0.975, 0.99, 0.995];
  return outputFromEnvelope(student, {
    headline: "The t copula puts more observations in the joint lower tail.",
    explanation: `Gaussian joint lower-tail frequency is ${percentage(gaussian.result.diagnostics.lowerTailCoMovement)}; the t-copula frequency is ${percentage(student.result.diagnostics.lowerTailCoMovement)} under the same correlation input.`,
    metrics: [
      metric("Target correlation", fixed(values.correlation, 2), "Latent two-asset input"),
      metric("Gaussian sample ρ", fixed(gaussian.result.diagnostics.empiricalCorrelation[0][1], 2), "Fixed-seed estimate"),
      metric("t-copula sample ρ", fixed(student.result.diagnostics.empiricalCorrelation[0][1], 2), "Fixed-seed estimate"),
      metric("t loss CVaR", fixed(studentCvar, 2), "Equal-weight positive standardized loss beyond 95% VaR", "caution"),
    ],
    series: [
      scatterSeries("Gaussian", gaussian.result.standardizedInnovations.slice(0, 500), "forest"),
      scatterSeries("Student-t", student.result.standardizedInnovations.slice(0, 500), "vermilion"),
    ],
    additionalCharts: [{
      title: "Copula-implied equal-weight loss quantiles",
      xLabel: "Cumulative probability",
      yLabel: "Standardized loss quantile",
      yUnit: "standard deviations",
      series: [
        quantileSeries("Gaussian loss", gaussianLosses, lossProbabilities, "forest"),
        quantileSeries("Student-t loss", studentLosses, lossProbabilities, "vermilion"),
      ],
    }],
    diagnostics: [
      "Correlation matrix passed Cholesky positive-semidefinite validation.",
      "Marginal transformations remain outside the dependence model.",
      `Student-t degrees of freedom: ${Math.round(values.degreesOfFreedom)}`,
      `95% standardized-loss CVaR: Gaussian ${fixed(gaussianCvar, 3)} · Student-t ${fixed(studentCvar, 3)}`,
    ],
    compactSummary: {
      targetCorrelation: values.correlation,
      gaussianTailCoMovement: gaussian.result.diagnostics.lowerTailCoMovement,
      studentTailCoMovement: student.result.diagnostics.lowerTailCoMovement,
      gaussianLossCvar95: gaussianCvar,
      studentLossCvar95: studentCvar,
    },
  });
}

function runCompositeLesson(values: Values): LessonOutput {
  const alpha = 0.08;
  const beta = Math.max(0, values.garchPersistence - alpha);
  const enabled = {
    regimes: Math.round(values.enableRegimes) === 1,
    dynamicVariance: Math.round(values.enableDynamicVariance) === 1,
    dependence: Math.round(values.enableDependence) === 1,
    jumps: Math.round(values.enableJumps) === 1,
  };
  const baseAssets = [
    { assetId: "stocks", annualDrift: 0.07, annualVolatility: 0.2 },
    { assetId: "bonds", annualDrift: 0.035, annualVolatility: 0.08 },
  ] as const;
  const compositeCase: PortfolioLabV2Case = {
    id: "composite",
    label: "Sanctioned composite",
    model: {
      contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.composite,
      kind: "composite",
      baseAssets,
      regimes: {
        labels: ["normal", "adverse"],
        initialProbabilities: [1, 0],
        transitionMatrix: [
          [values.persistence, 1 - values.persistence],
          [1 - values.persistence, values.persistence],
        ],
        annualDrifts: [[0.07, 0.035], [-0.14, 0.015]],
      },
      garch: [
        {
          omega: 0.04 * Math.max(0.001, 1 - values.garchPersistence),
          alpha,
          beta,
          initialVariance: 0.04,
        },
        {
          omega: 0.0064 * Math.max(0.001, 1 - values.garchPersistence),
          alpha: 0.04,
          beta: Math.max(0, values.garchPersistence - 0.04),
          initialVariance: 0.0064,
        },
      ],
      copula: {
        correlation: [[1, values.correlation], [values.correlation, 1]],
        innovation: { kind: "student-t", degreesOfFreedom: 6 },
      },
      jumps: [
        { annualIntensity: values.jumpIntensity, meanLogJump: -0.12, logJumpVolatility: 0.1 },
        { annualIntensity: values.jumpIntensity / 2, meanLogJump: -0.04, logJumpVolatility: 0.05 },
      ],
      enabled,
    },
  };
  const gbmCase: PortfolioLabV2Case = {
    id: "gbm",
    label: "Paired GBM baseline",
    model: {
      contract: PORTFOLIO_LAB_V2_MODEL_CONTRACT.gbm,
      kind: "gbm",
      assets: baseAssets,
      correlation: [[1, values.correlation], [values.correlation, 1]],
    },
  };
  const request: PortfolioLabV2Request = {
    contract: PORTFOLIO_LAB_V2_CONTRACT.request,
    plan: {
      initialCapital: 100_000,
      contributionPerStep: 500,
      withdrawalPerStep: 0,
      allocation: [
        { assetId: "stocks", targetWeight: 0.6 },
        { assetId: "bonds", targetWeight: 0.4 },
      ],
      rebalance: { kind: "periodic", everySteps: 12 },
      annualInflationRate: 0.02,
      targetValue: 200_000,
    },
    primaryCaseId: compositeCase.id,
    cases: [compositeCase, gbmCase],
    risk: { confidenceLevel: 0.95 },
    execution: {
      seed: 713,
      paths: 360,
      steps: 120,
      stepYears: 1 / 12,
      samplePaths: 6,
    },
  };
  const outcome = runPortfolioLabV2(request);
  if (!outcome.ok) throw new Error(outcome.problem.message);
  const baselineOutcome = runPortfolioLabV2({
    ...request,
    primaryCaseId: gbmCase.id,
    cases: [gbmCase],
  });
  if (!baselineOutcome.ok) throw new Error(baselineOutcome.problem.message);
  const { result } = outcome;
  const diagnostics = result.primary.diagnostics;
  if (diagnostics.kind !== "composite") {
    throw new Error("The composite lesson received non-composite diagnostics.");
  }
  const adverseOccupancy = diagnostics.regimeOccupancy[1] ?? 0;
  const firstPath = result.primary.samples[0];
  const baselinePath = baselineOutcome.result.primary.samples[0];
  return {
    resultContract: result.contract,
    headline: "The complete market pipeline now flows through portfolio accounting and risk.",
    explanation: `The composite portfolio spent ${percentage(adverseOccupancy)} of simulated states in the adverse regime. Its terminal-loss 95% VaR is ${money(result.primary.metrics.risk.valueAtRisk)}, compared with the requested GBM summary’s ${money(result.comparisons[0].metrics.risk.valueAtRisk)}.`,
    metrics: [
      metric("Composite 95% VaR", money(result.primary.metrics.risk.valueAtRisk), result.primary.metrics.risk.lossConvention, "caution"),
      metric("Composite 95% CVaR", money(result.primary.metrics.risk.conditionalValueAtRisk), `${result.primary.metrics.risk.tailObservationCount} tail observations`, "caution"),
      metric("Target probability", percentage(result.primary.metrics.goal.probabilityOfTarget), "Portfolio accounting after monthly cash flow and annual rebalance"),
      metric("Median max drawdown", percentage(result.primary.metrics.drawdown.medianMaximumDrawdown), "Cash-flow-neutral wealth index"),
    ],
    series: [
      pathSeries("Composite portfolio", firstPath.wealth, "vermilion"),
      pathSeries("Paired GBM portfolio", baselinePath.wealth, "forest"),
    ],
    additionalCharts: [
      {
        title: "Composite and GBM cash-flow-neutral drawdown",
        xLabel: "Simulation step",
        xUnit: "months",
        yLabel: "Drawdown",
        yUnit: "fraction from prior peak",
        series: [
          pathSeries("Composite drawdown", firstPath.drawdown, "vermilion"),
          pathSeries("GBM drawdown", baselinePath.drawdown, "forest"),
        ],
      },
      {
        title: "Composite stock conditional variance",
        xLabel: "Simulation step",
        xUnit: "months",
        yLabel: "Conditional variance",
        yUnit: "annual return²",
        series: [pathSeries("Stock conditional variance", diagnostics.sampledConditionalVariances[0][0], "vermilion")],
      },
      {
        title: "Composite regime path",
        xLabel: "Simulation step",
        xUnit: "months",
        yLabel: "Regime state",
        yUnit: "0 normal · 1 adverse",
        series: [pathSeries("Regime state", diagnostics.sampledRegimes[0], "ochre")],
      },
    ],
    diagnostics: [
      `Recorded update order: ${diagnostics.updateOrder}`,
      `Components enabled — regimes: ${String(enabled.regimes)}, variance: ${String(enabled.dynamicVariance)}, dependence: ${String(enabled.dependence)}, jumps: ${String(enabled.jumps)}`,
      `Retained jump markers: ${diagnostics.sampledJumpEvents.length}`,
      "HMM owns drift; GARCH owns variance; copula owns standardized dependence; jumps own discontinuities; the portfolio engine owns cash flows and rebalancing.",
      "GARCH and Heston are never active together.",
    ],
    warnings: result.warnings.map((warning) => warning.message),
    provenance: [
      `Engine: ${result.provenance.engineVersion}`,
      `Random streams: ${result.provenance.randomStreamVersion}`,
      `Event order: ${result.provenance.eventOrderVersion}`,
      `Requested cases: ${result.provenance.requestedCaseIds.join(", ")}`,
      `Seed: ${result.provenance.seed}`,
    ],
    compactSummary: {
      adverseRegimeOccupancy: adverseOccupancy,
      retainedJumpMarkers: diagnostics.sampledJumpEvents.length,
      updateOrder: diagnostics.updateOrder,
      valueAtRisk95: result.primary.metrics.risk.valueAtRisk,
      conditionalValueAtRisk95: result.primary.metrics.risk.conditionalValueAtRisk,
      targetProbability: result.primary.metrics.goal.probabilityOfTarget,
    },
  };
}

function runVarLesson(values: Values): LessonOutput {
  const confidence = values.confidence;
  const portfolioValue = values.portfolioValue;
  const returns = illustrativeLossReturns(400);
  const historical = calculateVarCvar({
    contract: "risk-lab/var-cvar@1",
    method: {
      kind: "historical",
      losses: {
        kind: "positive-loss",
        values: returns.map((value) => -value * portfolioValue),
      },
      provenance: {
        label: "Illustrative fixed-seed daily return sample",
        kind: "illustrative",
      },
    },
    confidenceLevel: confidence,
    holdingPeriods: Math.round(values.holdingPeriods),
    portfolioValue,
  });
  const parametric = calculateVarCvar({
    contract: "risk-lab/var-cvar@1",
    method: {
      kind: "parametric-normal",
      meanReturn: 0.0002,
      volatility: values.volatility,
    },
    confidenceLevel: confidence,
    holdingPeriods: Math.round(values.holdingPeriods),
    portfolioValue,
  });
  const monteCarlo = calculateVarCvar({
    contract: "risk-lab/var-cvar@1",
    method: {
      kind: "monte-carlo-normal",
      meanReturn: 0.0002,
      volatility: values.volatility,
      seed: 120,
      samples: 10_000,
    },
    confidenceLevel: confidence,
    holdingPeriods: Math.round(values.holdingPeriods),
    portfolioValue,
  });
  const methods = [historical.result, parametric.result, monteCarlo.result];
  return outputFromEnvelope(historical, {
    headline: "VaR marks the threshold; CVaR describes the losses beyond it.",
    explanation: `At ${percentage(confidence)} confidence, the historical threshold is ${money(historical.result.valueAtRisk)} and its tail average is ${money(historical.result.conditionalValueAtRisk)}.`,
    metrics: methods.map((result) =>
      metric(
        result.method.replaceAll("-", " "),
        money(result.valueAtRisk),
        `CVaR ${money(result.conditionalValueAtRisk)}`,
        result.method === "historical" ? "caution" : "neutral",
      ),
    ),
    series: [
      {
        name: "VaR",
        tone: "forest",
        style: "bars",
        points: methods.map((result, index) => ({ x: index, y: result.valueAtRisk, label: result.method })),
      },
      {
        name: "CVaR",
        tone: "vermilion",
        style: "bars",
        points: methods.map((result, index) => ({ x: index + 0.18, y: result.conditionalValueAtRisk, label: result.method })),
      },
    ],
    table: {
      caption: "Method comparison",
      columns: ["Method", "VaR", "CVaR", "Tail convention"],
      rows: methods.map((result) => [
        result.method,
        money(result.valueAtRisk),
        money(result.conditionalValueAtRisk),
        result.finiteSampleConvention,
      ]),
    },
    diagnostics: [
      `Loss convention: ${historical.result.lossConvention}`,
      `Historical tail observations: ${historical.result.tailObservationCount}`,
      "Expected Shortfall means standard loss-tail CVaR here—not portfolio tail capital shortfall.",
    ],
    compactSummary: {
      confidence,
      historicalVaR: historical.result.valueAtRisk,
      historicalCVaR: historical.result.conditionalValueAtRisk,
      parametricVaR: parametric.result.valueAtRisk,
    },
  });
}

function runBacktestingLesson(
  values: Values,
  attachment?: LessonDataAttachment,
): LessonOutput {
  const weightA = values.stockWeight;
  const weightB = 1 - weightA;
  const covariance = [
    [0.04, values.correlation * 0.2 * 0.1],
    [values.correlation * 0.2 * 0.1, 0.01],
  ];
  const attribution = calculateParametricRiskAttribution({
    contract: "risk-lab/parametric-attribution@1",
    weights: [weightA, weightB],
    covariance,
    portfolioValue: 100_000,
    confidenceLevel: 0.95,
  });
  const importedDataset = attachment
    ? parseImportedReturnDataset(attachment, {
        frequency: "monthly",
        returnConvention: "simple",
      })
    : null;
  const returns = importedDataset
    ? importedDataset.rows.map((row) => row[0])
    : illustrativeLossReturns(360);
  const timestamps = importedDataset?.timestamps ?? monthlyTimestamps(360, 1996);
  const dataProvenance = importedDataset?.provenance ?? {
    label: "Illustrative fixed-seed monthly backtest sample",
    kind: "illustrative" as const,
  };
  const backtest = backtestValueAtRisk({
    contract: "risk-lab/var-backtest@1",
    returns,
    estimationWindow: Math.round(values.window),
    confidenceLevel: 0.95,
    portfolioValue: 100_000,
    method: "historical",
    timestamps,
    provenance: dataProvenance,
  });
  const chartPoints = sampleEvenly(backtest.points, 800);
  return {
    resultContract: backtest.contract,
    headline: "A decomposition must add up; a backtest must look only backward.",
    explanation: `The two component contributions sum to ${money(attribution.contributionSum)}, matching portfolio VaR ${money(attribution.valueAtRisk)}. The rolling test recorded ${backtest.breaches} breaches versus ${fixed(backtest.expectedBreaches, 1)} expected.`,
    metrics: [
      metric("Asset A contribution", money(attribution.componentContributions[0]), `${percentage(weightA)} capital weight`),
      metric("Asset B contribution", money(attribution.componentContributions[1]), `${percentage(weightB)} capital weight`),
      metric("Breach rate", percentage(backtest.breachRate), `${backtest.breaches} of ${backtest.points.length} test observations`),
      metric("Kupiec LR", fixed(backtest.kupiecLikelihoodRatio, 2), "Coverage diagnostic; not proof of correctness"),
    ],
    series: [
      {
        name: "VaR threshold",
        tone: "forest",
        points: chartPoints.map((point) => ({ x: point.testIndex, y: point.valueAtRisk })),
      },
      {
        name: "Realized loss",
        tone: "vermilion",
        style: "points",
        points: chartPoints.map((point) => ({ x: point.testIndex, y: point.realizedLoss })),
      },
    ],
    diagnostics: [
      `First estimation window: ${backtest.points[0].estimationStartIndex}–${backtest.points[0].estimationEndIndex}; first test: ${backtest.points[0].testIndex}`,
      `First test date: ${backtest.points[0].testTimestamp} · source: ${backtest.dataProvenance?.label}`,
      `Contribution sum error: ${fixed(attribution.contributionSum - attribution.valueAtRisk, 8)}`,
      "Every estimation end index is strictly earlier than its test index.",
      `Chart detail: ${chartPoints.length} of ${backtest.points.length} test observations retained.`,
    ],
    warnings: [...backtest.warnings],
    provenance: [
      "Risk engine: risk-lab@1",
      `Dataset: ${dataProvenance.label} (${dataProvenance.kind})`,
      ...(attachment ? [`User dataset: ${attachment.filename}`] : []),
      "Confidence: 95%",
    ],
    compactSummary: {
      contributionSum: attribution.contributionSum,
      valueAtRisk: attribution.valueAtRisk,
      breachRate: backtest.breachRate,
      kupiecLikelihoodRatio: backtest.kupiecLikelihoodRatio,
      dataKind: dataProvenance.kind,
    },
  };
}

function runMeanVarianceLesson(values: Values): LessonOutput {
  const covariance = twoAssetCovariance(0.2, 0.1, values.correlation);
  const envelope = runMeanVariance({
    contract: MEAN_VARIANCE_REQUEST_CONTRACT,
    assetIds: ["Asset A", "Asset B"],
    expectedReturnsPerPeriod: [values.returnA, values.returnB],
    covariancePerPeriod: covariance,
    riskFreeRatePerPeriod: values.riskFree,
    frontierPointCount: 21,
  });
  const { result } = envelope;
  return outputFromEnvelope(envelope, {
    headline: "The efficient frontier makes the return–risk trade-off visible.",
    explanation: `The minimum-variance allocation holds ${percentage(result.minimumVariance.weights[0])} in Asset A; the maximum-Sharpe allocation holds ${percentage(result.maximumSharpe.weights[0])}.`,
    metrics: [
      metric("Min-var A weight", percentage(result.minimumVariance.weights[0]), "Long-only, fully invested"),
      metric("Min-var volatility", percentage(result.minimumVariance.volatilityPerPeriod), "Annual input convention"),
      metric("Max-Sharpe A weight", percentage(result.maximumSharpe.weights[0]), "Selected reproducibly"),
      metric("Maximum Sharpe", fixed(result.maximumSharpe.sharpeRatio ?? 0, 2), "Expected excess return / volatility"),
    ],
    series: [
      {
        name: "Efficient frontier",
        tone: "forest",
        points: result.efficientFrontier.map((point) => ({
          x: point.allocation.volatilityPerPeriod,
          y: point.allocation.expectedReturnPerPeriod,
        })),
      },
    ],
    table: allocationTable([
      ["Minimum variance", result.minimumVariance],
      ["Maximum Sharpe", result.maximumSharpe],
    ]),
    diagnostics: [
      `Min-var converged: ${String(result.diagnostics.minimumVariance.converged)} in ${result.diagnostics.minimumVariance.iterations} iterations`,
      `Max-Sharpe converged: ${String(result.diagnostics.maximumSharpe.converged)} in ${result.diagnostics.maximumSharpe.iterations} iterations`,
      `Constraint error: ${fixed(Math.abs(result.maximumSharpe.weights.reduce((sum, weight) => sum + weight, 0) - 1), 10)}`,
    ],
    compactSummary: {
      minimumVarianceWeights: result.minimumVariance.weights.join(","),
      maximumSharpeWeights: result.maximumSharpe.weights.join(","),
      maximumSharpeWeightA: result.maximumSharpe.weights[0],
      maximumSharpe: result.maximumSharpe.sharpeRatio ?? 0,
    },
  });
}

function runCapmLesson(values: Values): LessonOutput {
  const market = Array.from({ length: 48 }, (_, index) =>
    0.006 + 0.025 * Math.sin(index * 0.83) + 0.012 * Math.cos(index * 0.31),
  );
  const alpha = 0.0015;
  const asset = market.map(
    (marketReturn, index) =>
      values.riskFree +
      alpha +
      values.beta * (marketReturn - values.riskFree) +
      0.002 * Math.sin(index * 2.1),
  );
  const envelope = runCapm({
    contract: CAPM_REQUEST_CONTRACT,
    assetIds: ["Lesson asset"],
    assetReturnsPerPeriod: asset.map((value) => [value]),
    marketReturnsPerPeriod: market,
    riskFreeRatePerPeriod: values.riskFree,
    portfolioWeights: [1],
  });
  const estimate = envelope.result.assets[0];
  const sml = Array.from({ length: 21 }, (_, index) => {
    const beta = index / 10;
    return {
      x: beta,
      y: values.riskFree + beta * values.marketPremium,
    };
  });
  return outputFromEnvelope(envelope, {
    headline: "Beta is a fitted slope; alpha is what the market factor leaves behind.",
    explanation: `The regression recovered β=${fixed(estimate.beta, 3)} and α=${percentage(estimate.alphaPerPeriod)} per observation from the synthetic fixture.`,
    metrics: [
      metric("Estimated beta", fixed(estimate.beta, 3), `Input fixture β = ${fixed(values.beta, 2)}`),
      metric("Estimated alpha", percentage(estimate.alphaPerPeriod), "Per observation"),
      metric("R²", percentage(estimate.rSquared), "In-sample explained variance"),
      metric("SML expected return", percentage(values.riskFree + estimate.beta * values.marketPremium), "Using the selected market premium"),
    ],
    series: [{ name: "Security Market Line", tone: "forest", points: sml }],
    diagnostics: [
      `Observation count: ${envelope.result.observationCount}`,
      `Return convention: ${envelope.result.returnConvention}`,
      `Residual volatility: ${percentage(estimate.residualVolatilityPerPeriod)}`,
    ],
    compactSummary: {
      estimatedBeta: estimate.beta,
      estimatedAlpha: estimate.alphaPerPeriod,
      rSquared: estimate.rSquared,
    },
  });
}

function runFactorLesson(
  values: Values,
  attachment?: LessonDataAttachment,
): LessonOutput {
  const timestamps = Array.from({ length: 72 }, (_, index) => {
    const date = new Date(Date.UTC(2015, index, 1));
    return date.toISOString().slice(0, 10);
  });
  const factorRows = timestamps.map((_, index) => [
    0.004 + 0.02 * Math.sin(index * 0.61),
    0.001 + 0.012 * Math.cos(index * 0.47),
  ]);
  const assetRows = factorRows.map((row, index) => [
    0.001 + values.marketLoading * row[0] + values.styleLoading * row[1] + 0.001 * Math.sin(index * 1.9),
  ]);
  const imported = attachment ? parseImportedFactorDataset(attachment) : null;
  if (imported && imported.factorReturns.assetIds.length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "The factor lesson needs at least two factor: columns for its paired exposure comparison.",
    );
  }
  const assetReturns = imported?.assetReturns ?? {
    contract: "return-dataset@1" as const,
    assetIds: ["Lesson asset"],
    timestamps,
    frequency: "monthly" as const,
    returnConvention: "simple" as const,
    rows: assetRows,
    missingValuePolicy: "reject" as const,
    alignmentPolicy: "intersection" as const,
    provenance: {
      label: "Bundled classroom asset returns",
      kind: "illustrative" as const,
    },
  };
  const factorReturns = imported?.factorReturns ?? {
    contract: "return-dataset@1" as const,
    assetIds: ["Factor A", "Factor B"],
    timestamps: [
      ...timestamps,
      new Date(Date.UTC(2021, 0, 1)).toISOString().slice(0, 10),
      new Date(Date.UTC(2021, 1, 1)).toISOString().slice(0, 10),
    ],
    frequency: "monthly" as const,
    returnConvention: "simple" as const,
    rows: [
      ...factorRows,
      [0.006, -0.002],
      [-0.004, 0.005],
    ],
    missingValuePolicy: "reject" as const,
    alignmentPolicy: "intersection" as const,
    provenance: {
      label: "Bundled classroom factor returns",
      kind: "illustrative" as const,
    },
  };
  const selectedAssetId = assetReturns.assetIds[0];
  const selectedFactorIds = factorReturns.assetIds.slice(0, 2);
  const aligned = alignFactorDatasets({
    contract: FACTOR_DATASET_ALIGNMENT_REQUEST_CONTRACT,
    assetReturns,
    factorReturns,
    assetIds: [selectedAssetId],
    factorIds: selectedFactorIds,
  });
  const factorAName = aligned.factorIds[0];
  const factorBName = aligned.factorIds[1];
  const staticEnvelope = runFactorModel({
    contract: FACTOR_MODEL_REQUEST_CONTRACT,
    assetIds: aligned.assetIds,
    factorIds: aligned.factorIds,
    assetReturnsPerPeriod: aligned.assetReturnsPerPeriod,
    factorReturnsPerPeriod: aligned.factorReturnsPerPeriod,
    portfolioWeights: [1],
    scenario: { label: `${factorBName} lesson shock`, factorShocksPerPeriod: [0, values.scenarioShock] },
  });
  const rollingEnvelope = runRollingFactorAnalysis({
    contract: ROLLING_FACTOR_REQUEST_CONTRACT,
    dataset: aligned,
    estimationWindowObservations: Math.round(values.rollingWindow),
    testWindowObservations: 1,
    stepObservations: 1,
    portfolioWeights: [1],
    scenario: {
      label: `${factorBName} lesson shock`,
      factorShocksPerPeriod: [0, values.scenarioShock],
    },
  });
  const staticAsset = staticEnvelope.result.assets[0];
  const windows = rollingEnvelope.result.windows;
  const latestWindow = windows.at(-1)!;
  const latestAsset = latestWindow.assets[0];
  const output = outputFromEnvelope(rollingEnvelope, {
    headline: "Aligned timestamps make rolling factor exposures honest about time.",
    explanation: `The full-sample ${factorBName} exposure is ${fixed(staticAsset.exposures[1], 3)}; the latest ${Math.round(values.rollingWindow)}-month estimate is ${fixed(latestAsset.exposures[1], 3)}. Every test month comes strictly after its estimation window.`,
    metrics: [
      metric(`Latest ${factorAName}`, fixed(latestAsset.exposures[0], 3), `Full sample ${fixed(staticAsset.exposures[0], 3)}`),
      metric(`Latest ${factorBName}`, fixed(latestAsset.exposures[1], 3), `Full sample ${fixed(staticAsset.exposures[1], 3)}`),
      metric("Latest estimation R²", percentage(latestAsset.estimationRSquared), `${Math.round(values.rollingWindow)} prior monthly observations`),
      metric("Latest scenario change", percentage(latestAsset.scenarioReturnChangePerPeriod ?? 0), rollingEnvelope.result.scenarioLabel ?? "No scenario"),
    ],
    series: [
      {
        name: `Rolling ${factorAName} exposure`,
        tone: "forest",
        points: windows.map((window) => ({
          x: window.test.startIndex,
          y: window.assets[0].exposures[0],
          label: window.test.startTimestamp,
        })),
      },
      {
        name: `Rolling ${factorBName} exposure`,
        tone: "vermilion",
        points: windows.map((window) => ({
          x: window.test.startIndex,
          y: window.assets[0].exposures[1],
          label: window.test.startTimestamp,
        })),
      },
    ],
    table: {
      caption: "Latest out-of-sample return attributions",
      columns: ["Test month", `β ${factorAName}`, `β ${factorBName}`, "Realized", "Modeled", "Residual"],
      rows: windows.slice(-8).map((window) => {
        const estimate = window.assets[0];
        return [
          window.test.startTimestamp,
          fixed(estimate.exposures[0], 3),
          fixed(estimate.exposures[1], 3),
          percentage(estimate.returnAttribution.realizedMeanReturnPerPeriod),
          percentage(estimate.returnAttribution.modeledMeanReturnPerPeriod),
          percentage(estimate.returnAttribution.residualContributionPerPeriod),
        ];
      }),
    },
    diagnostics: [
      `Alignment policy: ${aligned.alignment.policy} · ${aligned.timestamps.length} shared timestamps`,
      `Dropped observations: asset ${aligned.alignment.droppedAssetObservationCount}, factor ${aligned.alignment.droppedFactorObservationCount}`,
      `Look-ahead guard: ${rollingEnvelope.result.lookAheadGuard}`,
      `Asset source: ${aligned.provenance.assetSource.label} · Factor source: ${aligned.provenance.factorSource.label}`,
      `Static fit warnings: ${staticEnvelope.warnings.length}`,
    ],
    compactSummary: {
      alignedObservationCount: aligned.timestamps.length,
      rollingWindowCount: windows.length,
      estimationWindow: Math.round(values.rollingWindow),
      latestFactorAExposure: latestAsset.exposures[0],
      latestFactorBExposure: latestAsset.exposures[1],
      latestResidualContribution:
        latestAsset.returnAttribution.residualContributionPerPeriod,
      dataKind: aligned.provenance.assetSource.kind,
    },
  });
  return attachment
    ? { ...output, provenance: [...output.provenance, `User dataset: ${attachment.filename}`] }
    : output;
}

function runRiskParityLesson(values: Values): LessonOutput {
  const covariance = twoAssetCovariance(
    values.volatilityA,
    values.volatilityB,
    values.correlation,
  );
  const envelope = runRiskParity({
    contract: RISK_PARITY_REQUEST_CONTRACT,
    assetIds: ["Asset A", "Asset B"],
    expectedReturnsPerPeriod: [0.07, 0.035],
    covariancePerPeriod: covariance,
  });
  const allocation = envelope.result.allocation;
  return outputFromEnvelope(envelope, {
    headline: "Equal risk usually requires unequal capital.",
    explanation: `Asset A receives ${percentage(allocation.weights[0])} of capital but contributes ${percentage(allocation.normalizedRiskContributions[0])} of modeled volatility.`,
    metrics: [
      metric("Asset A capital", percentage(allocation.weights[0]), `Volatility ${percentage(values.volatilityA)}`),
      metric("Asset B capital", percentage(allocation.weights[1]), `Volatility ${percentage(values.volatilityB)}`),
      metric("Asset A risk", percentage(envelope.result.achievedRiskBudgets[0]), "Target 50%"),
      metric("Asset B risk", percentage(envelope.result.achievedRiskBudgets[1]), "Target 50%"),
    ],
    series: [
      {
        name: "Capital weights",
        tone: "forest",
        style: "bars",
        points: allocation.weights.map((value, index) => ({ x: index, y: value, label: allocation.assetIds[index] })),
      },
      {
        name: "Risk contributions",
        tone: "ochre",
        style: "bars",
        points: envelope.result.achievedRiskBudgets.map((value, index) => ({ x: index + 0.18, y: value, label: allocation.assetIds[index] })),
      },
    ],
    diagnostics: [
      `Converged: ${String(envelope.result.diagnostics.converged)}`,
      `Maximum risk-budget error: ${fixed(envelope.result.diagnostics.maximumError, 8)}`,
      `Volatility contribution sum: ${percentage(allocation.volatilityContributions.reduce((sum, value) => sum + value, 0))} vs total ${percentage(allocation.volatilityPerPeriod)}`,
    ],
    compactSummary: {
      assetAWeight: allocation.weights[0],
      assetARiskBudget: envelope.result.achievedRiskBudgets[0],
      portfolioVolatility: allocation.volatilityPerPeriod,
    },
  });
}

function runKellyLesson(values: Values): LessonOutput {
  const envelope = runKelly({
    contract: KELLY_REQUEST_CONTRACT,
    assetIds: ["Asset A", "Asset B"],
    expectedExcessReturnsPerPeriod: [values.edgeA, values.edgeB],
    covariancePerPeriod: [[0.04, 0.004], [0.004, 0.01]],
    kellyFraction: values.fraction,
    maxTotalAllocation: values.leverageCap,
    maxAssetAllocations: [0.9, 0.9],
    ruinFloorWealthFraction: 0.25,
    drawdownThresholdFraction: 0.3,
    drawdownHorizonPeriods: 10,
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "Fractional Kelly trades modeled growth for a smaller risk budget.",
    explanation: `The requested ${percentage(values.fraction)} Kelly solution allocates ${percentage(result.requested.totalAllocation)} to risky assets and leaves ${percentage(result.requested.cashWeight)} in cash.`,
    metrics: [
      metric("Risky allocation", percentage(result.requested.totalAllocation), `Cap ${percentage(values.leverageCap)}`),
      metric("Approx. log growth", percentage(result.requested.approximateLogGrowthPerPeriod), "Per modeled period"),
      metric("Loss probability", percentage(result.requested.normalLossProbabilityPerPeriod), "Normal approximation"),
      metric("Ruin approximation", percentage(result.requested.approximateInfiniteHorizonRuinProbability), "Threshold at 25% of starting wealth", "caution"),
    ],
    series: [
      {
        name: "Approximate log growth",
        tone: "forest",
        points: result.fullHalfQuarter.map((allocation) => ({ x: allocation.kellyFraction, y: allocation.approximateLogGrowthPerPeriod })),
      },
      {
        name: "Drawdown probability",
        tone: "vermilion",
        points: result.fullHalfQuarter.map((allocation) => ({ x: allocation.kellyFraction, y: allocation.approximateInitialCapitalDrawdownProbability })),
      },
    ],
    table: {
      caption: "Full, half, and quarter Kelly comparison",
      columns: ["Fraction", "Risky allocation", "Log growth", "Drawdown probability"],
      rows: result.fullHalfQuarter.map((allocation) => [
        percentage(allocation.kellyFraction),
        percentage(allocation.totalAllocation),
        percentage(allocation.approximateLogGrowthPerPeriod),
        percentage(allocation.approximateInitialCapitalDrawdownProbability),
      ]),
    },
    diagnostics: [
      `Requested solution converged: ${String(result.requested.diagnostics.converged)}`,
      `Per-asset caps: ${result.requested.allocations.map(percentage).join(" · ")}`,
      `Approximation: ${result.approximation}`,
    ],
    compactSummary: {
      requestedKellyFraction: values.fraction,
      totalRiskyAllocation: result.requested.totalAllocation,
      approximateLogGrowth: result.requested.approximateLogGrowthPerPeriod,
      approximateRuinProbability: result.requested.approximateInfiniteHorizonRuinProbability,
    },
  });
}

function runBlackLittermanLesson(values: Values): LessonOutput {
  const envelope = runBlackLitterman({
    contract: BLACK_LITTERMAN_REQUEST_CONTRACT,
    assetIds: ["Asset A", "Asset B"],
    covariancePerPeriod: [[0.04, 0.004], [0.004, 0.015]],
    marketWeights: [0.65, 0.35],
    riskAversion: 2.5,
    tau: values.tau,
    views: [{
      id: "A-over-B",
      kind: "relative",
      outperformingAssetId: "Asset A",
      underperformingAssetId: "Asset B",
      expectedOutperformancePerPeriod: values.viewReturn,
      confidence: values.confidence,
    }],
    riskFreeRatePerPeriod: 0.02,
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "The posterior shows exactly how a view moves the prior.",
    explanation: `The requested A-minus-B view is ${percentage(values.viewReturn)}. The posterior spread is ${percentage(result.posteriorReturnsPerPeriod[0] - result.posteriorReturnsPerPeriod[1])}.`,
    metrics: [
      metric("Prior A return", percentage(result.equilibriumReturnsPerPeriod[0]), "Market-implied"),
      metric("Posterior A return", percentage(result.posteriorReturnsPerPeriod[0]), "After the view"),
      metric("Prior A weight", percentage(result.priorOptimalAllocation.weights[0]), "Shared mean–variance optimizer"),
      metric("Posterior A weight", percentage(result.posteriorOptimalAllocation.weights[0]), "Shared mean–variance optimizer"),
    ],
    series: [
      {
        name: "Prior returns",
        tone: "ink",
        style: "bars",
        points: result.equilibriumReturnsPerPeriod.map((value, index) => ({ x: index, y: value, label: ["Asset A", "Asset B"][index] })),
      },
      {
        name: "Posterior returns",
        tone: "forest",
        style: "bars",
        points: result.posteriorReturnsPerPeriod.map((value, index) => ({ x: index + 0.18, y: value, label: ["Asset A", "Asset B"][index] })),
      },
    ],
    diagnostics: [
      `View innovation: ${percentage(result.views[0].innovationPerPeriod)}`,
      `Confidence: ${percentage(result.views[0].confidence)}`,
      "Prior and posterior allocations reuse the validated long-only mean–variance solver.",
    ],
    compactSummary: {
      priorAssetAReturn: result.equilibriumReturnsPerPeriod[0],
      posteriorAssetAReturn: result.posteriorReturnsPerPeriod[0],
      priorAssetAWeight: result.priorOptimalAllocation.weights[0],
      posteriorAssetAWeight: result.posteriorOptimalAllocation.weights[0],
    },
  });
}

function runBlackScholesLesson(values: Values): LessonOutput {
  const surfaceDimension = (["spot", "volatility", "time"] as const)[
    Math.max(0, Math.min(2, Math.round(values.surfaceDimension)))
  ];
  const common = {
    spot: values.spot,
    strike: values.strike,
    timeToMaturityYears: values.maturity,
    riskFreeRate: values.rate,
    volatility: values.volatility,
    dividendYield: values.dividendYield,
  };
  const comparison = compareEuropeanPricingMethods({
    contract: EUROPEAN_PRICING_COMPARISON_REQUEST_CONTRACT,
    optionType: "call",
    ...common,
    tree: {
      steps: Math.round(values.comparisonSteps),
      nodeData: { include: false },
    },
    monteCarlo: {
      seed: 731,
      paths: even(Math.round(values.comparisonPaths)),
      steps: 52,
      antithetic: true,
      controlVariate: true,
      samplePathCount: 0,
    },
  });
  const call = comparison.result.blackScholes;
  const put = priceBlackScholes({ contract: BLACK_SCHOLES_REQUEST_CONTRACT, optionType: "put", ...common });
  const parityDifference =
    call.price -
    put.result.price -
    (values.spot * Math.exp(-values.dividendYield * values.maturity) -
      values.strike * Math.exp(-values.rate * values.maturity));
  const spots = surfaceDimension === "spot"
    ? Array.from({ length: 61 }, (_, index) => values.spot * (0.5 + index / 60))
    : [values.spot];
  const maximumVolatility = Math.min(1.5, Math.max(0.4, values.volatility * 2));
  const volatilities = surfaceDimension === "volatility"
    ? Array.from({ length: 61 }, (_, index) => 0.01 + index * (maximumVolatility - 0.01) / 60)
    : [values.volatility];
  const maximumMaturity = Math.min(5, Math.max(2, values.maturity * 2));
  const timesToMaturityYears = surfaceDimension === "time"
    ? Array.from({ length: 61 }, (_, index) => 0.02 + index * (maximumMaturity - 0.02) / 60)
    : [values.maturity];
  const surface = buildBlackScholesSurface({
    contract: BLACK_SCHOLES_SURFACE_REQUEST_CONTRACT,
    optionType: "call",
    strike: values.strike,
    riskFreeRate: values.rate,
    dividendYield: values.dividendYield,
    axes: { spots, volatilities, timesToMaturityYears },
  });
  const surfaceLabel = surfaceDimension === "spot"
    ? "Underlying spot"
    : surfaceDimension === "volatility"
      ? "Annual volatility"
      : "Time to expiry";
  const surfaceUnit = surfaceDimension === "spot"
    ? "currency"
    : surfaceDimension === "volatility"
      ? "fraction"
      : "years";
  return outputFromEnvelope(comparison, {
    headline: "One option contract can be checked three different ways.",
    explanation: `Black–Scholes gives ${money(call.price)}, CRR gives ${money(comparison.result.crr.price)}, and Monte Carlo gives ${money(comparison.result.monteCarlo.estimate.price)}. Every method receives the same S, K, T, r, q, and σ.`,
    metrics: [
      metric("Black–Scholes", money(call.price), `Intrinsic ${money(call.intrinsicValue)}`),
      metric("CRR tree", money(comparison.result.crr.price), `${Math.round(values.comparisonSteps)} European steps`),
      metric("Monte Carlo", money(comparison.result.monteCarlo.estimate.price), `${even(Math.round(values.comparisonPaths)).toLocaleString()} paths`),
      metric("Put value", money(put.result.price), `Intrinsic ${money(put.result.intrinsicValue)}`),
      metric("Call delta", fixed(call.greeks.delta, 3), "Value change per one-unit spot move"),
      metric("Dividend yield", percentage(values.dividendYield), "Continuous annual yield q"),
      metric("95% MC interval", `${money(comparison.result.monteCarlo.estimate.confidenceInterval.lower)}–${money(comparison.result.monteCarlo.estimate.confidenceInterval.upper)}`, "Sampling error, not model error"),
    ],
    chartAxes: {
      xLabel: surfaceLabel,
      xUnit: surfaceUnit,
      yLabel: "Call model value",
      yUnit: "currency",
    },
    series: [
      {
        name: `Call value across ${surfaceDimension}`,
        tone: "forest",
        points: surface.result.cells.map((cell) => ({
          x: surfaceDimension === "spot"
            ? cell.spot
            : surfaceDimension === "volatility"
              ? cell.volatility
              : cell.timeToMaturityYears,
          y: cell.price,
        })),
      },
      ...(surfaceDimension === "spot"
        ? [{
            name: "Call expiry payoff",
            tone: "vermilion" as const,
            points: spots.map((spot) => ({ x: spot, y: optionPayoff("call", spot, values.strike) })),
          }]
        : []),
    ],
    table: {
      caption: "Same European call, three pricing methods",
      columns: ["Method", "Price", "Difference from Black–Scholes", "Uncertainty / discretization"],
      rows: [
        ["Black–Scholes", money(call.price), money(0), "Analytical benchmark"],
        ["CRR", money(comparison.result.crr.price), money(comparison.result.agreement.crrMinusBlackScholes), `${Math.round(values.comparisonSteps)} time steps`],
        ["Monte Carlo", money(comparison.result.monteCarlo.estimate.price), money(comparison.result.agreement.monteCarloMinusBlackScholes), `SE ${money(comparison.result.monteCarlo.estimate.standardError)}`],
      ],
    },
    diagnostics: [
      `Put–call parity error: ${fixed(parityDifference, 12)}`,
      `No-arbitrage bounds: ${money(call.noArbitrageBounds.lower)} to ${money(call.noArbitrageBounds.upper)}`,
      `Black–Scholes inside MC interval: ${String(comparison.result.agreement.blackScholesInsideMonteCarlo95PercentInterval)}`,
      `d₁=${fixed(call.d1 ?? 0, 3)} · d₂=${fixed(call.d2 ?? 0, 3)}`,
      `Surface slice: ${surfaceDimension} · ${surface.result.cells.length} bounded cells`,
    ],
    compactSummary: {
      callPrice: call.price,
      putPrice: put.result.price,
      crrPrice: comparison.result.crr.price,
      monteCarloPrice: comparison.result.monteCarlo.estimate.price,
      callDelta: call.greeks.delta,
      parityError: parityDifference,
      dividendYield: values.dividendYield,
      surfaceDimension,
    },
  });
}

function runBinomialLesson(values: Values): LessonOutput {
  const steps = Math.round(values.steps);
  const totalNodes = ((steps + 1) * (steps + 2)) / 2;
  const common = {
    contract: BINOMIAL_TREE_REQUEST_CONTRACT,
    optionType: "put" as const,
    spot: values.spot,
    strike: values.strike,
    timeToMaturityYears: 1,
    riskFreeRate: 0.04,
    volatility: values.volatility,
    dividendYield: 0,
    steps,
    nodeData: { include: totalNodes <= 10_000, maxNodes: 10_000 },
  };
  const european = priceBinomialTree({ ...common, exerciseStyle: "european" });
  const american = priceBinomialTree({ ...common, exerciseStyle: "american" });
  const selected = values.american >= 0.5 ? american : european;
  const exercised = american.result.earlyExerciseBoundary.filter(
    (boundary) => boundary.exercisedNodeCount > 0,
  );
  const visibleNodes = selected.result.nodes.filter((node) => node.step <= 4);
  return outputFromEnvelope(selected, {
    headline: "Backward induction separates continuation from exercise.",
    explanation: `The European put is ${money(european.result.price)}; the American put is ${money(american.result.price)}, an early-exercise premium of ${money(american.result.price - european.result.price)}.`,
    metrics: [
      metric("European put", money(european.result.price), `${steps} CRR steps`),
      metric("American put", money(american.result.price), "Maximum of continuation and intrinsic"),
      metric("Exercise premium", money(american.result.price - european.result.price), "American minus European"),
      metric("Exercise layers", String(exercised.length), "Layers with at least one early-exercise node"),
      metric("Stored nodes", selected.result.nodeDataBounds.storedNodeCount.toLocaleString(), `${selected.result.nodeDataBounds.totalNodeCount.toLocaleString()} total nodes`),
    ],
    series: [
      {
        name: "Minimum exercise spot",
        tone: "vermilion",
        style: "step",
        points: exercised.map((boundary) => ({ x: boundary.timeYears, y: boundary.minimumExercisedSpot ?? 0 })),
      },
      {
        name: "Maximum exercise spot",
        tone: "ochre",
        style: "step",
        points: exercised.map((boundary) => ({ x: boundary.timeYears, y: boundary.maximumExercisedSpot ?? 0 })),
      },
    ],
    ...(visibleNodes.length === 0
      ? {}
      : {
          table: {
            caption: "First five tree layers (value is computed backward)",
            columns: ["Step", "Up moves", "Spot", "Intrinsic", "Continuation", "Option value", "Exercise?"],
            rows: visibleNodes.map((node) => [
              String(node.step),
              String(node.upMoves),
              money(node.spot),
              money(node.intrinsicValue),
              node.continuationValue === null ? "maturity" : money(node.continuationValue),
              money(node.optionValue),
              node.earlyExercise ? "yes" : "no",
            ]),
          },
        }),
    diagnostics: [
      `Risk-neutral up probability: ${fixed(selected.result.parameters.riskNeutralUpProbability, 4)}`,
      `Up/down factors: ${fixed(selected.result.parameters.upFactor, 4)} / ${fixed(selected.result.parameters.downFactor, 4)}`,
      `American ≥ European: ${String(american.result.price >= european.result.price)}`,
      selected.result.nodeDataOmitted
        ? `Node table omitted: ${selected.result.nodeDataBounds.totalNodeCount.toLocaleString()} nodes exceed the 10,000-node teaching bound.`
        : `Node table bounded: retained ${selected.result.nodeDataBounds.storedNodeCount.toLocaleString()} of ${selected.result.nodeDataBounds.totalNodeCount.toLocaleString()} nodes.`,
    ],
    compactSummary: {
      europeanPrice: european.result.price,
      americanPrice: american.result.price,
      earlyExercisePremium: american.result.price - european.result.price,
      exerciseLayers: exercised.length,
      totalNodeCount: selected.result.nodeDataBounds.totalNodeCount,
      storedNodeCount: selected.result.nodeDataBounds.storedNodeCount,
    },
  });
}

function runMonteCarloOptionLesson(values: Values): LessonOutput {
  const payoffIndex = Math.round(values.payoff);
  const execution = {
    seed: 314,
    paths: even(Math.round(values.paths)),
    steps: 52,
    antithetic: true,
    controlVariate: true,
    samplePathCount: 6,
  } as const;
  const request: MonteCarloOptionRequest =
    payoffIndex === 4
      ? {
          contract: MONTE_CARLO_REQUEST_CONTRACT,
          market: {
            kind: "basket",
            assets: [
              { label: "Asset A", spot: values.spot, volatility: values.volatility, dividendYield: 0.01 },
              { label: "Asset B", spot: values.spot * 0.8, volatility: values.volatility * 0.75, dividendYield: 0.015 },
            ],
            correlation: [
              [1, values.basketCorrelation],
              [values.basketCorrelation, 1],
            ],
          },
          instrument: {
            kind: "basket",
            optionType: "call",
            strike: values.strike,
            weights: [0.6, 0.4],
          },
          timeToMaturityYears: 1,
          riskFreeRate: 0.04,
          execution,
        }
      : {
          contract: MONTE_CARLO_REQUEST_CONTRACT,
          market: {
            kind: "single",
            spot: values.spot,
            volatility: values.volatility,
            dividendYield: 0.01,
          },
          instrument: monteCarloPayoff(payoffIndex, values.strike, values.spot),
          timeToMaturityYears: 1,
          riskFreeRate: 0.04,
          execution,
        };
  const envelope = priceMonteCarloOption(request);
  const { result } = envelope;
  const series: LessonSeries[] =
    request.market.kind === "basket"
      ? result.samplePaths[0].pricesByAsset.map((prices, assetIndex) => ({
          name: `Basket asset ${assetIndex + 1}`,
          tone: (["forest", "vermilion"] as const)[assetIndex],
          points: result.samplePaths[0].times.map((time, pointIndex) => ({
            x: time,
            y: prices[pointIndex],
          })),
        }))
      : result.samplePaths.slice(0, 4).map((path, index) => ({
          name: `Path ${index + 1}`,
          tone: (["forest", "vermilion", "ochre", "ink"] as const)[index],
          points: path.times.map((time, pointIndex) => ({
            x: time,
            y: path.pricesByAsset[0][pointIndex],
          })),
        }));
  return outputFromEnvelope(envelope, {
    headline: "A stochastic price is incomplete without its sampling interval.",
    explanation: `${monteCarloPayoffLabel(payoffIndex)} pricing gives ${money(result.estimate.price)} with a 95% interval from ${money(result.estimate.confidenceInterval.lower)} to ${money(result.estimate.confidenceInterval.upper)}. Path dependence changes the payoff calculation, not the sampling-error rule.`,
    metrics: [
      metric("Estimated price", money(result.estimate.price), `${result.simulatedPaths.toLocaleString()} trajectories`),
      metric("Standard error", money(result.estimate.standardError), "Sampling uncertainty only"),
      metric("95% interval", `${money(result.estimate.confidenceInterval.lower)}–${money(result.estimate.confidenceInterval.upper)}`, "Not model uncertainty"),
      metric("SE / raw SE", fixed(result.varianceReduction.standardErrorRatioToRaw, 2), "Effect of variance reduction"),
    ],
    series,
    diagnostics: [
      `Instrument: ${monteCarloPayoffLabel(payoffIndex)} (${result.instrumentKind})`,
      `Independent observations: ${result.independentSamples}`,
      `Antithetic: ${String(result.varianceReduction.antithetic)} · control variate: ${String(result.varianceReduction.controlVariate)}`,
      request.market.kind === "basket"
        ? `Basket correlation: ${fixed(values.basketCorrelation, 2)} · weights: 60% / 40%`
        : "The stored paths show the monitoring grid used by the payoff.",
    ],
    compactSummary: {
      instrumentKind: result.instrumentKind,
      payoffFamily: monteCarloPayoffLabel(payoffIndex),
      estimate: result.estimate.price,
      standardError: result.estimate.standardError,
      confidenceLower: result.estimate.confidenceInterval.lower,
      confidenceUpper: result.estimate.confidenceInterval.upper,
    },
  });
}

function runHestonLesson(values: Values): LessonOutput {
  const envelope = priceHestonMonteCarlo({
    contract: HESTON_REQUEST_CONTRACT,
    option: { optionType: "call", strike: 100 },
    market: {
      spot: 100,
      initialVariance: values.longRunVariance,
      riskFreeRate: 0.04,
      dividendYield: 0.01,
    },
    model: {
      meanReversion: 1.4,
      longRunVariance: values.longRunVariance,
      volatilityOfVariance: values.volOfVol,
      rho: values.correlation,
    },
    timeToMaturityYears: 1,
    execution: {
      seed: 2718,
      paths: even(Math.round(values.paths)),
      steps: 120,
      antithetic: true,
      samplePathCount: 6,
    },
  });
  const { result } = envelope;
  const leveragePoints = result.samplePaths.flatMap((path) =>
    path.spots.slice(1).map((spot, index) => ({
      x: Math.log(spot / path.spots[index]),
      y: path.variances[index + 1] - path.variances[index],
      label: `Path ${path.trajectoryIndex + 1}, step ${index + 1}`,
    })),
  );
  const leverageReturns = leveragePoints.map((point) => point.x);
  const leverageVarianceChanges = leveragePoints.map((point) => point.y);
  const leverageCorrelation =
    populationVariance(leverageReturns) > 0 &&
    populationVariance(leverageVarianceChanges) > 0
      ? correlation(leverageReturns, leverageVarianceChanges)
      : null;
  const terminalDistribution = result.diagnostics.terminalSpotDistribution;
  return outputFromEnvelope(envelope, {
    headline: "Variance stays nonnegative, but discretization work remains visible.",
    explanation: `The call estimate is ${money(result.estimate.price)}. The simulated terminal variance mean is ${fixed(result.diagnostics.meanTerminalVariance, 4)}, versus analytical expectation ${fixed(result.diagnostics.expectedTerminalVariance, 4)}.`,
    metrics: [
      metric("Option estimate", money(result.estimate.price), `SE ${money(result.estimate.standardError)}`),
      metric("Terminal variance", fixed(result.diagnostics.meanTerminalVariance, 4), `Expected ${fixed(result.diagnostics.expectedTerminalVariance, 4)}`),
      metric("Observed shock ρ", fixed(result.diagnostics.observedShockCorrelation, 2), `Configured ${fixed(values.correlation, 2)}`),
      metric(
        "Stored-path leverage ρ",
        leverageCorrelation === null ? "Undefined" : fixed(leverageCorrelation, 2),
        leverageCorrelation === null
          ? "Variance did not change on the retained paths"
          : "Correlation of log returns with same-step variance changes",
      ),
      metric("Projected steps", result.diagnostics.projectedVarianceSteps.toLocaleString(), "Negative Euler proposals floored at zero", result.diagnostics.projectedVarianceSteps > 0 ? "caution" : "neutral"),
    ],
    series: [{
      name: "Spot path",
      tone: "forest",
      points: result.samplePaths[0].times.map((time, index) => ({
        x: time,
        y: result.samplePaths[0].spots[index],
      })),
    }],
    additionalCharts: [
      {
        title: "Heston variance path",
        xLabel: "Time",
        xUnit: "years",
        yLabel: "Instantaneous variance",
        yUnit: "annual return²",
        series: [{
          name: "Variance path",
          tone: "vermilion",
          points: result.samplePaths[0].times.map((time, index) => ({
            x: time,
            y: result.samplePaths[0].variances[index],
          })),
        }],
      },
      {
        title: "Heston terminal spot distribution summary",
        xLabel: "Distribution marker",
        xUnit: "cumulative probability",
        yLabel: "Terminal spot",
        yUnit: "currency",
        series: [{
          name: "Min · 5th · median · 95th · max",
          tone: "ochre",
          points: [
            { x: 0, y: terminalDistribution.minimum, label: "minimum" },
            { x: 0.05, y: terminalDistribution.percentile05, label: "5th percentile" },
            { x: 0.5, y: terminalDistribution.median, label: "median" },
            { x: 0.95, y: terminalDistribution.percentile95, label: "95th percentile" },
            { x: 1, y: terminalDistribution.maximum, label: "maximum" },
          ],
        }],
      },
      {
        title: "Heston leverage effect on retained paths",
        xLabel: "Log return",
        xUnit: "per step",
        yLabel: "Variance change",
        yUnit: "annual return² per step",
        series: [{
          name: "Return versus variance change",
          tone: "vermilion",
          style: "points",
          points: leveragePoints,
        }],
      },
    ],
    diagnostics: [
      `Scheme: ${result.scheme}`,
      `All stored variances nonnegative: ${String(result.diagnostics.allVariancesNonNegative)}`,
      `Feller condition satisfied: ${String(result.diagnostics.fellerConditionSatisfied)}`,
    ],
    compactSummary: {
      estimate: result.estimate.price,
      standardError: result.estimate.standardError,
      meanTerminalVariance: result.diagnostics.meanTerminalVariance,
      observedShockCorrelation: result.diagnostics.observedShockCorrelation,
      storedPathLeverageCorrelation: leverageCorrelation ?? "undefined",
      terminalSpotMedian: terminalDistribution.median,
      terminalSpotPercentile05: terminalDistribution.percentile05,
      terminalSpotPercentile95: terminalDistribution.percentile95,
      projectedVarianceSteps: result.diagnostics.projectedVarianceSteps,
    },
  });
}

function runStrategyLesson(values: Values): LessonOutput {
  const strategyIndex = Math.round(values.strategy);
  const strategy =
    strategyIndex === 0
      ? createCoveredCall(values.spot + values.width)
      : strategyIndex === 1
        ? createProtectivePut(values.spot - values.width)
        : strategyIndex === 2
          ? createStraddle(values.spot)
          : strategyIndex === 3
            ? createIronCondor(
                values.spot - 2 * values.width,
                values.spot - values.width,
                values.spot + values.width,
                values.spot + 2 * values.width,
              )
            : strategyIndex === 4
              ? createStrangle(
                  values.spot - values.width,
                  values.spot + values.width,
                )
              : createBullCallSpread(
                  values.spot - values.width,
                  values.spot + values.width,
                );
  const terminalSpots = Array.from({ length: 81 }, (_, index) =>
    values.spot * (0.5 + index / 80),
  );
  const envelope = valueOptionStrategy({
    contract: STRATEGY_VALUATION_REQUEST_CONTRACT,
    strategy,
    market: {
      spot: values.spot,
      timeToMaturityYears: 0.5,
      riskFreeRate: 0.04,
      volatility: values.volatility,
      dividendYield: 0.01,
    },
    terminalSpots,
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "A strategy is an auditable sum of validated legs.",
    explanation: `${result.strategyName} has model value ${money(result.currentModelValue)} and net entry cost ${money(result.netInitialCost)} under the illustrative inputs.`,
    metrics: [
      metric("Model value", money(result.currentModelValue), `${result.legValuations.length} composed legs`),
      metric("Net initial cost", money(result.netInitialCost), "Positive debit; negative credit"),
      metric("Delta", fixed(result.greeks.delta, 3), "Signed sum of leg deltas"),
      metric("Gamma", fixed(result.greeks.gamma, 4), "Signed sum of leg gammas"),
    ],
    series: [
      {
        name: "Expiry payoff",
        tone: "forest",
        points: result.diagram.map((point) => ({ x: point.terminalSpot, y: point.payoff })),
      },
      {
        name: "Profit / loss",
        tone: "vermilion",
        points: result.diagram.map((point) => ({ x: point.terminalSpot, y: point.profitLoss })),
      },
    ],
    table: {
      caption: "Signed leg valuation",
      columns: ["Leg", "Kind", "Quantity", "Model value", "Entry cost"],
      rows: result.legValuations.map((leg) => [
        String(leg.legIndex + 1),
        leg.kind,
        fixed(leg.signedQuantity, 2),
        money(leg.signedModelValue),
        money(leg.signedEntryCost),
      ]),
    },
    diagnostics: [
      `Strategy contract: ${strategy.contract}`,
      `Leg value sum: ${money(result.legValuations.reduce((sum, leg) => sum + leg.signedModelValue, 0))}`,
      "Payoff and profit/loss remain separate series.",
    ],
    compactSummary: {
      strategy: result.strategyName,
      currentModelValue: result.currentModelValue,
      netInitialCost: result.netInitialCost,
      delta: result.greeks.delta,
      gamma: result.greeks.gamma,
    },
  });
}

function runVasicekLesson(values: Values): LessonOutput {
  const envelope = compareVasicekAndCir({
    contract: SHORT_RATE_COMPARISON_REQUEST_CONTRACT,
    vasicekParameters: {
      initialAnnualShortRate: values.initialRate,
      longRunAnnualMeanRate: values.longRunRate,
      meanReversionSpeedPerYear: values.meanReversion,
      annualVolatility: values.volatility,
    },
    cirParameters: {
      initialAnnualShortRate: Math.max(values.initialRate, 0),
      longRunAnnualMeanRate: Math.max(values.longRunRate, 0),
      meanReversionSpeedPerYear: values.meanReversion,
      annualVolatility: values.cirVolatility,
    },
    execution: { seed: 82, pathCount: 300, stepCount: 120, stepYears: 1 / 12 },
    bondMaturitiesYears: [values.maturity],
  });
  const result = envelope.result;
  const bond = result.bondComparison[0];
  return outputFromEnvelope(envelope, {
    headline: "Vasicek and CIR reveal different boundary assumptions on one grid.",
    explanation: `On the same horizon, path count, and bond maturity, Vasicek prices the bond at ${fixed(bond.vasicek.pricePerUnitFace, 4)} and CIR at ${fixed(bond.cir.pricePerUnitFace, 4)}. Vasicek is Gaussian; CIR scales diffusion by √r and remains nonnegative.`,
    metrics: [
      metric("Vasicek bond", fixed(bond.vasicek.pricePerUnitFace, 4), "Gaussian short-rate model"),
      metric("CIR bond", fixed(bond.cir.pricePerUnitFace, 4), "Nonnegative square-root model"),
      metric("CIR − Vasicek yield", percentage(bond.cirMinusVasicekZeroYield ?? 0), "Same maturity, continuous yields"),
      metric("Vasicek negatives", percentage(result.diagnostics.vasicekNegativeRateObservationFraction), "Fraction of simulated observations", result.diagnostics.vasicekNegativeRateObservationFraction > 0 ? "caution" : "neutral"),
    ],
    series: [
      {
        name: "Vasicek median rate",
        tone: "vermilion",
        points: result.rateFanComparison.map((point) => ({
          x: point.timeYears,
          y: point.vasicek.medianAnnualRate,
        })),
      },
      {
        name: "CIR median rate",
        tone: "forest",
        points: result.rateFanComparison.map((point) => ({
          x: point.timeYears,
          y: point.cir.medianAnnualRate,
        })),
      },
    ],
    table: {
      caption: `${fixed(values.maturity, 2)}-year zero-coupon bond sensitivities`,
      columns: ["Model", "Price", "Zero yield", "Duration", "Convexity"],
      rows: [
        ["Vasicek", fixed(bond.vasicek.pricePerUnitFace, 4), percentage(bond.vasicek.continuouslyCompoundedZeroYield ?? 0), fixed(bond.vasicek.shortRateDurationYears, 3), fixed(bond.vasicek.shortRateConvexityYearsSquared, 3)],
        ["CIR", fixed(bond.cir.pricePerUnitFace, 4), percentage(bond.cir.continuouslyCompoundedZeroYield ?? 0), fixed(bond.cir.shortRateDurationYears, 3), fixed(bond.cir.shortRateConvexityYearsSquared, 3)],
      ],
    },
    diagnostics: [
      `Shared execution: seed ${result.execution.seed}, ${result.execution.pathCount} paths, ${result.execution.stepCount} monthly steps`,
      `CIR minimum simulated rate: ${percentage(result.diagnostics.cirMinimumSimulatedAnnualRate)}`,
      `CIR Feller condition satisfied: ${String(result.diagnostics.cirFellerConditionSatisfied)}`,
      `Pricing measure: ${result.conventions.pricingMeasure} · ${result.conventions.discounting}`,
    ],
    compactSummary: {
      vasicekZeroCouponPrice: bond.vasicek.pricePerUnitFace,
      cirZeroCouponPrice: bond.cir.pricePerUnitFace,
      cirMinusVasicekYield: bond.cirMinusVasicekZeroYield ?? 0,
      negativeRateFraction:
        result.diagnostics.vasicekNegativeRateObservationFraction,
    },
  });
}

function runCirLesson(values: Values): LessonOutput {
  const envelope = runCirModel({
    contract: CIR_REQUEST_CONTRACT,
    parameters: {
      initialAnnualShortRate: values.initialRate,
      longRunAnnualMeanRate: values.longRunRate,
      meanReversionSpeedPerYear: values.meanReversion,
      annualVolatility: values.volatility,
    },
    execution: { seed: 83, pathCount: 300, stepCount: 120, stepYears: 1 / 12 },
    bondMaturitiesYears: [values.maturity],
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "Square-root diffusion stays nonnegative and surfaces its boundary condition.",
    explanation: `The Feller comparison is ${fixed(result.fellerLeftSide, 4)} versus ${fixed(result.fellerRightSide, 4)}. The condition is ${result.fellerConditionSatisfied ? "satisfied" : "violated and visibly warned"}.`,
    metrics: [
      metric("Zero-coupon price", fixed(result.zeroCouponBonds[0].pricePerUnitFace, 4), "Per unit face value"),
      metric("Feller left", fixed(result.fellerLeftSide, 4), "2κθ"),
      metric("Feller right", fixed(result.fellerRightSide, 4), "σ²"),
      metric("Feller condition", result.fellerConditionSatisfied ? "Satisfied" : "Violated", "No hidden parameter correction", result.fellerConditionSatisfied ? "positive" : "caution"),
    ],
    series: result.ratePaths.slice(0, 6).map((path, index) => ({
      name: `Rate path ${index + 1}`,
      tone: (["forest", "vermilion", "ochre", "ink", "forest", "vermilion"] as const)[index],
      points: result.timesYears.map((time, pointIndex) => ({ x: time, y: path[pointIndex] })),
    })),
    diagnostics: [
      `Simulation: ${result.simulationMethod}`,
      `All ${result.ratePaths.length.toLocaleString()} retained paths are nonnegative: ${String(result.ratePaths.every((path) => path.every((rate) => rate >= 0)))}`,
      `Pricing measure: ${result.conventions.pricingMeasure}`,
    ],
    compactSummary: {
      zeroCouponPrice: result.zeroCouponBonds[0].pricePerUnitFace,
      fellerConditionSatisfied: result.fellerConditionSatisfied,
      fellerLeft: result.fellerLeftSide,
      fellerRight: result.fellerRightSide,
    },
  });
}

function runNelsonSiegelLesson(values: Values): LessonOutput {
  const maturities = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];
  const observed = evaluateNelsonSiegelCurve(
    {
      levelAnnualYield: values.level,
      slopeAnnualYield: values.slope,
      curvatureAnnualYield: values.curvature,
      decayYears: values.decay,
    },
    maturities,
  ).map((point) => point.annualContinuouslyCompoundedYield);
  const envelope = fitNelsonSiegelCurve({
    contract: NELSON_SIEGEL_FIT_REQUEST_CONTRACT,
    maturitiesYears: maturities,
    observedAnnualYields: observed,
    fixedDecayYears: values.decay,
  });
  const result = envelope.result;
  const namedShocks = buildNelsonSiegelNamedShockCurves(
    result.parameters,
    maturities,
    values.shockMagnitude,
  );
  const shockTones = ["vermilion", "forest", "ochre", "ink"] as const;
  return outputFromEnvelope(envelope, {
    headline: "Named shocks connect curve shapes to level, slope, and curvature.",
    explanation: `The fitted factors are ${percentage(result.parameters.levelAnnualYield)}, ${percentage(result.parameters.slopeAnnualYield)}, and ${percentage(result.parameters.curvatureAnnualYield)}. The four named scenarios then change one interpretable factor at a time by ${percentage(values.shockMagnitude)}.`,
    metrics: [
      metric("Fitted level", percentage(result.parameters.levelAnnualYield), "Long-end component"),
      metric("Fitted slope", percentage(result.parameters.slopeAnnualYield), "Short-end component"),
      metric("Fitted curvature", percentage(result.parameters.curvatureAnnualYield), "Medium-maturity component"),
      metric("Fit RMSE", percentage(result.rmseAnnualYield), "Annual yield units"),
      metric("Shock magnitude", percentage(values.shockMagnitude), "Parallel / steepen / flatten / curvature teaching scenarios"),
    ],
    series: [
      {
        name: "Fitted base curve",
        tone: "ink",
        points: result.fittedCurve.map((point) => ({ x: point.maturityYears, y: point.annualContinuouslyCompoundedYield })),
      },
      ...namedShocks.map((scenario, index) => ({
        name: `${scenario.name} shock`,
        tone: shockTones[index],
        points: scenario.curve.map((point) => ({
          x: point.maturityYears,
          y: point.shockedAnnualYield,
        })),
      })),
    ],
    table: {
      caption: "Named yield-curve scenarios at ten years",
      columns: ["Scenario", "Parameter changed", "Base yield", "Shocked yield", "Change"],
      rows: namedShocks.map((scenario) => {
        const point = scenario.curve.find((candidate) => candidate.maturityYears === 10)!;
        return [
          scenario.name,
          scenario.parameterShock.name,
          percentage(point.baseAnnualYield),
          percentage(point.shockedAnnualYield),
          percentage(point.annualYieldChange),
        ];
      }),
    },
    diagnostics: [
      `Maturity unit: ${result.maturityUnit}`,
      `Yield convention: ${result.yieldConvention}`,
      `Method: ${result.fittingMethod} · converged: ${String(result.converged)}`,
      `Named scenarios: ${namedShocks.map((scenario) => scenario.name).join(" · ")}`,
    ],
    compactSummary: {
      fittedLevel: result.parameters.levelAnnualYield,
      fittedSlope: result.parameters.slopeAnnualYield,
      fittedCurvature: result.parameters.curvatureAnnualYield,
      rmse: result.rmseAnnualYield,
      shockMagnitude: values.shockMagnitude,
    },
  });
}

function runHazardLesson(values: Values): LessonOutput {
  const evaluationTimes = Array.from(
    { length: Math.max(2, Math.round(values.maturity * 2)) },
    (_, index) => ((index + 1) * values.maturity) / Math.max(2, Math.round(values.maturity * 2)),
  );
  const hazardCurve =
    values.curveType >= 0.5
      ? {
          kind: "piecewise-constant" as const,
          segments: [
            { startYears: 0, annualHazardRate: values.hazard },
            {
              startYears: values.breakYear,
              annualHazardRate: values.longHazard,
            },
          ],
        }
      : { kind: "constant" as const, annualHazardRate: values.hazard };
  const envelope = runHazardCreditAnalysis({
    contract: HAZARD_CREDIT_REQUEST_CONTRACT,
    hazardCurve,
    evaluationTimesYears: evaluationTimes,
    exposureAtDefault: 100,
    recoveryFraction: values.recovery,
    bond: {
      faceValue: 100,
      annualCouponRate: 0.05,
      couponFrequencyPerYear: 2,
      maturityYears: values.maturity,
      continuouslyCompoundedRiskFreeRate: values.discountRate,
    },
  });
  const result = envelope.result;
  const horizon = result.curvePoints.at(-1)!;
  return outputFromEnvelope(envelope, {
    headline: "A visible hazard-curve selector changes the survival integral.",
    explanation: `Using a ${hazardCurve.kind === "constant" ? "constant" : "piecewise-constant"} curve, ${fixed(values.maturity, 1)}-year survival is ${percentage(horizon.survivalProbability)} and expected loss on 100 exposure is ${money(horizon.expectedLoss)}.`,
    metrics: [
      metric("Survival", percentage(horizon.survivalProbability), `Through ${fixed(values.maturity, 1)} years`),
      metric("Default probability", percentage(horizon.cumulativeDefaultProbability), "One minus survival"),
      metric("Expected loss", money(horizon.expectedLoss), `Recovery ${percentage(values.recovery)}`),
      metric("Risky bond price", money(result.bondValuation?.price ?? 0), "Expected discounted scheduled + recovery cash flows"),
      metric("Hazard policy", hazardCurve.kind === "constant" ? "Constant" : "Piecewise", hazardCurve.kind === "constant" ? `${percentage(values.hazard)} at every horizon` : `${percentage(values.hazard)} then ${percentage(values.longHazard)} from year ${fixed(values.breakYear, 1)}`),
    ],
    series: [
      {
        name: "Survival probability",
        tone: "forest",
        points: result.curvePoints.map((point) => ({ x: point.timeYears, y: point.survivalProbability })),
      },
      {
        name: "Cumulative default probability",
        tone: "vermilion",
        points: result.curvePoints.map((point) => ({ x: point.timeYears, y: point.cumulativeDefaultProbability })),
      },
    ],
    diagnostics: [
      `Hazard unit: ${result.hazardUnit}`,
      `Curve selector: ${hazardCurve.kind}`,
      `Recovery convention: ${result.bondValuation?.recoveryConvention ?? "none"}`,
      `Discounting: ${result.bondValuation?.discounting ?? "none"}`,
    ],
    compactSummary: {
      survivalProbability: horizon.survivalProbability,
      defaultProbability: horizon.cumulativeDefaultProbability,
      expectedLoss: horizon.expectedLoss,
      riskyBondPrice: result.bondValuation?.price ?? 0,
      hazardCurveKind: hazardCurve.kind,
    },
  });
}

function runMertonCreditLesson(values: Values): LessonOutput {
  const envelope = mertonStructuralCredit({
    contract: MERTON_CREDIT_REQUEST_CONTRACT,
    assetValue: values.assetValue,
    debtFaceValue: values.debt,
    maturityYears: values.maturity,
    continuouslyCompoundedRiskFreeRate: values.rate,
    annualAssetVolatility: values.assetVolatility,
    physicalExpectedAssetReturn: 0.07,
  });
  const result = envelope.result;
  const balanceError = result.equityValue + result.riskyDebtValue - values.assetValue;
  return outputFromEnvelope(envelope, {
    headline: "Equity-as-a-call makes the structural balance sheet auditable.",
    explanation: `Equity is ${money(result.equityValue)} and risky debt is ${money(result.riskyDebtValue)}; together they differ from firm assets by only ${fixed(balanceError, 10)}.`,
    metrics: [
      metric("Equity value", money(result.equityValue), "European call on firm assets"),
      metric("Risky debt", money(result.riskyDebtValue), "Firm assets minus equity"),
      metric("Risk-neutral PD", percentage(result.riskNeutralDefaultProbability), "Pricing-measure maturity probability"),
      metric("Physical PD", percentage(result.physicalDefaultProbability), "Uses supplied physical asset drift"),
    ],
    series: [
      {
        name: "Equity payoff at maturity",
        tone: "forest",
        points: Array.from({ length: 61 }, (_, index) => {
          const assetValue = values.debt * (index / 30);
          return { x: assetValue, y: Math.max(assetValue - values.debt, 0) };
        }),
      },
      {
        name: "Debt payoff at maturity",
        tone: "ochre",
        points: Array.from({ length: 61 }, (_, index) => {
          const assetValue = values.debt * (index / 30);
          return { x: assetValue, y: Math.min(assetValue, values.debt) };
        }),
      },
    ],
    diagnostics: [
      `Balance-sheet error: ${fixed(balanceError, 12)}`,
      `Distance to default: ${result.distanceToDefault === null ? "deterministic limit" : fixed(result.distanceToDefault, 3)}`,
      `Annual credit spread: ${percentage(result.annualCreditSpread)}`,
    ],
    compactSummary: {
      equityValue: result.equityValue,
      riskyDebtValue: result.riskyDebtValue,
      riskNeutralDefaultProbability: result.riskNeutralDefaultProbability,
      physicalDefaultProbability: result.physicalDefaultProbability,
      balanceSheetError: balanceError,
    },
  });
}

function runOuLesson(values: Values): LessonOutput {
  const calibrationSimulation = runOrnsteinUhlenbeck({
    contract: "trading-lab/ornstein-uhlenbeck@1",
    initialSpread: values.initialSpread,
    equilibrium: values.equilibrium,
    meanReversion: values.meanReversion,
    volatility: values.volatility,
    entryThreshold: 1,
    exitThreshold: 0.2,
    execution: {
      seed: 199,
      paths: 1,
      steps: 600,
      stepYears: 1 / 12,
      samplePaths: 1,
    },
  });
  const fitted = fitOrnsteinUhlenbeck({
    contract: "trading-lab/ou-calibration@1",
    spreads: calibrationSimulation.result.sampledSpreadPaths[0],
    stepYears: 1 / 12,
  });
  const envelope = runOrnsteinUhlenbeck({
    contract: "trading-lab/ornstein-uhlenbeck@1",
    initialSpread: values.initialSpread,
    equilibrium: values.equilibrium,
    meanReversion: values.meanReversion,
    volatility: values.volatility,
    entryThreshold: 1,
    exitThreshold: 0.2,
    execution: { seed: 99, paths: 1_000, steps: 120, stepYears: 1 / 12, samplePaths: 8 },
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "Simulation and calibration answer opposite OU questions.",
    explanation: `Simulation starts from θ=${fixed(values.meanReversion, 2)} and asks what paths may do. Calibration starts from a fixed 600-month classroom series and recovers θ=${fixed(fitted.meanReversion, 2)}; the difference is finite-sample estimation error.`,
    metrics: [
      metric("Configured θ", fixed(values.meanReversion, 3), `Half-life ${fixed(result.halfLifeYears, 2)} years`),
      metric("Fitted θ", fitted.stationary ? fixed(fitted.meanReversion, 3) : "Not stationary", fitted.stationary ? `Half-life ${fixed(fitted.halfLifeYears, 2)} years` : "AR(1) coefficient lies outside (0, 1)", fitted.stationary ? "neutral" : "caution"),
      metric("Configured / fitted μ", `${fixed(values.equilibrium, 2)} / ${fixed(fitted.equilibrium, 2)}`, "Long-run equilibrium spread"),
      metric("Configured / fitted σ", `${fixed(values.volatility, 2)} / ${fixed(fitted.volatility, 2)}`, "Diffusion scale per √year"),
      metric("Entry probability", percentage(result.probabilityOfEntry), "Touches ±1 from equilibrium"),
      metric("Equilibrium hit", percentage(result.probabilityOfEquilibriumHit), "Crosses modeled mean"),
    ],
    series: result.sampledSpreadPaths.slice(0, 6).map((path, index) => ({
      name: `Spread path ${index + 1}`,
      tone: (["forest", "vermilion", "ochre", "ink", "forest", "vermilion"] as const)[index],
      points: path.map((value, step) => ({ x: step / 12, y: value })),
    })),
    table: {
      caption: "Configured model versus fitted classroom series",
      columns: ["Quantity", "Configured", "Fitted", "Interpretation"],
      rows: [
        ["Equilibrium μ", fixed(values.equilibrium, 3), fixed(fitted.equilibrium, 3), "Long-run level"],
        ["Mean reversion θ", fixed(values.meanReversion, 3), fitted.stationary ? fixed(fitted.meanReversion, 3) : "undefined", "Speed per year"],
        ["Volatility σ", fixed(values.volatility, 3), fixed(fitted.volatility, 3), "Spread units per √year"],
        ["Half-life", fixed(result.halfLifeYears, 3), fitted.stationary ? fixed(fitted.halfLifeYears, 3) : "undefined", "ln(2) / θ"],
      ],
    },
    diagnostics: [
      `Exact conditional variance: ${fixed(result.conditionalStepVariance, 5)}`,
      `Fitted AR(1) coefficient: ${fixed(fitted.autoregressiveCoefficient, 4)} · stationary: ${String(fitted.stationary)}`,
      ...(fitted.warnings.length === 0 ? ["Calibration warning: none"] : fitted.warnings),
      `Sampled trading signals retained: ${result.sampledSignals.length}`,
      "Threshold hits are scenario outcomes, not calibrated trading recommendations.",
    ],
    compactSummary: {
      halfLifeYears: result.halfLifeYears,
      fittedMeanReversion: fitted.meanReversion,
      fittedHalfLifeYears: Number.isFinite(fitted.halfLifeYears)
        ? fitted.halfLifeYears
        : "not stationary",
      fittedStationary: fitted.stationary,
      probabilityOfEntry: result.probabilityOfEntry,
      probabilityOfEquilibriumHit: result.probabilityOfEquilibriumHit,
    },
  });
}

function runOrderBookLesson(values: Values): LessonOutput {
  const mid = 100;
  const halfSpread = values.spread / 2;
  const depth = Math.round(values.depth);
  const marketSize = Math.round(values.marketSize);
  const result = runLimitOrderBook({
    contract: "trading-lab/limit-order-book@1",
    fees: {
      makerRate: values.makerFeeRate,
      takerRate: values.takerFeeRate,
      fixedPerTrade: values.fixedFee,
      collector: "classroom-exchange",
    },
    events: [
      { kind: "limit", id: "bid-a", owner: "maker-a", side: "buy", price: mid - halfSpread, quantity: depth },
      { kind: "limit", id: "ask-a", owner: "maker-a", side: "sell", price: mid + halfSpread, quantity: depth },
      { kind: "limit", id: "ask-b", owner: "maker-b", side: "sell", price: mid + halfSpread + 1, quantity: depth },
      { kind: "market", id: "market-buy", owner: "learner", side: "buy", quantity: marketSize },
    ],
  });
  const final = result.snapshots.at(-1)!;
  const ladder = [
    ...final.bids.map((level) => ({ x: level.price, y: -level.quantity, label: "bid" })),
    ...final.asks.map((level) => ({ x: level.price, y: level.quantity, label: "ask" })),
  ];
  return {
    resultContract: result.contract,
    headline: "Every fill reconciles inventory, cash, and explicit fees.",
    explanation: `${result.trades.length} fills execute ${result.conservation.executedBuyQuantity} units and charge ${money(result.conservation.feesCharged)}. The fee collector is part of the ledger, so costs cannot disappear from conservation checks.`,
    metrics: [
      metric("Executed quantity", String(result.conservation.executedBuyQuantity), "Buy and sell totals match"),
      metric("Fills", String(result.trades.length), "Each maker match is recorded"),
      metric("Fees charged", money(result.conservation.feesCharged), "Maker + taker + fixed match fees"),
      metric("Cash difference", fixed(result.conservation.cashDifference, 8), "Must remain zero"),
      metric("Inventory difference", fixed(result.conservation.inventoryDifference, 8), "Must remain zero"),
      metric("Fee difference", fixed(result.conservation.feesPaidDifference, 8), "Paid fees minus charged fees"),
    ],
    series: [{ name: "Final depth ladder", tone: "forest", style: "bars", points: ladder }],
    table: {
      caption: "Trade tape",
      columns: ["Maker order", "Buyer", "Seller", "Price", "Quantity", "Maker fee", "Taker fee", "Total fee"],
      rows: result.trades.map((trade) => [
        trade.makerOrderId,
        trade.buyer,
        trade.seller,
        money(trade.price),
        String(trade.quantity),
        money(trade.makerFee),
        money(trade.takerFee),
        money(trade.totalFees),
      ]),
    },
    diagnostics: [
      `Executed buy = executed sell: ${String(result.conservation.executedBuyQuantity === result.conservation.executedSellQuantity)}`,
      `Every event ledger reconciles fees: ${String(result.accountingSnapshots.every((snapshot) => snapshot.feesReconciled))}`,
      `Average slippage: ${fixed(result.averageSlippage, 3)}`,
      `Event log statuses: ${result.eventLog.map((event) => event.status).join(" → ")}`,
    ],
    warnings: [],
    provenance: ["Engine: trading-lab@1", "Replay: deterministic", `Fees: maker ${percentage(values.makerFeeRate)}, taker ${percentage(values.takerFeeRate)}, fixed ${money(values.fixedFee)}`, "Book bounds: 10,000 events / 20 visible levels"],
    compactSummary: {
      fills: result.trades.length,
      executedQuantity: result.conservation.executedBuyQuantity,
      cashDifference: result.conservation.cashDifference,
      inventoryDifference: result.conservation.inventoryDifference,
      feesCharged: result.conservation.feesCharged,
      feesPaidDifference: result.conservation.feesPaidDifference,
    },
  };
}

function runAgentMarketLesson(values: Values): LessonOutput {
  const noiseAgents = Array.from({ length: Math.round(values.noiseAgents) }, (_, index) => ({
    id: `noise-${index + 1}`,
    kind: "noise" as const,
    orderSize: 1,
  }));
  const result = runAgentMarket({
    contract: "trading-lab/agent-market@1",
    initialPrice: 100,
    tickSize: 1,
    steps: Math.round(values.steps),
    seed: 111,
    fees: {
      makerRate: 0,
      takerRate: values.takerFeeRate,
      fixedPerTrade: 0,
      collector: "classroom-exchange",
    },
    agents: [
      { id: "maker", kind: "market-maker", orderSize: 5 },
      { id: "fundamental", kind: "fundamental", orderSize: 1, fundamentalValue: values.fundamentalValue },
      { id: "trend", kind: "trend", orderSize: 1 },
      {
        id: "risk-budget",
        kind: "risk-budget",
        orderSize: 1,
        targetRiskBudget: values.riskBudget,
        riskLookback: Math.round(values.riskLookback),
        maximumInventory: 20,
      },
      ...noiseAgents,
    ],
  });
  const riskDecisions = result.decisions.filter(
    (decision) => decision.agentId === "risk-budget",
  );
  const maximumTargetInventory = Math.max(
    ...riskDecisions.map((decision) => Math.abs(decision.targetInventory ?? 0)),
  );
  return {
    resultContract: result.contract,
    headline: "A risk budget sizes intentions; fills and fees determine wealth.",
    explanation: `${result.decisions.length} recorded decisions produced ${result.orderBook.trades.length} fills. The risk-budget agent targets one-step volatility exposure of ${money(values.riskBudget)} and uses settled inventory—not submitted orders—when it sizes the next trade.`,
    metrics: [
      metric("Decisions", String(result.decisions.length), "Every rationale is recorded"),
      metric("Trades", String(result.orderBook.trades.length), "Validated book fills"),
      metric("Final price", money(result.priceSeries.at(-1)!), "Last traded or carried price"),
      metric("Risk budget", money(values.riskBudget), `Maximum target inventory ${fixed(maximumTargetInventory, 2)}`),
      metric("Fees charged", money(result.orderBook.conservation.feesCharged), `Taker fee ${percentage(values.takerFeeRate)}`),
      metric("Ledger cash error", fixed(result.orderBook.conservation.cashDifference, 8), "Must remain zero"),
    ],
    series: [pathSeries("Scenario price", result.priceSeries, "forest")],
    table: {
      caption: "Agent marked wealth",
      columns: ["Agent", "Cash", "Inventory", "Fees paid", "Gross wealth", "Net wealth"],
      rows: result.agentWealth.map((agent) => [
        agent.agentId,
        money(agent.cash),
        fixed(agent.inventory, 0),
        money(agent.feesPaid),
        money(agent.grossMarkedWealth),
        money(agent.markedWealth),
      ]),
    },
    diagnostics: [
      `Scenario-not-forecast label: ${String(result.scenarioNotForecast)}`,
      `Inventory conservation error: ${fixed(result.orderBook.conservation.inventoryDifference, 8)}`,
      `Risk-budget decisions: ${riskDecisions.length} · every one records a budget: ${String(riskDecisions.every((decision) => decision.riskBudget !== undefined))}`,
      `Fee accounting reconciled: ${String(result.orderBook.accountingSnapshots.every((snapshot) => snapshot.feesReconciled))}`,
      "Fixed seed reproduces decisions, events, fills, and ledgers.",
    ],
    warnings: [],
    provenance: ["Engine: trading-lab@1", "Seed: 111", "Agents: transparent illustrative strategies", `Risk rule: cash budget ${money(values.riskBudget)} over ${Math.round(values.riskLookback)} observations`],
    compactSummary: {
      decisions: result.decisions.length,
      trades: result.orderBook.trades.length,
      finalPrice: result.priceSeries.at(-1)!,
      conservationError: result.orderBook.conservation.cashDifference,
      feesCharged: result.orderBook.conservation.feesCharged,
      riskBudget: values.riskBudget,
      maximumTargetInventory,
    },
  };
}

function runExecutionLesson(values: Values): LessonOutput {
  const envelope = runAlmgrenChriss({
    contract: "trading-lab/almgren-chriss@1",
    shares: Math.round(values.shares),
    horizon: 1,
    intervals: Math.round(values.intervals),
    volatilityPerSqrtTime: 0.02,
    temporaryImpact: values.temporaryImpact,
    permanentImpact: 0.0000002,
    riskAversion: values.riskAversion,
  });
  const result = envelope.result;
  return outputFromEnvelope(envelope, {
    headline: "Urgency moves along an explicit expected-cost / variance frontier.",
    explanation: `The schedule liquidates ${Math.round(values.shares).toLocaleString()} shares in ${Math.round(values.intervals)} trades. Expected cost is ${money(result.expectedCost)} and cost variance is ${fixed(result.costVariance, 2)}.`,
    metrics: [
      metric("Expected cost", money(result.expectedCost), "Temporary plus permanent impact"),
      metric("Cost variance", fixed(result.costVariance, 2), "Exposure to price uncertainty"),
      metric("First trade", Math.round(result.trades[0]).toLocaleString(), "Shares in interval one"),
      metric("Final inventory", fixed(result.sharesRemaining.at(-1)!, 0), "Must be zero"),
    ],
    series: [
      {
        name: "Shares remaining",
        tone: "forest",
        style: "step",
          points: result.times.map((time, index) => ({ x: time, y: result.sharesRemaining[index] })),
      },
    ],
    additionalCharts: [
      {
        title: "Execution urgency cost-risk frontier",
        xLabel: "Cost variance",
        yLabel: "Expected execution cost",
        yUnit: "currency",
        series: [{
          name: "Urgency frontier",
          tone: "vermilion",
          style: "points",
          points: result.urgencyFrontier.map((point) => ({ x: point.costVariance, y: point.expectedCost })),
        }],
      },
    ],
    diagnostics: [
      `Temporary cost: ${money(result.expectedTemporaryCost)}`,
      `Permanent cost: ${money(result.expectedPermanentCost)}`,
      `Trades sum to requested shares: ${String(Math.abs(result.trades.reduce((sum, trade) => sum + trade, 0) - values.shares) < 1e-6)}`,
    ],
    compactSummary: {
      expectedCost: result.expectedCost,
      costVariance: result.costVariance,
      firstTrade: result.trades[0],
      finalInventory: result.sharesRemaining.at(-1)!,
    },
  });
}

function outputFromEnvelope<Result>(
  envelope: ModelEnvelope<Result>,
  content: Omit<LessonOutput, "resultContract" | "warnings" | "provenance"> & {
    readonly resultContract?: string;
  },
): LessonOutput {
  return {
    ...content,
    resultContract: content.resultContract ?? envelope.provenance.resultContract,
    warnings: envelope.warnings.map((warning) => warning.message),
    provenance: [
      `Engine: ${envelope.provenance.engineVersion}`,
      ...(envelope.provenance.seed === undefined
        ? []
        : [`Seed: ${envelope.provenance.seed}`]),
      `Input: ${envelope.provenance.inputContract}`,
      `Result: ${envelope.provenance.resultContract}`,
    ],
  };
}

function metric(
  label: string,
  value: string,
  detail: string,
  tone: LessonMetric["tone"] = "neutral",
): LessonMetric {
  return { label, value, detail, tone };
}

function pathSeries(
  name: string,
  values: readonly number[],
  tone: LessonSeries["tone"],
): LessonSeries {
  return {
    name,
    tone,
    points: values.map((value, index) => ({ x: index, y: value })),
  };
}

function scatterSeries(
  name: string,
  rows: readonly (readonly number[])[],
  tone: LessonSeries["tone"],
): LessonSeries {
  return {
    name,
    tone,
    style: "points",
    points: rows.map((row) => ({ x: row[0], y: row[1] })),
  };
}

function quantileSeries(
  name: string,
  values: readonly number[],
  probabilities: readonly number[],
  tone: LessonSeries["tone"],
): LessonSeries {
  return {
    name,
    tone,
    points: probabilities.map((probability) => ({
      x: probability,
      y: quantile(values, probability),
    })),
  };
}

function allocationTable(
  rows: readonly [string, {
    readonly weights: readonly number[];
    readonly expectedReturnPerPeriod: number;
    readonly volatilityPerPeriod: number;
    readonly sharpeRatio: number | null;
  }][],
) {
  return {
    caption: "Allocation comparison",
    columns: ["Portfolio", "Asset A", "Asset B", "Expected return", "Volatility", "Sharpe"],
    rows: rows.map(([label, allocation]) => [
      label,
      percentage(allocation.weights[0]),
      percentage(allocation.weights[1]),
      percentage(allocation.expectedReturnPerPeriod),
      percentage(allocation.volatilityPerPeriod),
      fixed(allocation.sharpeRatio ?? 0, 2),
    ]),
  };
}

function twoAssetCovariance(
  volatilityA: number,
  volatilityB: number,
  correlation: number,
): number[][] {
  return [
    [volatilityA ** 2, correlation * volatilityA * volatilityB],
    [correlation * volatilityA * volatilityB, volatilityB ** 2],
  ];
}

function illustrativeReturnDataset(observations: number): ReturnDataset {
  return {
    contract: "return-dataset@1",
    assetIds: ["Asset A", "Asset B"],
    timestamps: Array.from({ length: observations }, (_, index) => {
      const date = new Date(Date.UTC(2019, index, 1));
      return date.toISOString().slice(0, 10);
    }),
    frequency: "monthly",
    returnConvention: "simple",
    rows: Array.from({ length: observations }, (_, index) => [
      0.006 + 0.035 * Math.sin(index * 0.77) + 0.012 * Math.cos(index * 0.19),
      0.0025 + 0.012 * Math.sin(index * 0.77 + 0.8),
    ]),
    missingValuePolicy: "reject",
    alignmentPolicy: "intersection",
    currency: "illustrative units",
    adjusted: true,
    provenance: {
      label: "Bundled sinusoidal classroom returns",
      kind: "illustrative",
    },
  };
}

function syntheticRegimeDataset(
  observations: number,
  persistence: number,
): ReturnDataset {
  const random = createSemanticRandom(611, "lesson/regimes");
  let state = 1;
  const means = [-0.025, 0.002, 0.025];
  const rows = Array.from({ length: observations }, (_, index) => {
    if (random.uniform("transition", index) > persistence) {
      state = (state + 1 + Math.floor(random.uniform("destination", index) * 2)) % 3;
    }
    return [means[state] + 0.006 * random.normal("return", index)];
  });
  return {
    contract: "return-dataset@1",
    assetIds: ["Lesson asset"],
    timestamps: Array.from({ length: observations }, (_, index) => {
      const date = new Date(Date.UTC(2010, index, 1));
      return date.toISOString().slice(0, 10);
    }),
    frequency: "monthly",
    returnConvention: "log",
    rows,
    missingValuePolicy: "reject",
    alignmentPolicy: "intersection",
    provenance: { label: "Synthetic persistent-regime lesson", kind: "illustrative" },
  };
}

function buildRetirementAssetReturnPaths(
  paths: number,
  steps: number,
): number[][][] {
  const random = createSemanticRandom(404, "lesson/retirement");
  return Array.from({ length: paths }, (_, pathIndex) =>
    Array.from({ length: steps }, (_, stepIndex) => {
      const stockShock = random.normal("stock-return", pathIndex, stepIndex);
      const independentBondShock = random.normal(
        "bond-return-independent",
        pathIndex,
        stepIndex,
      );
      const bondShock =
        0.2 * stockShock + Math.sqrt(1 - 0.2 ** 2) * independentBondShock;
      return [
        Math.exp(
          (0.06 - 0.5 * 0.16 ** 2) / 12 +
            (0.16 / Math.sqrt(12)) * stockShock,
        ) - 1,
        Math.exp(
          (0.025 - 0.5 * 0.06 ** 2) / 12 +
            (0.06 / Math.sqrt(12)) * bondShock,
        ) - 1,
      ];
    }),
  );
}

function illustrativeLossReturns(observations: number): number[] {
  const random = createSemanticRandom(909, "lesson/risk-returns");
  return Array.from({ length: observations }, (_, index) => {
    const ordinary = 0.00025 + 0.011 * random.normal("ordinary", index);
    const shock = random.uniform("tail", index) < 0.035
      ? -0.035 - 0.02 * Math.abs(random.normal("shock", index))
      : 0;
    return ordinary + shock;
  });
}

function monthlyTimestamps(count: number, startYear: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const year = startYear + Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}-01`;
  });
}

function cumulativeGrowth(returns: readonly number[]): number[] {
  const values = [1];
  for (const [index, portfolioReturn] of returns.entries()) {
    if (!Number.isFinite(portfolioReturn) || portfolioReturn < -1) {
      throw new QuantError(
        "NUMERICAL_FAILURE",
        "The simulated simple-return path cannot produce a finite wealth index.",
        `returns.${index}`,
      );
    }
    const nextValue = values.at(-1)! * (1 + portfolioReturn);
    if (!Number.isFinite(nextValue)) {
      throw new QuantError(
        "NUMERICAL_FAILURE",
        "The compounded wealth index exceeded the finite numerical range.",
        `returns.${index}`,
      );
    }
    values.push(nextValue);
  }
  return values;
}

function sampleEvenly<Value>(
  values: readonly Value[],
  maximum: number,
): readonly Value[] {
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (maximum - 1))],
  );
}

function monteCarloPayoff(
  index: number,
  strike: number,
  spot: number,
): SingleAssetPayoffSpec {
  if (index === 0) return { kind: "european", optionType: "call", strike };
  if (index === 1) {
    return {
      kind: "asian",
      optionType: "call",
      strike,
      averaging: "arithmetic",
      includeInitial: true,
    };
  }
  if (index === 2) {
    return {
      kind: "barrier",
      optionType: "call",
      strike,
      barrier: spot * 1.3,
      barrierType: "up-and-out",
      rebate: 0,
    };
  }
  if (index === 3) {
    return {
      kind: "lookback",
      optionType: "call",
      style: "fixed-strike",
      strike,
      includeInitial: true,
    };
  }
  return {
    kind: "lookback",
    optionType: "call",
    style: "floating-strike",
    includeInitial: true,
  };
}

function monteCarloPayoffLabel(index: number): string {
  return [
    "European call",
    "arithmetic-average Asian call",
    "up-and-out barrier call",
    "fixed-strike lookback call",
    "two-asset basket call",
    "floating-strike lookback call",
  ][index] ?? "floating-strike lookback call";
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
  }).format(value);
}

function percentage(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
