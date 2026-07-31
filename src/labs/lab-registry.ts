export const LAB_REGISTRY = [
  {
    id: "portfolio-projection",
    defaultLesson: "accumulation",
    number: "I",
    title: "Portfolio projection",
    subtitle: "Market paths and life-cycle cash flows",
    indexSubtitle: "Paths, regimes, volatility, jumps & retirement",
    question: "How can the order and shape of uncertain returns change a financial path?",
    introduction: "Separate market dynamics from portfolio accounting, then ask how regimes, variance, tails, dependence, and withdrawals change the range of paths.",
  },
  {
    id: "portfolio-construction",
    defaultLesson: "mean-variance",
    number: "II",
    title: "Portfolio construction",
    subtitle: "From beliefs and covariance to allocation",
    indexSubtitle: "Allocation as a mathematical trade-off",
    question: "How do return beliefs, covariance, and constraints become portfolio weights?",
    introduction: "Study allocations as constrained mathematical objects. Compare capital weights with the risk and assumptions that produced them.",
  },
  {
    id: "risk",
    defaultLesson: "var-cvar",
    number: "III",
    title: "Risk",
    subtitle: "Loss tails, attribution, and honest backtests",
    indexSubtitle: "Loss tails, attribution & backtesting",
    question: "What does a risk number mean, and how can we tell when it fails?",
    introduction: "Define loss first, keep estimation windows separate from tests, and distinguish a threshold from the severity beyond it.",
  },
  {
    id: "derivatives",
    defaultLesson: "black-scholes",
    number: "IV",
    title: "Derivatives",
    subtitle: "Analytical, tree, and pathwise valuation",
    indexSubtitle: "Prices, trees, paths & option strategies",
    question: "How do assumptions about time and uncertainty become an option value?",
    introduction: "Price the same European contract three ways before moving into path dependence, stochastic volatility, and composed strategies.",
  },
  {
    id: "rates-credit",
    defaultLesson: "vasicek",
    number: "V",
    title: "Rates & credit",
    subtitle: "Discounting, curves, and default mechanisms",
    indexSubtitle: "Short rates, curves & two views of default",
    question: "How do rates and default mechanisms shape future cash-flow values?",
    introduction: "Keep short rates, yields, spreads, survival, and structural default distinct—even when every value is represented by a number.",
  },
  {
    id: "trading",
    defaultLesson: "ornstein-uhlenbeck",
    number: "VI",
    title: "Trading mechanics",
    subtitle: "Spreads, books, agents, and execution cost",
    indexSubtitle: "Spreads, order flow, agents & execution",
    question: "How do orders and trading costs turn intentions into market outcomes?",
    introduction: "Move from a mean-reverting signal into deterministic order matching, then examine how agent rules and impact assumptions shape outcomes.",
  },
] as const;

export type LabId = (typeof LAB_REGISTRY)[number]["id"];

export const LAB_IDS = LAB_REGISTRY.map(({ id }) => id) as readonly LabId[];

export const DEFAULT_LESSONS = Object.fromEntries(
  LAB_REGISTRY.map(({ id, defaultLesson }) => [id, defaultLesson]),
) as Readonly<Record<LabId, string>>;
