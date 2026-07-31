import type { PortfolioCaseId } from "./contracts";

export class PortfolioLabEngineCancelledError extends Error {
  constructor() {
    super("The portfolio-lab run was cancelled.");
    this.name = "PortfolioLabEngineCancelledError";
  }
}

export class PortfolioLabNumericalError extends Error {
  readonly caseId: PortfolioCaseId;
  readonly location?: {
    readonly pathIndex?: number;
    readonly stepIndex?: number;
    readonly quantity?: string;
  };

  constructor(
    caseId: PortfolioCaseId,
    message: string,
    location?: PortfolioLabNumericalError["location"],
  ) {
    super(message);
    this.name = "PortfolioLabNumericalError";
    this.caseId = caseId;
    this.location = location;
  }
}
