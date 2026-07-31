import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type MarketCase,
  type PortfolioCaseSummary,
  type PortfolioLabRequest,
  type PortfolioLabResult,
  type PortfolioLabRun,
} from "./contracts";
import { createLegacyPortfolioLabRunner } from "./legacy-runner";

const BASELINE_CASE_ID = asPortfolioCaseId("baseline");
const REGIMES_CASE_ID = asPortfolioCaseId("regimes");
const CONSERVATIVE_CASE_ID = asPortfolioCaseId("conservative");

const BASE_MARKET = {
  stocks: { annualDrift: 0.08, annualVolatility: 0.18 },
  bonds: { annualDrift: 0.04, annualVolatility: 0.07 },
  correlation: 0.15,
} as const;

const BASELINE_CASE = {
  id: BASELINE_CASE_ID,
  label: "Baseline",
  model: {
    contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
    kind: "gbm",
    market: BASE_MARKET,
  },
} as const satisfies MarketCase;

const REGIMES_CASE = {
  id: REGIMES_CASE_ID,
  label: "Regimes",
  model: {
    contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
    kind: "hmm",
    regimes: {
      bull: BASE_MARKET,
      bear: {
        stocks: { annualDrift: -0.12, annualVolatility: 0.3 },
        bonds: { annualDrift: 0.02, annualVolatility: 0.1 },
        correlation: 0.35,
      },
      sideways: {
        stocks: { annualDrift: 0.02, annualVolatility: 0.12 },
        bonds: { annualDrift: 0.03, annualVolatility: 0.06 },
        correlation: 0.1,
      },
    },
    transitionMatrix: {
      bull: { bull: 0.9, bear: 0.05, sideways: 0.05 },
      bear: { bull: 0.1, bear: 0.8, sideways: 0.1 },
      sideways: { bull: 0.2, bear: 0.1, sideways: 0.7 },
    },
    initialStateProbabilities: {
      bull: 0.5,
      bear: 0.2,
      sideways: 0.3,
    },
  },
} as const satisfies MarketCase;

const CONSERVATIVE_CASE = {
  id: CONSERVATIVE_CASE_ID,
  label: "Conservative",
  model: {
    contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
    kind: "gbm",
    market: {
      stocks: { annualDrift: 0.06, annualVolatility: 0.14 },
      bonds: { annualDrift: 0.035, annualVolatility: 0.05 },
      correlation: 0.1,
    },
  },
} as const satisfies MarketCase;

const BASE_REQUEST = {
  contract: PORTFOLIO_LAB_CONTRACT.request,
  plan: {
    initialCapital: 50_000,
    contributionPerStep: 1_000,
    targetWeights: { stocks: 0.7, bonds: 0.3 },
    rebalance: { kind: "periodic", everySteps: 1 },
    annualInflationRate: 0.025,
    targetValue: 1_000_000,
  },
  primaryCaseId: BASELINE_CASE_ID,
  cases: [BASELINE_CASE, REGIMES_CASE, CONSERVATIVE_CASE],
  execution: {
    seed: 8_291,
    paths: 8,
    steps: 6,
    stepYears: 1 / 12,
  },
} as const satisfies PortfolioLabRequest;

describe("portfolio-lab case invariants", () => {
  it("keeps every case result stable when cases are reordered", async () => {
    const runner = createLegacyPortfolioLabRunner();
    const original = await runSuccessfully(runner.run(BASE_REQUEST).outcome);
    const reorderedRequest = {
      ...BASE_REQUEST,
      cases: [CONSERVATIVE_CASE, BASELINE_CASE, REGIMES_CASE],
    } satisfies PortfolioLabRequest;
    const reordered = await runSuccessfully(
      runner.run(reorderedRequest).outcome,
    );

    expect(reordered.primary).toEqual(original.primary);
    expect(indexSummariesById(reordered)).toEqual(indexSummariesById(original));
    expect(reordered.comparisons.map(({ id }) => id)).toEqual([
      CONSERVATIVE_CASE_ID,
      REGIMES_CASE_ID,
    ]);
  });

  it("keeps existing case results stable when a comparison is added", async () => {
    const runner = createLegacyPortfolioLabRunner();
    const originalRequest = {
      ...BASE_REQUEST,
      cases: [BASELINE_CASE, REGIMES_CASE],
    } satisfies PortfolioLabRequest;
    const original = await runSuccessfully(
      runner.run(originalRequest).outcome,
    );
    const extendedRequest = {
      ...BASE_REQUEST,
      cases: [CONSERVATIVE_CASE, BASELINE_CASE, REGIMES_CASE],
    } satisfies PortfolioLabRequest;
    const extended = await runSuccessfully(
      runner.run(extendedRequest).outcome,
    );

    expect(extended.primary).toEqual(original.primary);
    expect(indexSummariesById(extended)[REGIMES_CASE_ID]).toEqual(
      indexSummariesById(original)[REGIMES_CASE_ID],
    );
    expect(extended.comparisons.map(({ id }) => id)).toEqual([
      CONSERVATIVE_CASE_ID,
      REGIMES_CASE_ID,
    ]);
  });
});

async function runSuccessfully(
  outcome: PortfolioLabRun["outcome"],
): Promise<PortfolioLabResult> {
  const settled = await outcome;
  expect(settled.ok).toBe(true);

  if (!settled.ok) {
    throw new Error(settled.problem.message);
  }

  return settled.result;
}

function indexSummariesById(
  result: PortfolioLabResult,
): Record<string, PortfolioCaseSummary> {
  return Object.fromEntries(
    [toSummary(result.primary), ...result.comparisons].map((summary) => [
      summary.id,
      summary,
    ]),
  );
}

function toSummary(
  detail: PortfolioLabResult["primary"],
): PortfolioCaseSummary {
  const shared = {
    id: detail.id,
    label: detail.label,
    metrics: detail.metrics,
  };

  if (detail.model === "gbm") {
    return {
      ...shared,
      model: "gbm",
      modelContract: detail.modelContract,
    };
  }

  return {
    ...shared,
    model: "hmm",
    modelContract: detail.modelContract,
  };
}
