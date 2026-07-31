import type {
  PortfolioLabOutcome,
  PortfolioLabRequest,
} from "./contracts";

export const PORTFOLIO_LAB_WORKER_PROTOCOL =
  "portfolio-lab/worker-protocol@1" as const;

export type PortfolioLabWorkerRequest =
  | {
      readonly contract: typeof PORTFOLIO_LAB_WORKER_PROTOCOL;
      readonly kind: "run";
      readonly runId: number;
      readonly request: PortfolioLabRequest;
    }
  | {
      readonly contract: typeof PORTFOLIO_LAB_WORKER_PROTOCOL;
      readonly kind: "cancel";
      readonly runId: number;
    };

export interface PortfolioLabWorkerResponse {
  readonly contract: typeof PORTFOLIO_LAB_WORKER_PROTOCOL;
  readonly kind: "outcome";
  readonly runId: number;
  readonly outcome: PortfolioLabOutcome;
}

export function isPortfolioLabWorkerResponse(
  value: unknown,
): value is PortfolioLabWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Partial<PortfolioLabWorkerResponse>;
  return (
    response.contract === PORTFOLIO_LAB_WORKER_PROTOCOL &&
    response.kind === "outcome" &&
    Number.isSafeInteger(response.runId) &&
    typeof response.outcome === "object" &&
    response.outcome !== null &&
    typeof response.outcome.ok === "boolean"
  );
}
