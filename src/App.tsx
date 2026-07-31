import { useEffect, useMemo, useState } from "react";
import { BookOpen, RotateCcw } from "lucide-react";
import { ComparisonNote } from "./components/ComparisonNote";
import { DistributionChart } from "./components/DistributionChart";
import { DrawdownChart } from "./components/DrawdownChart";
import { LoadingChart } from "./components/LoadingChart";
import { MetricStrip } from "./components/MetricStrip";
import { ModelComparison } from "./components/ModelComparison";
import { PathChart } from "./components/PathChart";
import { RegimePathOverlay } from "./components/RegimePathOverlay";
import { RegimeSnapshot } from "./components/RegimeSnapshot";
import { RegimeTimeline } from "./components/RegimeTimeline";
import { ScenarioControls } from "./components/ScenarioControls";
import {
  DEFAULT_INPUTS,
  loadStoredInputs,
  REGIME_ORDER,
  STORAGE_KEY,
} from "./lib/defaults";
import { useSimulation } from "./hooks/useSimulation";
import type { SimulationInputs } from "./types/simulation";

function inputsMatch(a: SimulationInputs, b: SimulationInputs): boolean {
  return (
    a.initialCapital === b.initialCapital &&
    a.monthlyContribution === b.monthlyContribution &&
    a.horizonYears === b.horizonYears &&
    a.stockAllocation === b.stockAllocation &&
    a.model === b.model &&
    a.stocks.expectedReturn === b.stocks.expectedReturn &&
    a.stocks.volatility === b.stocks.volatility &&
    a.bonds.expectedReturn === b.bonds.expectedReturn &&
    a.bonds.volatility === b.bonds.volatility &&
    a.correlation === b.correlation &&
    a.rebalanceFrequency === b.rebalanceFrequency &&
    a.inflationRate === b.inflationRate &&
    a.targetValue === b.targetValue &&
    REGIME_ORDER.every(
      (regime) =>
        a.hmm.regimes[regime].stocks.expectedReturn ===
          b.hmm.regimes[regime].stocks.expectedReturn &&
        a.hmm.regimes[regime].stocks.volatility ===
          b.hmm.regimes[regime].stocks.volatility &&
        a.hmm.regimes[regime].bonds.expectedReturn ===
          b.hmm.regimes[regime].bonds.expectedReturn &&
        a.hmm.regimes[regime].bonds.volatility ===
          b.hmm.regimes[regime].bonds.volatility &&
        a.hmm.regimes[regime].correlation ===
          b.hmm.regimes[regime].correlation &&
        a.hmm.currentStateProbabilities[regime] ===
          b.hmm.currentStateProbabilities[regime] &&
        REGIME_ORDER.every(
          (nextRegime) =>
            a.hmm.transitionMatrix[regime][nextRegime] ===
            b.hmm.transitionMatrix[regime][nextRegime],
        ),
    )
  );
}

