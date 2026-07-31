import { REGIME_ORDER } from "../lib/defaults";
import { REGIME_LABELS } from "../lib/regimes";
import type { Regime, SimulationResult } from "../types/simulation";

interface RegimePathOverlayProps {
  result: SimulationResult;
}

interface RegimeSegment {
  regime: Regime;
  length: number;
}

function compressRegimePath(path: Regime[]): RegimeSegment[] {
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

function summarizePath(path: Regime[]): string {
  const counts: Record<Regime, number> = { bull: 0, bear: 0, sideways: 0 };
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

  const displayedPaths = result.sampleRegimePaths.slice(0, 6);

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
        Six retained paths are shown for legibility. Each thin band is the
        hidden state that supplied that path’s return, volatility, and
        correlation at each month.
      </p>
    </section>
  );
}
