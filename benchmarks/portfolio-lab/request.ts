import { DEFAULT_INPUTS } from "../../src/lib/defaults";
import {
  PORTFOLIO_LAB_CONTRACT,
  PORTFOLIO_LAB_MODEL_CONTRACT,
  asPortfolioCaseId,
  type HmmModelSpec,
  type PortfolioLabRequest,
} from "../../src/lib/portfolio-lab/contracts";

const GBM_CASE_ID = asPortfolioCaseId("benchmark/gbm");
const HMM_CASE_ID = asPortfolioCaseId("benchmark/hmm");
const MONTHS_PER_YEAR = 12;

const hmmModel: HmmModelSpec = {
  contract: PORTFOLIO_LAB_MODEL_CONTRACT.hmm,
  kind: "hmm",
  regimes: {
    bull: toMarketAssumptions("bull"),
    bear: toMarketAssumptions("bear"),
    sideways: toMarketAssumptions("sideways"),
  },
  transitionMatrix: DEFAULT_INPUTS.hmm.transitionMatrix,
  initialStateProbabilities:
    DEFAULT_INPUTS.hmm.currentStateProbabilities,
};

/** The current app default: two cases, 1,000 paths, and 25 monthly years. */
export const PORTFOLIO_LAB_BASELINE_REQUEST = {
  contract: PORTFOLIO_LAB_CONTRACT.request,
  plan: {
    initialCapital: DEFAULT_INPUTS.initialCapital,
    contributionPerStep: DEFAULT_INPUTS.monthlyContribution,
    targetWeights: {
      stocks: DEFAULT_INPUTS.stockAllocation,
      bonds: 1 - DEFAULT_INPUTS.stockAllocation,
    },
    rebalance: { kind: "periodic", everySteps: MONTHS_PER_YEAR },
    annualInflationRate: DEFAULT_INPUTS.inflationRate,
    targetValue: DEFAULT_INPUTS.targetValue,
  },
  primaryCaseId: HMM_CASE_ID,
  cases: [
    {
      id: GBM_CASE_ID,
      label: "Standard Monte Carlo",
      model: {
        contract: PORTFOLIO_LAB_MODEL_CONTRACT.gbm,
        kind: "gbm",
        market: {
          stocks: {
            annualDrift: DEFAULT_INPUTS.stocks.expectedReturn,
            annualVolatility: DEFAULT_INPUTS.stocks.volatility,
          },
          bonds: {
            annualDrift: DEFAULT_INPUTS.bonds.expectedReturn,
            annualVolatility: DEFAULT_INPUTS.bonds.volatility,
          },
          correlation: DEFAULT_INPUTS.correlation,
        },
      },
    },
    {
      id: HMM_CASE_ID,
      label: "Regime switching",
      model: hmmModel,
    },
  ],
  execution: {
    seed: DEFAULT_INPUTS.seed,
    paths: 1_000,
    steps: DEFAULT_INPUTS.horizonYears * MONTHS_PER_YEAR,
    stepYears: 1 / MONTHS_PER_YEAR,
  },
} as const satisfies PortfolioLabRequest;

function toMarketAssumptions(
  regime: keyof typeof DEFAULT_INPUTS.hmm.regimes,
): HmmModelSpec["regimes"][typeof regime] {
  const assumptions = DEFAULT_INPUTS.hmm.regimes[regime];
  return {
    stocks: {
      annualDrift: assumptions.stocks.expectedReturn,
      annualVolatility: assumptions.stocks.volatility,
    },
    bonds: {
      annualDrift: assumptions.bonds.expectedReturn,
      annualVolatility: assumptions.bonds.volatility,
    },
    correlation: assumptions.correlation,
  };
}
