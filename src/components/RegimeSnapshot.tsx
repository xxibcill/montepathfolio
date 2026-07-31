import {
  portfolioRegimeMoments,
  REGIME_DESCRIPTIONS,
  REGIME_LABELS,
  REGIME_ORDER,
} from "../lib/regimes";
import type { SimulationResult } from "../types/simulation";

interface RegimeSnapshotProps {
  result: SimulationResult;
}

export function RegimeSnapshot({ result }: RegimeSnapshotProps) {
  const { currentStateProbabilities, regimes } = result.inputs.hmm;

  return (
    <section className="regime-snapshot" aria-labelledby="regime-snapshot-title">
      <div className="regime-snapshot__intro">
        <p className="eyebrow">Regime uncertainty</p>
        <h2 id="regime-snapshot-title">The market is a probability, not a label.</h2>
        <p>
          These current-state probabilities seed each HMM path. They are an
          illustrative model-service snapshot, not a live market signal.
        </p>
      </div>

      <div className="regime-probabilities">
        {REGIME_ORDER.map((regime) => {
          const probability = currentStateProbabilities[regime];
          const moments = portfolioRegimeMoments(
            regimes[regime],
            result.inputs.stockAllocation,
          );

          return (
            <div
              className="regime-probability"
              data-regime={regime}
              key={regime}
            >
              <div className="regime-probability__heading">
                <span>
                  <i aria-hidden="true" />
                  {REGIME_LABELS[regime]}
                </span>
                <strong>{Math.round(probability * 100)}%</strong>
              </div>
              <div
                className="regime-probability__track"
                role="meter"
                aria-label={`${REGIME_LABELS[regime]} current probability`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(probability * 100)}
              >
                <span style={{ transform: `scaleX(${probability})` }} />
              </div>
              <p>{REGIME_DESCRIPTIONS[regime]}</p>
              <small>
                {(moments.expectedReturn * 100).toFixed(1)}% return ·{" "}
                {(moments.volatility * 100).toFixed(1)}% volatility
              </small>
            </div>
          );
        })}
        {result.regimeOccupancy ? (
          <p className="regime-probabilities__occupancy">
            Across this run:{" "}
            {REGIME_ORDER.map(
              (regime) =>
                `${REGIME_LABELS[regime]} ${Math.round(result.regimeOccupancy![regime] * 100)}%`,
            ).join(" · ")}
          </p>
        ) : (
          <p className="regime-probabilities__occupancy">
            Select Regime switching to reveal the state mix across simulated
            paths.
          </p>
        )}
      </div>
    </section>
  );
}