function App() {
  const [inputs, setInputs] = useState<SimulationInputs>(loadStoredInputs);
  const { result, previousResult, status, error, run } = useSimulation();

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      // Storage can be unavailable in locked-down or private browsing modes.
      // The simulator remains fully functional for the current session.
    }
    const timer = window.setTimeout(() => run(inputs), 320);
    return () => window.clearTimeout(timer);
  }, [inputs, run]);

  const isDirty = useMemo(
    () => (result ? !inputsMatch(inputs, result.inputs) : false),
    [inputs, result],
  );

  const statusLabel =
    status === "running"
      ? "Running model"
      : status === "error"
        ? "Model needs attention"
        : status === "idle"
          ? "Preparing model"
          : "Model is current";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to simulation results
      </a>

      <div className="app-shell">
        <header className="masthead">
          <a className="wordmark" href="#" aria-label="Portfolio Risk Sandbox home">
            <span className="wordmark__seal" aria-hidden="true">
              PR
            </span>
            <span>
              <strong>Portfolio Risk Sandbox</strong>
              <small>Decision field note · 001</small>
            </span>
          </a>

          <div className="masthead__actions">
            <a className="text-link" href="#methodology">
              <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />
              Method
            </a>
            <span
              className={`model-status model-status--${status}`}
              role="status"
              aria-live="polite"
            >
              <span aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
        </header>

        <main id="main-content">
          <section className="opening">
            <div className="opening__kicker">
              <span>Regime-switching planning lab</span>
              <span>Three states · two assets · monthly steps</span>
            </div>
            <div className="opening__copy">
              <h1>
                Markets change.
                <br />
                Your model <em>should too.</em>
              </h1>
              <p>
                Explore what happens when persistent bull, bear, and low-growth
                regimes replace one fixed market distribution.
              </p>
            </div>
          </section>

          <div className="workbench">
            <aside className="control-rail">
              <div className="control-rail__heading">
                <div>
                  <p className="eyebrow">Your scenario</p>
                  <h2>Set the conditions</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setInputs(DEFAULT_INPUTS)}
                  aria-label="Reset scenario to defaults"
                  title="Reset scenario"
                >
                  <RotateCcw size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
              <ScenarioControls
                inputs={inputs}
                onChange={setInputs}
                isRunning={status === "running"}
                isDirty={result ? isDirty : undefined}
              />
            </aside>

            <div className="results-stage">
              {error ? (
                <div className="error-banner" role="alert">
                  <strong>The model could not finish this run.</strong>
                  <span>{error}</span>
                  <button type="button" onClick={() => run(inputs)}>
                    Run simulation again
                  </button>
                </div>
              ) : null}

              {!result ? (
                <LoadingChart />
              ) : (
                <>
                  <section className="results-intro" aria-labelledby="results-title">
                    <div>
                      <p className="eyebrow">1,000 simulated futures</p>
                      <h2 id="results-title">The range, not a promise.</h2>
                    </div>
                    <p className="results-intro__note">
                      Same seed on every run. That keeps scenario comparisons
                      fair while assumptions change.
                    </p>
                  </section>

                  <ComparisonNote
                    result={result}
                    previousResult={previousResult}
                  />

                  <RegimeSnapshot result={result} />

                  <RegimeTimeline />

                  <MetricStrip
                    result={result}
                    isRunning={status === "running"}
                  />

                  <section
                    className={`primary-visual ${status === "running" || isDirty ? "is-updating" : ""}`}
                    aria-label="Portfolio path simulation"
                  >
                    <PathChart
                      result={result}
                      targetValue={result.inputs.targetValue}
                    />
                    <RegimePathOverlay result={result} />
                  </section>

                  <div className="secondary-visuals">
                    <section className="secondary-visual">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">Where paths finish</p>
                          <h2>Terminal value distribution</h2>
                        </div>
                        <span>Nominal dollars</span>
                      </div>
                      <DistributionChart
                        result={result}
                        targetValue={result.inputs.targetValue}
                      />
                    </section>

                    <section className="secondary-visual">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">What the ride feels like</p>
                          <h2>Drawdown from prior peak</h2>
                        </div>
                        <span>Monthly</span>
                      </div>
                      <DrawdownChart result={result} />
                    </section>
                  </div>

                  <ModelComparison result={result} />
                </>
              )}
            </div>
          </div>

          <section className="methodology" id="methodology">
            <div className="methodology__number" aria-hidden="true">
              M
            </div>
            <div className="methodology__intro">
              <p className="eyebrow">Method & limits</p>
              <h2>A useful model of uncertainty, not a forecast.</h2>
            </div>
            <div className="methodology__copy">
              <p>
                Each HMM path starts from the current state probabilities, then
                moves between bull, bear, and sideways regimes using a monthly
                transition matrix. Every regime supplies its own stock and bond
                return, volatility, and correlation assumptions.
              </p>
              <p>
                Gaussian emissions and geometric compounding remain simplified.
                The model omits taxes, fees, fat tails, and retirement
                withdrawals. Treat regimes as probabilistic scenarios—not
                market timing, price prediction, or financial advice.
              </p>
            </div>
          </section>
        </main>

        <footer>
          <span>Portfolio Risk Sandbox</span>
          <span>Built to compare decisions—not predict markets.</span>
        </footer>
      </div>
    </>
  );
}

export default App;
