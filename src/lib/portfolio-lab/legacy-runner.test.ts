import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type PortfolioLabOutcome,
  type PortfolioLabRequest,
} from "./contracts";
import {
  LEGACY_PORTFOLIO_LAB_LIMITS,
  createLegacyPortfolioLabRunner,
} from "./legacy-runner";

const BASE_CASE_ID = asPortfolioCaseId("base");
const BASE_MARKET = {
  stocks: { annualDrift: 0.08, annualVolatility: 0.18 },
  bonds: { annualDrift: 0.04, annualVolatility: 0.07 },
  correlation: 0.15,
} as const;
const BASE_CASE = {
  id: BASE_CASE_ID,
  label: "Base",
  model: {
    contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
    kind: "gbm",
    market: BASE_MARKET,
  },
} as const;
const BASE_REQUEST = {
  contract: PORTFOLIO_LAB_CONTRACT.request,
  plan: {
    initialCapital: 1_000,
    contributionPerStep: 100,
    targetWeights: { stocks: 0.6, bonds: 0.4 },
    rebalance: { kind: "never" },
    annualInflationRate: 0.02,
    targetValue: 2_000,
  },
  primaryCaseId: BASE_CASE_ID,
  cases: [BASE_CASE],
  execution: {
    seed: 42,
    paths: 4,
    steps: 2,
    stepYears: 1 / 12,
  },
} as const satisfies PortfolioLabRequest;

describe("legacy portfolio-lab runner", () => {
  it("turns malformed runtime input into a structured problem", async () => {
    const outcome = createLegacyPortfolioLabRunner().run(
      null as unknown as PortfolioLabRequest,
    ).outcome;

    await expect(outcome).resolves.toMatchObject({
      ok: false,
      problem: {
        contract: PORTFOLIO_LAB_CONTRACT.problem,
        code: "INVALID_REQUEST",
      },
    });
  });

  it("rejects unsupported request and model contract versions", async () => {
    const requestContractOutcome = await run({
      ...BASE_REQUEST,
      contract: "portfolio-lab/request@999",
    });
    const modelContractOutcome = await run({
      ...BASE_REQUEST,
      cases: [
        {
          ...BASE_CASE,
          model: {
            ...BASE_CASE.model,
            contract: "portfolio-lab/model/gbm@999",
          },
        },
      ],
    });

    expect(requestContractOutcome).toMatchObject({
      ok: false,
      problem: {
        code: "UNSUPPORTED_CONTRACT",
        path: ["contract"],
        receivedContract: "portfolio-lab/request@999",
        supportedContracts: [PORTFOLIO_LAB_CONTRACT.request],
      },
    });
    expect(modelContractOutcome).toMatchObject({
      ok: false,
      problem: {
        code: "UNSUPPORTED_CONTRACT",
        path: ["cases", 0, "model", "contract"],
        receivedContract: "portfolio-lab/model/gbm@999",
        supportedContracts: [PORTFOLIO_LAB_MODEL_CONTRACT.gbm],
      },
    });
  });

  it("reports every invalid portfolio and execution field", async () => {
    const outcome = await run({
      ...BASE_REQUEST,
      plan: {
        ...BASE_REQUEST.plan,
        targetWeights: { stocks: 0.6, bonds: 0.9 },
      },
      primaryCaseId: asPortfolioCaseId(""),
      cases: [{ ...BASE_CASE, id: asPortfolioCaseId("") }],
      execution: {
        ...BASE_REQUEST.execution,
        seed: 1.5,
        steps: 1.5,
      },
    });

    expect(invalidIssues(outcome)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING",
          path: ["cases", 0, "id"],
        }),
        expect.objectContaining({
          code: "OUT_OF_RANGE",
          path: ["plan", "targetWeights"],
        }),
        expect.objectContaining({
          code: "NOT_INTEGER",
          path: ["execution", "seed"],
        }),
        expect.objectContaining({
          code: "NOT_INTEGER",
          path: ["execution", "steps"],
        }),
      ]),
    );
  });

  it.each([
    {
      name: "cases",
      request: {
        ...BASE_REQUEST,
        cases: Array.from(
          { length: LEGACY_PORTFOLIO_LAB_LIMITS.cases + 1 },
          (_, index) => ({
            ...BASE_CASE,
            id: asPortfolioCaseId(`case-${index}`),
          }),
        ),
      },
      resource: "CASES",
    },
    {
      name: "paths",
      request: {
        ...BASE_REQUEST,
        execution: {
          ...BASE_REQUEST.execution,
          paths: LEGACY_PORTFOLIO_LAB_LIMITS.paths + 1,
        },
      },
      resource: "PATHS",
    },
    {
      name: "steps",
      request: {
        ...BASE_REQUEST,
        execution: {
          ...BASE_REQUEST.execution,
          steps: LEGACY_PORTFOLIO_LAB_LIMITS.steps + 1,
        },
      },
      resource: "STEPS",
    },
    {
      name: "estimated bytes",
      request: {
        ...BASE_REQUEST,
        execution: {
          ...BASE_REQUEST.execution,
          paths: LEGACY_PORTFOLIO_LAB_LIMITS.paths,
          steps: LEGACY_PORTFOLIO_LAB_LIMITS.steps,
        },
      },
      resource: "ESTIMATED_BYTES",
    },
  ])("returns a typed resource problem for $name", async ({ request, resource }) => {
    const outcome = await run(request);

    expect(outcome).toMatchObject({
      ok: false,
      problem: {
        code: "RESOURCE_LIMIT",
        resource,
      },
    });
  });

  it("classifies simulation overflow as a numerical failure", async () => {
    const outcome = await run({
      ...BASE_REQUEST,
      cases: [
        {
          ...BASE_CASE,
          model: {
            ...BASE_CASE.model,
            market: {
              ...BASE_MARKET,
              stocks: {
                ...BASE_MARKET.stocks,
                annualDrift: Number.MAX_VALUE,
              },
            },
          },
        },
      ],
    });

    expect(outcome).toMatchObject({
      ok: false,
      problem: {
        code: "NUMERICAL_FAILURE",
        caseId: BASE_CASE_ID,
      },
    });
  });

  it("cancels work after execution has started", async () => {
    const operation = createLegacyPortfolioLabRunner().run({
      ...BASE_REQUEST,
      execution: {
        ...BASE_REQUEST.execution,
        paths: 64,
        steps: 600,
      },
    });
    setTimeout(() => operation.cancel(), 0);

    await expect(operation.outcome).resolves.toMatchObject({
      ok: false,
      problem: {
        code: "CANCELLED",
      },
    });
  });
});

async function run(request: unknown): Promise<PortfolioLabOutcome> {
  return createLegacyPortfolioLabRunner().run(
    request as PortfolioLabRequest,
  ).outcome;
}

function invalidIssues(outcome: PortfolioLabOutcome) {
  if (outcome.ok || outcome.problem.code !== "INVALID_REQUEST") {
    throw new Error("Expected an invalid-request problem.");
  }

  return outcome.problem.issues;
}
