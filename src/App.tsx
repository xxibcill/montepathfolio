import { useEffect, useMemo, useState } from "react";
import { BookOpen, RotateCcw } from "lucide-react";
import { ComparisonNote } from "./components/ComparisonNote";
import { DistributionChart } from "./components/DistributionChart";
import { DrawdownChart } from "./components/DrawdownChart";
import { LoadingChart } from "./components/LoadingChart";
import { MetricStrip } from "./components/MetricStrip";
import { PathChart } from "./components/PathChart";
import { ScenarioControls } from "./components/ScenarioControls";
import {
  DEFAULT_INPUTS,
  loadStoredInputs,
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
    a.stocks.expectedReturn === b.stocks.expectedReturn &&
    a.stocks.volatility === b.stocks.volatility &&
    a.bonds.expectedReturn === b.bonds.expectedReturn &&
    a.bonds.volatility === b.bonds.volatility &&
    a.correlation === b.correlation &&
    a.rebalanceFrequency === b.rebalanceFrequency &&
    a.inflationRate === b.inflationRate &&
    a.targetValue === b.targetValue
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
              <span>Monte Carlo planning lab</span>
              <span>Two assets · monthly steps</span>
            </div>
            <div className="opening__copy">
              <h1>
                See the futures
                <br />
                <em>between</em> best and worst.
              </h1>
              <p>
                Build a stock-and-bond portfolio, then stress the assumptions.
                The model maps what could happen—and explains the trade you made.
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
                Each month, stock and bond values follow geometric Brownian
                motion using your return, volatility, and correlation
                assumptions. Contributions arrive monthly and the portfolio
                rebalances on the schedule you choose. Drawdown uses a parallel,
                cash-flow-neutral index so deposits cannot hide market losses.
              </p>
              <p>
                Real values discount the median outcome by your inflation rate.
                The model omits taxes, fees, fat-tailed returns, and changing
                market regimes. Results are educational and are not financial
                advice.
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
