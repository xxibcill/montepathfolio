import { DEFAULT_HMM_MODEL } from "../lib/defaults";
import { REGIME_LABELS } from "../lib/regimes";
import type { PortfolioProjectionRegime } from "../types/portfolio-projection";

const WIDTH = 960;
const HEIGHT = 270;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 218;
const history = DEFAULT_HMM_MODEL.history ?? [];

function buildPricePath(): string {
  const prices = history.map((observation) => observation.normalizedPrice);
  if (prices.length === 0) return "";
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = Math.max(1, maximum - minimum);

  return history
    .map((observation, index) => {
      const x = (index / Math.max(1, history.length - 1)) * WIDTH;
      const y =
        PLOT_BOTTOM -
        ((observation.normalizedPrice - minimum) / range) *
          (PLOT_BOTTOM - PLOT_TOP);

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildSegments() {
  const segments: Array<{
    start: number;
    end: number;
    state: PortfolioProjectionRegime;
  }> = [];

  for (const [index, observation] of history.entries()) {
    const state: PortfolioProjectionRegime = observation.state;
    const previous = segments.at(-1);
    if (previous?.state === state) {
      previous.end = index;
    } else {
      segments.push({ start: index, end: index, state });
    }
  }

  return segments;
}

const timelineTicks = history
  .map((observation, index) => ({ ...observation, index }))
  .filter((observation) => observation.date.endsWith("-01"));

export function RegimeTimeline() {
  const pricePath = buildPricePath();
  const segments = buildSegments();
  const stepWidth = WIDTH / Math.max(1, history.length - 1);

  return (
    <section className="regime-timeline" aria-labelledby="regime-timeline-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Model output sample</p>
          <h2 id="regime-timeline-title">Regime timeline</h2>
        </div>
        <span>Weekly-feature HMM</span>
      </div>

      <figure>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby="regime-timeline-svg-title regime-timeline-svg-description"
          preserveAspectRatio="xMidYMid meet"
        >
          <title id="regime-timeline-svg-title">
            Illustrative normalized market history with hidden regime bands
          </title>
          <desc id="regime-timeline-svg-description">
            A normalized price line from 2018 to 2025 appears over patterned and
            colored bull, bear, and sideways regime bands. This sample demonstrates
            the JSON contract and is not fitted to live data.
          </desc>
          <defs>
            <pattern id="regime-pattern-bull" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect className="regime-pattern__base regime-pattern__base--bull" width="12" height="12" />
              <path className="regime-pattern__mark" d="M-3 12 12-3M3 15 15 3" />
            </pattern>
            <pattern id="regime-pattern-bear" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect className="regime-pattern__base regime-pattern__base--bear" width="10" height="10" />
              <path className="regime-pattern__mark" d="M0 0 10 10M10 0 0 10" />
            </pattern>
            <pattern id="regime-pattern-sideways" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect className="regime-pattern__base regime-pattern__base--sideways" width="10" height="10" />
              <circle className="regime-pattern__dot" cx="5" cy="5" r="1.7" />
            </pattern>
          </defs>
          {segments.map((segment, index) => {
            const x = Math.max(0, segment.start * stepWidth - stepWidth / 2);
            const end = Math.min(
              WIDTH,
              segment.end * stepWidth + stepWidth / 2,
            );

            return (
              <rect
                className={`regime-timeline__band regime-timeline__band--${segment.state}`}
                x={x}
                y={0}
                width={Math.max(1, end - x)}
                height={PLOT_BOTTOM}
                key={`${segment.state}-${index}`}
              />
            );
          })}
          {[0.25, 0.5, 0.75].map((position) => (
            <line
              className="regime-timeline__grid"
              x1={0}
              y1={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * position}
              x2={WIDTH}
              y2={PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * position}
              key={position}
            />
          ))}
          <path className="regime-timeline__price" d={pricePath} />
          {timelineTicks.map((tick) => {
            const x = (tick.index / Math.max(1, history.length - 1)) * WIDTH;
            return (
              <g key={tick.date}>
                <line
                  className="regime-timeline__tick"
                  x1={x}
                  y1={PLOT_BOTTOM}
                  x2={x}
                  y2={PLOT_BOTTOM + 8}
                />
                <text
                  className="regime-timeline__tick-label"
                  x={x}
                  y={HEIGHT - 14}
                  textAnchor={tick.index === 0 ? "start" : "middle"}
                >
                  {tick.date.slice(0, 4)}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption>
          <span className="regime-timeline__legend" aria-label="Regime legend">
            {(["bull", "bear", "sideways"] as const).map((regime) => (
              <span data-regime={regime} key={regime}>
                <i aria-hidden="true" />
                {REGIME_LABELS[regime]}
              </span>
            ))}
          </span>
          <span>
            Illustrative history bundled to demonstrate the training-service
            JSON contract; replace it with fitted observations in production.
          </span>
        </figcaption>
        <details className="regime-timeline__data">
          <summary>Read the regime sequence as text</summary>
          <div>
            <table>
              <caption>Illustrative regime segments in chronological order</caption>
              <thead>
                <tr><th>Segment</th><th>Start</th><th>End</th><th>State</th></tr>
              </thead>
              <tbody>
                {segments.map((segment, index) => (
                  <tr key={`${segment.state}-data-${index}`}>
                    <td>{index + 1}</td>
                    <td>{history[segment.start]?.date}</td>
                    <td>{history[segment.end]?.date}</td>
                    <td>{REGIME_LABELS[segment.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
    </section>
  );
}
