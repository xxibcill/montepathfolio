import {
  ArrowUpRight,
  BarChart3,
  BookMarked,
  Boxes,
  CandlestickChart,
  Landmark,
  Waves,
} from "lucide-react";
import { LabMasthead } from "../components/LabMasthead";
import { labHref, type LabId } from "./routes";

const labs: readonly {
  readonly id: LabId;
  readonly number: string;
  readonly title: string;
  readonly subtitle: string;
  readonly question: string;
  readonly chapters: number;
  readonly icon: typeof Waves;
}[] = [
  {
    id: "portfolio-projection",
    number: "I",
    title: "Portfolio projection",
    subtitle: "Paths, regimes, volatility, jumps & retirement",
    question: "How can the order and shape of uncertain returns change a financial path?",
    chapters: 9,
    icon: Waves,
  },
  {
    id: "portfolio-construction",
    number: "II",
    title: "Portfolio construction",
    subtitle: "Allocation as a mathematical trade-off",
    question: "How do return beliefs, covariance, and constraints become portfolio weights?",
    chapters: 6,
    icon: Boxes,
  },
  {
    id: "risk",
    number: "III",
    title: "Risk",
    subtitle: "Loss tails, attribution & backtesting",
    question: "What does a risk number mean, and how can we tell when it fails?",
    chapters: 2,
    icon: BarChart3,
  },
  {
    id: "derivatives",
    number: "IV",
    title: "Derivatives",
    subtitle: "Prices, trees, paths & option strategies",
    question: "How do assumptions about time and uncertainty become an option value?",
    chapters: 5,
    icon: BookMarked,
  },
  {
    id: "rates-credit",
    number: "V",
    title: "Rates & credit",
    subtitle: "Short rates, curves & two views of default",
    question: "How do rates and default mechanisms shape future cash-flow values?",
    chapters: 5,
    icon: Landmark,
  },
  {
    id: "trading",
    number: "VI",
    title: "Trading mechanics",
    subtitle: "Spreads, order flow, agents & execution",
    question: "How do orders and trading costs turn intentions into market outcomes?",
    chapters: 4,
    icon: CandlestickChart,
  },
];

export function LabIndex() {
  return (
    <>
      <a className="skip-link" href="#lab-index">
        Skip to laboratory index
      </a>
      <div className="app-shell atlas-shell">
        <LabMasthead />
        <main id="lab-index">
          <section className="atlas-opening">
            <div className="opening__kicker">
              <span>Six laboratories · thirty-one guided chapters</span>
              <span>Illustrative assumptions · deterministic experiments</span>
            </div>
            <div className="atlas-opening__grid">
              <div>
                <p className="eyebrow">A notebook for learning uncertainty</p>
                <h1>
                  Learn the math by <em>changing it.</em>
                </h1>
              </div>
              <div className="atlas-opening__aside">
                <p>
                  Each chapter begins with a question, turns one assumption at a
                  time, and checks the result against an invariant or benchmark.
                </p>
                <p className="educational-notice">
                  Educational models only. No live estimates, forecasts, or
                  investment advice.
                </p>
              </div>
            </div>
          </section>

          <section className="atlas-index" aria-labelledby="atlas-title">
            <header className="atlas-index__heading">
              <p className="eyebrow">Choose a field note</p>
              <h2 id="atlas-title">The laboratory index</h2>
            </header>
            <ol className="atlas-list">
              {labs.map((lab) => {
                const Icon = lab.icon;
                return (
                  <li key={lab.id}>
                    <a href={labHref(lab.id)} className="atlas-entry">
                      <span className="atlas-entry__number">{lab.number}</span>
                      <span className="atlas-entry__title">
                        <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
                        <span>
                          <strong>{lab.title}</strong>
                          <small>{lab.subtitle}</small>
                        </span>
                      </span>
                      <span className="atlas-entry__question">{lab.question}</span>
                      <span className="atlas-entry__meta">
                        {lab.chapters} chapters
                        <ArrowUpRight size={17} strokeWidth={1.7} aria-hidden="true" />
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="learning-method" id="learning-method">
            <div>
              <p className="eyebrow">The learning loop</p>
              <h2>Question → experiment → explanation → check.</h2>
            </div>
            <ol>
              <li><strong>Predict.</strong> Say what you expect before moving a control.</li>
              <li><strong>Run.</strong> Change one assumption so cause and effect stay legible.</li>
              <li><strong>Read.</strong> Use the chart, plain-language note, and equation together.</li>
              <li><strong>Verify.</strong> Check a benchmark, warning, or accounting identity.</li>
            </ol>
          </section>
        </main>
        <footer>
          <span>Montepathfolio</span>
          <span>Built to understand models—not to predict markets.</span>
        </footer>
      </div>
    </>
  );
}
