import type { CSSProperties } from "react";
import { useNumberDraft } from "../hooks/useNumberDraft";
import type {
  AssetAssumptions,
  RebalanceFrequency,
  SimulationInputs,
} from "../types/simulation";

const FIXED_PATH_COUNT = 1_000;

type AssetKey = "stocks" | "bonds";

interface ScenarioControlsProps {
  inputs: SimulationInputs;
  /**
   * Receives a complete, simulation-ready input snapshot after every edit.
   */
  onChange: (nextInputs: SimulationInputs) => void;
  isRunning?: boolean;
  isDirty?: boolean;
}

interface NumberControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
  hint?: string;
  prefix?: string;
  suffix?: string;
}

function toPercentInput(value: number): number {
  return Math.round(value * 1_000) / 10;
}

function NumberControl({
  id,
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  hint,
  prefix,
  suffix,
}: NumberControlProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const acceptsNegative = min < 0;
  const numberDraft = useNumberDraft({
    value,
    min,
    max,
    step,
    onValueChange,
    handleArrowKeys: acceptsNegative,
  });

  return (
    <div className="control">
      <label className="control__label" htmlFor={id}>
        {label}
      </label>
      <div className="control__input-shell">
        {prefix ? (
          <span className="control__affix" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          className="control__number"
          type={acceptsNegative ? "text" : "number"}
          role={acceptsNegative ? "spinbutton" : undefined}
          inputMode="decimal"
          pattern={acceptsNegative ? "-?[0-9]*\\.?[0-9]*" : undefined}
          min={min}
          max={max}
          step={step}
          value={numberDraft.displayedValue}
          aria-valuemin={acceptsNegative ? min : undefined}
          aria-valuemax={acceptsNegative ? max : undefined}
          aria-valuenow={
            acceptsNegative &&
            numberDraft.displayedValue.trim() !== "" &&
            Number.isFinite(numberDraft.parsedValue)
              ? numberDraft.parsedValue
              : undefined
          }
          aria-describedby={hintId}
          onFocus={numberDraft.handleFocus}
          onChange={numberDraft.handleChange}
          onBlur={numberDraft.handleBlur}
          onKeyDown={numberDraft.handleKeyDown}
        />
        {suffix ? (
          <span className="control__affix control__affix--suffix">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p className="control__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AssetAssumptionControlsProps {
  asset: AssetKey;
  assumptions: AssetAssumptions;
  onChange: (field: keyof AssetAssumptions, value: number) => void;
}

function AssetAssumptionControls({
  asset,
  assumptions,
  onChange,
}: AssetAssumptionControlsProps) {
  const assetLabel = asset === "stocks" ? "Stocks" : "Bonds";

  return (
    <div className="asset-assumptions">
      <div className="asset-assumptions__heading">
        <span
          className={`asset-assumptions__marker asset-assumptions__marker--${asset}`}
          aria-hidden="true"
        />
        <h3>{assetLabel}</h3>
      </div>
      <NumberControl
        id={`${asset}-return`}
        label="Expected return"
        value={toPercentInput(assumptions.expectedReturn)}
        min={-20}
        max={30}
        step={0.1}
        suffix="%"
        onValueChange={(value) => onChange("expectedReturn", value / 100)}
      />
      <NumberControl
        id={`${asset}-volatility`}
        label="Volatility"
        value={toPercentInput(assumptions.volatility)}
        min={0}
        max={80}
        step={0.5}
        suffix="%"
        onValueChange={(value) => onChange("volatility", value / 100)}
      />
    </div>
  );
}

interface CorrelationEditorProps {
  value: number;
  onChange: (value: number) => void;
}

function CorrelationEditor({ value, onChange }: CorrelationEditorProps) {
  const inputId = "stock-bond-correlation";
  const hintId = `${inputId}-hint`;
  const numberDraft = useNumberDraft({
    value,
    min: -1,
    max: 1,
    step: 0.05,
    onValueChange: onChange,
    handleArrowKeys: true,
  });

  return (
    <div className="correlation-editor">
      <table className="correlation-matrix">
        <caption>Two-asset correlation matrix</caption>
        <thead>
          <tr>
            <td aria-hidden="true" />
            <th scope="col">Stocks</th>
            <th scope="col">Bonds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Stocks</th>
            <td>
              <output aria-label="Stock self-correlation">1.00</output>
            </td>
            <td>
              <label className="sr-only" htmlFor={inputId}>
                Stock and bond correlation
              </label>
              <input
                id={inputId}
                type="text"
                role="spinbutton"
                inputMode="decimal"
                pattern="-?[0-9]*\\.?[0-9]*"
                min={-1}
                max={1}
                step={0.05}
                value={numberDraft.displayedValue}
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={
                  numberDraft.displayedValue.trim() !== "" &&
                  Number.isFinite(numberDraft.parsedValue)
                    ? numberDraft.parsedValue
                    : undefined
                }
                aria-describedby={hintId}
                onFocus={numberDraft.handleFocus}
                onChange={numberDraft.handleChange}
                onBlur={numberDraft.handleBlur}
                onKeyDown={numberDraft.handleKeyDown}
              />
            </td>
          </tr>
          <tr>
            <th scope="row">Bonds</th>
            <td>
              <output aria-label="Bond and stock correlation">{value}</output>
            </td>
            <td>
              <output aria-label="Bond self-correlation">1.00</output>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="control__hint" id={hintId}>
        Lower values add diversification; higher values make both assets move
        together more often.
      </p>
    </div>
  );
}

export function ScenarioControls({
  inputs,
  onChange,
  isRunning = false,
  isDirty,
}: ScenarioControlsProps) {
  const stockPercent = Math.round(inputs.stockAllocation * 100);
  const bondPercent = 100 - stockPercent;

  function updateInput<Key extends keyof SimulationInputs>(
    key: Key,
    value: SimulationInputs[Key],
  ) {
    onChange({ ...inputs, [key]: value, pathCount: FIXED_PATH_COUNT });
  }

  function updateAsset(
    asset: AssetKey,
    field: keyof AssetAssumptions,
    value: number,
  ) {
    onChange({
      ...inputs,
      [asset]: { ...inputs[asset], [field]: value },
      pathCount: FIXED_PATH_COUNT,
    });
  }

  return (
    <div className="scenario-controls" aria-busy={isRunning}>
      {isRunning || typeof isDirty === "boolean" ? (
        <p
          className="scenario-controls__state"
          data-state={isRunning ? "running" : isDirty ? "dirty" : "ready"}
        >
          {isRunning
            ? "Recalculating 1,000 paths…"
            : isDirty
              ? "Inputs changed"
              : "Results are up to date"}
        </p>
      ) : null}

      <fieldset className="scenario-controls__section">
        <legend>Starting point</legend>
        <div className="scenario-controls__grid">
          <NumberControl
            id="initial-capital"
            label="Initial capital"
            value={inputs.initialCapital}
            min={0}
            max={100_000_000}
            step={1_000}
            prefix="$"
            onValueChange={(value) => updateInput("initialCapital", value)}
          />
          <NumberControl
            id="monthly-contribution"
            label="Monthly contribution"
            value={inputs.monthlyContribution}
            min={0}
            max={100_000}
            step={100}
            prefix="$"
            onValueChange={(value) =>
              updateInput("monthlyContribution", value)
            }
          />
          <NumberControl
            id="horizon-years"
            label="Investment horizon"
            value={inputs.horizonYears}
            min={1}
            max={60}
            step={1}
            suffix="years"
            onValueChange={(value) =>
              updateInput("horizonYears", Math.round(value))
            }
          />
          <NumberControl
            id="target-value"
            label="Financial target"
            value={inputs.targetValue}
            min={1_000}
            max={1_000_000_000}
            step={10_000}
            prefix="$"
            hint="Measured in future, nominal dollars."
            onValueChange={(value) => updateInput("targetValue", value)}
          />
        </div>
      </fieldset>

      <fieldset className="scenario-controls__section">
        <legend>Portfolio mix</legend>
        <div
          className="allocation-control"
          role="group"
          aria-labelledby="allocation-label"
        >
          <div className="allocation-control__heading">
            <span id="allocation-label">Asset allocation</span>
            <output htmlFor="stock-allocation">{stockPercent}% stocks</output>
          </div>
          <input
            id="stock-allocation"
            className="allocation-control__range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={stockPercent}
            aria-label="Stock allocation percentage"
            aria-valuetext={`${stockPercent}% stocks and ${bondPercent}% bonds`}
            style={
              {
                "--range-progress": `${stockPercent}%`,
              } as CSSProperties
            }
            onChange={(event) =>
              updateInput(
                "stockAllocation",
                event.currentTarget.valueAsNumber / 100,
              )
            }
          />
          <div className="allocation-control__split" aria-hidden="true">
            <span>Stocks {stockPercent}%</span>
            <span>Bonds {bondPercent}%</span>
          </div>
        </div>
      </fieldset>

      <details className="assumptions-disclosure">
        <summary>
          <span>Model assumptions</span>
          <small>Returns, volatility, correlation, and inflation</small>
        </summary>
        <div className="assumptions-disclosure__content">
          <fieldset className="scenario-controls__section">
            <legend>Market assumptions</legend>
            <div className="asset-assumptions-grid">
              <AssetAssumptionControls
                asset="stocks"
                assumptions={inputs.stocks}
                onChange={(field, value) => updateAsset("stocks", field, value)}
              />
              <AssetAssumptionControls
                asset="bonds"
                assumptions={inputs.bonds}
                onChange={(field, value) => updateAsset("bonds", field, value)}
              />
            </div>
            <p className="scenario-controls__note">
              Returns and volatility are annual assumptions before inflation.
            </p>
          </fieldset>

          <fieldset className="scenario-controls__section">
            <legend>Diversification</legend>
            <CorrelationEditor
              value={inputs.correlation}
              onChange={(value) => updateInput("correlation", value)}
            />
            <div className="control">
              <label className="control__label" htmlFor="rebalance-frequency">
                Rebalancing
              </label>
              <select
                id="rebalance-frequency"
                className="control__select"
                value={inputs.rebalanceFrequency}
                onChange={(event) =>
                  updateInput(
                    "rebalanceFrequency",
                    event.currentTarget.value as RebalanceFrequency,
                  )
                }
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annually</option>
                <option value="never">Never</option>
              </select>
              <p className="control__hint">
                Restores the selected stock–bond mix on this schedule.
              </p>
            </div>
          </fieldset>

          <fieldset className="scenario-controls__section">
            <legend>Model settings</legend>
            <div className="scenario-controls__grid">
              <NumberControl
                id="inflation-rate"
                label="Inflation"
                value={toPercentInput(inputs.inflationRate)}
                min={-5}
                max={20}
                step={0.1}
                suffix="%"
                hint="Used to estimate purchasing power in today’s dollars."
                onValueChange={(value) =>
                  updateInput("inflationRate", value / 100)
                }
              />
              <div className="control">
                <label className="control__label" htmlFor="simulation-paths">
                  Simulation paths
                </label>
                <div className="control__input-shell">
                  <input
                    id="simulation-paths"
                    className="control__number"
                    type="number"
                    value={FIXED_PATH_COUNT}
                    readOnly
                    aria-readonly="true"
                  />
                  <span className="control__affix control__affix--suffix">
                    paths
                  </span>
                </div>
                <p className="control__hint">
                  Fixed for consistent, responsive comparisons.
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
