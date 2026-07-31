import {
  REGIME_LABELS,
  REGIME_ORDER,
  REPRESENTATIVE_REGIME_PATH_COUNT,
} from "../lib/regimes";
import type { PortfolioProjectionResult } from "../labs/portfolio-projection-model";
import type { PortfolioProjectionRegime } from "../types/portfolio-projection";

interface RegimePathOverlayProps {
  result: PortfolioProjectionResult;
}

interface RegimeSegment {
  regime: PortfolioProjectionRegime;
  length: number;
}

function compressRegimePath(
  path: readonly PortfolioProjectionRegime[],
): RegimeSegment[] {
  const segments: RegimeSegment[] = [];

  for (const regime of path) {
    const previous = segments.at(-1);
    if (previous?.regime === regime) {
      previous.length += 1;
    } else {
      segments.push({ regime, length: 1 });
    }
  }

  return segments;
}

function summarizePath(path: readonly PortfolioProjectionRegime[]): string {
  const counts: Record<PortfolioProjectionRegime, number> = {
    bull: 0,
    bear: 0,
    sideways: 0,
  };
  for (const regime of path) counts[regime] += 1;

  return REGIME_ORDER.map(
    (regime) =>
      `${REGIME_LABELS[regime]} ${Math.round((counts[regime] / path.length) * 100)}%`,
  ).join(", ");
}

export function RegimePathOverlay({ result }: RegimePathOverlayProps) {
  if (result.inputs.model !== "hmm" || result.sampleRegimePaths.length === 0) {
    return null;
  }

  const displayedPaths = result.sampleRegimePaths.slice(
    0,
    REPRESENTATIVE_REGIME_PATH_COUNT,
  );

  return (
    <section
      className="regime-path-overlay"
      aria-labelledby="regime-path-overlay-title"
    >
      <div>
        <p className="eyebrow">Inside individual futures</p>
        <h3 id="regime-path-overlay-title">Regime path overlay</h3>
      </div>
      <div className="regime-path-overlay__paths">
        {displayedPaths.map((path, pathIndex) => (
          <div className="regime-path" key={pathIndex}>
            <span aria-hidden="true">
              {String(pathIndex + 1).padStart(2, "0")}
            </span>
            <div
              className="regime-path__band"
              role="img"
              aria-label={`Representative path ${pathIndex + 1}: ${summarizePath(path)}`}
            >
              {compressRegimePath(path).map((segment, segmentIndex) => (
                <i
                  data-regime={segment.regime}
                  style={{ flexGrow: segment.length }}
                  key={`${segment.regime}-${segmentIndex}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p>
        Numbered strips match the highlighted portfolio paths above. Each band
        shows the hidden state that supplied that path’s return, volatility,
        and correlation at each month.
      </p>
    </section>
  );
}
