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
import { InPageLink } from "../components/InPageLink";
import { usePageFocus } from "../hooks/usePageFocus";
import { useRef } from "react";
import { LABS } from "./catalog";
import { labHref, type LabId } from "./routes";

const LAB_ICONS: Readonly<Record<LabId, typeof Waves>> = {
  "portfolio-projection": Waves,
  "portfolio-construction": Boxes,
  risk: BarChart3,
  derivatives: BookMarked,
  "rates-credit": Landmark,
  trading: CandlestickChart,
};

export function LabIndex() {
  const mainRef = useRef<HTMLElement>(null);
  usePageFocus("home", mainRef);
  return (
    <>
      <InPageLink className="skip-link" targetId="lab-index">
        Skip to laboratory index
      </InPageLink>
      <div className="app-shell atlas-shell">
        <LabMasthead />
        <main id="lab-index" ref={mainRef} tabIndex={-1}>
          <section className="atlas-opening">
            <div className="opening__kicker">
              <span>
                {LABS.length} laboratories · {LABS.reduce(
                  (total, lab) => total + lab.lessonIds.length,
                  0,
                )} guided chapters
              </span>
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
              {LABS.map((lab) => {
                const Icon = LAB_ICONS[lab.id];
                return (
                  <li key={lab.id}>
                    <a href={labHref(lab.id)} className="atlas-entry">
                      <span className="atlas-entry__number">{lab.number}</span>
                      <span className="atlas-entry__title">
                        <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
                        <span>
                          <strong>{lab.title}</strong>
                          <small>{lab.indexSubtitle}</small>
                        </span>
                      </span>
                      <span className="atlas-entry__question">{lab.question}</span>
                      <span className="atlas-entry__meta">
                        {lab.lessonIds.length} chapters
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
