import construction from "../../docs/models/construction.md?raw";
import derivatives from "../../docs/models/derivatives.md?raw";
import portfolioMarket from "../../docs/models/portfolio-market.md?raw";
import ratesCredit from "../../docs/models/rates-credit.md?raw";
import riskRetirement from "../../docs/models/risk-retirement.md?raw";
import trading from "../../docs/models/trading.md?raw";

const NOTES: Readonly<Record<string, string>> = {
  "/docs/models/construction.md": construction,
  "/docs/models/derivatives.md": derivatives,
  "/docs/models/portfolio-market.md": portfolioMarket,
  "/docs/models/rates-credit.md": ratesCredit,
  "/docs/models/risk-retirement.md": riskRetirement,
  "/docs/models/trading.md": trading,
};

export function modelNoteFor(path: string): string {
  return NOTES[path.split("#")[0]] ?? "Model note unavailable.";
}
