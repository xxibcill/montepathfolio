import type { CSSProperties } from "react";
import { useNumberDraft } from "../hooks/useNumberDraft";
import {
  portfolioRegimeMoments,
  REGIME_LABELS,
  REGIME_ORDER,
  updateTransitionProbability,
} from "../lib/regimes";
import type {
  PortfolioProjectionHmmConfiguration,
  PortfolioProjectionRegime,
} from "../types/portfolio-projection";

interface TransitionMatrixEditorProps {
  configuration: PortfolioProjectionHmmConfiguration;
  stockAllocation: number;
  onChange: (configuration: PortfolioProjectionHmmConfiguration) => void;
}

interface TransitionCellProps {
  fromRegime: PortfolioProjectionRegime;
  toRegime: PortfolioProjectionRegime;
  value: number;
  onChange: (value: number) => void;
}

function TransitionCell({
  fromRegime,
  toRegime,
  value,
  onChange,
}: TransitionCellProps) {
  const percentage = Math.round(value * 1_000) / 10;
  const numberDraft = useNumberDraft({
    value: percentage,
    min: 0,
    max: 100,
    step: 1,
    onValueChange: (nextValue) => onChange(nextValue / 100),
  });

  return (
    <td
      className="transition-matrix__cell"
      style={
        {
          "--probability": `${percentage}%`,
        } as CSSProperties
      }
    >
      <label className="sr-only" htmlFor={`transition-${fromRegime}-${toRegime}`}>
        {REGIME_LABELS[fromRegime]} to {REGIME_LABELS[toRegime]} probability
      </label>
      <input
        id={`transition-${fromRegime}-${toRegime}`}
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="decimal"
        value={numberDraft.displayedValue}
        aria-label={`${REGIME_LABELS[fromRegime]} to ${REGIME_LABELS[toRegime]} probability, percent`}
        onFocus={numberDraft.handleFocus}
        onChange={numberDraft.handleChange}
        onBlur={numberDraft.handleBlur}
        onKeyDown={numberDraft.handleKeyDown}
      />
      <span aria-hidden="true">%</span>
    </td>
  );
}

export function TransitionMatrixEditor({
  configuration,
  stockAllocation,
  onChange,
}: TransitionMatrixEditorProps) {
  return (
    <div className="transition-editor">
      <table className="transition-matrix">
        <caption>
          Monthly probability of moving from each current regime to the next
          regime. Editing one cell redistributes the remainder of its row.
        </caption>
        <thead>
          <tr>
            <td aria-hidden="true" />
            {REGIME_ORDER.map((regime) => (
              <th scope="col" key={regime}>
                {REGIME_LABELS[regime]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REGIME_ORDER.map((fromRegime) => (
            <tr key={fromRegime}>
              <th scope="row">{REGIME_LABELS[fromRegime]}</th>
              {REGIME_ORDER.map((toRegime) => (
                <TransitionCell
                  fromRegime={fromRegime}
                  toRegime={toRegime}
                  value={
                    configuration.transitionMatrix[fromRegime][toRegime]
                  }
                  onChange={(value) =>
                    onChange(
                      updateTransitionProbability(
                        configuration,
                        fromRegime,
                        toRegime,
                        value,
                      ),
                    )
                  }
                  key={toRegime}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="control__hint">
        Rows always total 100%. Darker fill means the transition is more
        likely; the diagonal measures persistence.
      </p>

      <div className="regime-parameter-table" role="table">
        <div className="regime-parameter-table__row" role="row">
          <span role="columnheader">Regime</span>
          <span role="columnheader">Return</span>
          <span role="columnheader">Volatility</span>
        </div>
        {REGIME_ORDER.map((regime) => {
          const moments = portfolioRegimeMoments(
            configuration.regimes[regime],
            stockAllocation,
          );

          return (
            <div
              className="regime-parameter-table__row"
              data-regime={regime}
              role="row"
              key={regime}
            >
              <span role="rowheader">
                <i aria-hidden="true" />
                {REGIME_LABELS[regime]}
              </span>
              <span role="cell">
                {(moments.expectedReturn * 100).toFixed(1)}%
              </span>
              <span role="cell">
                {(moments.volatility * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="control__hint">
        Annualized portfolio moments at the selected stock–bond mix. Each
        regime also uses its own asset correlation.
      </p>
    </div>
  );
}
