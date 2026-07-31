import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type PortfolioLabOutcome,
  type PortfolioLabRequest,
} from "./contracts";
import {
  PORTFOLIO_LAB_LIMITS,
  createInProcessPortfolioLabRunner,
} from "./in-process-runner";

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

describe("in-process portfolio-lab runner", () => {
  it("turns malformed runtime input into a structured problem", async () => {
    const outcome = createInProcessPortfolioLabRunner().run(
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

  it("executes only the requested GBM case through the native engine", async () => {
    const outcome = await run(BASE_REQUEST);

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        primary: {
          id: BASE_CASE_ID,
          model: "gbm",
        },
        comparisons: [],
        provenance: {
          engineVersion: "portfolio-lab-engine@1",
        },
      },
    });
  });

  it("supports native time grids and periodic rebalancing", async () => {
    const outcome = await run({
      ...BASE_REQUEST,
      plan: {
        ...BASE_REQUEST.plan,
        initialCapital: 1_000,
        contributionPerStep: 0,
        targetWeights: { stocks: 0.5, bonds: 0.5 },
        rebalance: { kind: "periodic", everySteps: 2 },
      },
      cases: [
        {
          ...BASE_CASE,
          model: {
            ...BASE_CASE.model,
            market: {
              stocks: { annualDrift: Math.log(2), annualVolatility: 0 },
              bonds: { annualDrift: 0, annualVolatility: 0 },
              correlation: 0,
            },
          },
        },
      ],
      execution: {
        ...BASE_REQUEST.execution,
        paths: 1,
        steps: 2,
        stepYears: 0.5,
      },
    });

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        provenance: {
          timeGrid: {
            steps: 2,
            stepYears: 0.5,
          },
        },
      },
    });
    if (!outcome.ok) {
      throw new Error(outcome.problem.message);
    }

    const wealth = outcome.result.primary.samples[0].wealth.values;
    expect(wealth).toHaveLength(3);
    expect(wealth[0]).toBe(1_000);
    expect(wealth[1]).toBeCloseTo(1_207.1067811865476, 12);
    expect(wealth[2]).toBeCloseTo(1_500, 12);
  });

  it("treats HMM transition matrices as per-step on native time grids", async () => {
    const hmmCaseId = asPortfolioCaseId("native-hmm");
    const outcome = await run({
      ...BASE_REQUEST,
      plan: {
        ...BASE_REQUEST.plan,
        initialCapital: 1_000,
        contributionPerStep: 0,
        targetWeights: { stocks: 1, bonds: 0 },
      },
      primaryCaseId: hmmCaseId,
      cases: [
        {
          id: hmmCaseId,
          label: "Native HMM",
          model: {
            contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
            kind: "hmm",
            regimes: {
              bull: {
                stocks: { annualDrift: 0, annualVolatility: 0 },
                bonds: { annualDrift: 0, annualVolatility: 0 },
                correlation: 0,
              },
              bear: {
                stocks: {
                  annualDrift: Math.log(4),
                  annualVolatility: 0,
                },
                bonds: { annualDrift: 0, annualVolatility: 0 },
                correlation: 0,
              },
              sideways: {
                stocks: { annualDrift: 0, annualVolatility: 0 },
                bonds: { annualDrift: 0, annualVolatility: 0 },
                correlation: 0,
              },
            },
            transitionMatrix: {
              bull: { bull: 0, bear: 1, sideways: 0 },
              bear: { bull: 0, bear: 1, sideways: 0 },
              sideways: { bull: 0, bear: 0, sideways: 1 },
            },
            initialStateProbabilities: {
              bull: 1,
              bear: 0,
              sideways: 0,
            },
          },
        },
      ],
      execution: {
        ...BASE_REQUEST.execution,
        paths: 1,
        steps: 1,
        stepYears: 0.5,
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.problem.message);
    }

    expect(outcome.result.primary.model).toBe("hmm");
    expect(outcome.result.primary.samples[0].wealth.values).toEqual([
      1_000,
      2_000,
    ]);
    if (outcome.result.primary.model === "hmm") {
      expect(
        outcome.result.primary.diagnostics.sampledStatePaths[0].states,
      ).toEqual(["bull", "bear"]);
    }
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
          { length: PORTFOLIO_LAB_LIMITS.cases + 1 },
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
          paths: PORTFOLIO_LAB_LIMITS.paths + 1,
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
          steps: PORTFOLIO_LAB_LIMITS.steps + 1,
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
          paths: PORTFOLIO_LAB_LIMITS.paths,
          steps: PORTFOLIO_LAB_LIMITS.steps,
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

  it("keeps aggregate means finite when every path value is finite", async () => {
    const outcome = await run({
      ...BASE_REQUEST,
      plan: {
        ...BASE_REQUEST.plan,
        initialCapital: 1e308,
        contributionPerStep: 0,
      },
      cases: [
        {
          ...BASE_CASE,
          model: {
            ...BASE_CASE.model,
            market: {
              stocks: { annualDrift: 0, annualVolatility: 0 },
              bonds: { annualDrift: 0, annualVolatility: 0 },
              correlation: 0,
            },
          },
        },
      ],
      execution: {
        ...BASE_REQUEST.execution,
        paths: 4,
        steps: 1,
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.problem.message);
    }

    expect(
      outcome.result.primary.metrics.wealth.meanTerminalValue,
    ).toBe(1e308);
  });

  it("classifies derived-metric overflow as a numerical failure", async () => {
    const outcome = await run({
      ...BASE_REQUEST,
      plan: {
        ...BASE_REQUEST.plan,
        annualInflationRate: -0.5,
      },
      cases: [
        {
          ...BASE_CASE,
          model: {
            ...BASE_CASE.model,
            market: {
              stocks: { annualDrift: 0, annualVolatility: 0 },
              bonds: { annualDrift: 0, annualVolatility: 0 },
              correlation: 0,
            },
          },
        },
      ],
      execution: {
        ...BASE_REQUEST.execution,
        paths: 1,
        steps: 1,
        stepYears: Number.MAX_VALUE,
      },
    });

    expect(outcome).toMatchObject({
      ok: false,
      problem: {
        code: "NUMERICAL_FAILURE",
        caseId: BASE_CASE_ID,
        location: {
          quantity: "inflationFactor",
        },
      },
    });
  });

  it("cancels work after execution has started", async () => {
    const operation = createInProcessPortfolioLabRunner().run({
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
  return createInProcessPortfolioLabRunner().run(
    request as PortfolioLabRequest,
  ).outcome;
}

function invalidIssues(outcome: PortfolioLabOutcome) {
  if (outcome.ok || outcome.problem.code !== "INVALID_REQUEST") {
    throw new Error("Expected an invalid-request problem.");
  }

  return outcome.problem.issues;
}
