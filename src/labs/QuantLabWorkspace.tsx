import {
  ArrowLeft,
  Check,
  Download,
  FlaskConical,
  RotateCcw,
  Save,
} from "lucide-react";
import { useMemo, useState } from "react";
import { LabMasthead } from "../components/LabMasthead";
import { DatasetImport } from "../components/DatasetImport";
import { LessonChart } from "../components/LessonChart";
import {
  useLessonWorker,
  type LessonRunStatus,
} from "../hooks/useLessonWorker";
import { loadStoredInputs, STORAGE_KEY } from "../lib/defaults";
import { getLab, getLesson, lessonsForLab } from "./catalog";
import type {
  LessonDefinition,
  LessonOutput,
  LessonParameter,
} from "./lesson-types";
import { labHref, type LabId } from "./routes";
import { modelNoteFor } from "./model-notes";
import type { LessonDataAttachment } from "./lesson-worker-protocol";

export default function QuantLabWorkspace({
  lab: labId,
  initialLessonId,
}: {
  readonly lab: LabId;
  readonly initialLessonId: string;
}) {
  const lab = getLab(labId);
  const lesson = getLesson(labId, initialLessonId);
  const lessons = lessonsForLab(labId);
  const defaults = useMemo(() => defaultValues(lesson), [lesson]);
  const [values, setValues] = useState<Record<string, number>>(() =>
    normalizeValues(lesson, loadScenario(labId, lesson, defaults)),
  );
  const [attachment, setAttachment] = useState<LessonDataAttachment | null>(null);
  const { output, previous, status, error, run, cancel } = useLessonWorker(
    lesson.id,
    values,
  );
  const [inputsChanged, setInputsChanged] = useState(false);
  const [saved, setSaved] = useState(false);
  const displayedStatus: LessonRunStatus =
    inputsChanged && status === "current" ? "changed" : status;

  const runExperiment = () => {
    const normalized = normalizeValues(lesson, values);
    setValues(normalized);
    setInputsChanged(false);
    run(normalized, attachment ?? undefined);
  };

  const reset = () => {
    setValues(defaults);
    setAttachment(null);
    setInputsChanged(true);
    setSaved(false);
  };

  const applyPreset = (presetId: string) => {
    const preset = lesson.presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setValues({ ...defaults, ...preset.values });
    setAttachment(null);
    setInputsChanged(true);
    setSaved(false);
  };

  const save = () => {
    saveScenario(
      labId,
      lesson,
      normalizeValues(lesson, values),
      output,
      attachment,
    );
    setSaved(true);
  };

  const changedParameters = previous
    ? lesson.parameters.filter(
        (parameter) => previous.values[parameter.id] !== values[parameter.id],
      )
    : [];

  return (
    <>
      <a className="skip-link" href="#lesson-results">
        Skip to experiment results
      </a>
      <div className="app-shell lab-workspace-shell">
        <LabMasthead context={`${lab.number} · ${lab.title}`} />
        <main>
          <section className="lab-chapter-header">
            <a className="chapter-back" href="#/">
              <ArrowLeft size={16} aria-hidden="true" /> Laboratory index
            </a>
            <div className="lab-chapter-header__copy">
              <div>
                <p className="eyebrow">Laboratory {lab.number}</p>
                <h1>{lab.title}</h1>
              </div>
              <p>{lab.introduction}</p>
            </div>
            <nav className="chapter-nav" aria-label={`${lab.title} chapters`}>
              {labId === "portfolio-projection" ? (
                <a href={labHref(labId, "accumulation")}>Accumulation simulator</a>
              ) : null}
              {lessons.map((candidate, index) => (
                <a
                  key={candidate.id}
                  href={labHref(labId, candidate.id)}
                  aria-current={candidate.id === lesson.id ? "page" : undefined}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {candidate.title}
                </a>
              ))}
            </nav>
          </section>

          <article className="lesson-workspace">
            <header className="lesson-opening">
              <div className="lesson-opening__index">
                <span>Release {lesson.release}</span>
                <span>{lesson.kicker}</span>
              </div>
              <div className="lesson-opening__copy">
                <div>
                  <p className="eyebrow">What this model answers</p>
                  <h2>{lesson.title}</h2>
                </div>
                <div>
                  <p className="lesson-question">{lesson.question}</p>
                  <p>{lesson.intuition}</p>
                </div>
              </div>
            </header>

            <div className="lesson-experiment">
              <aside className="lesson-controls" aria-labelledby="experiment-title">
                <div className="lesson-controls__heading">
                  <div>
                    <p className="eyebrow">Experiment</p>
                    <h3 id="experiment-title">Turn one assumption</h3>
                  </div>
                  <button className="icon-button" type="button" onClick={reset} aria-label="Reset lesson inputs" title="Reset lesson inputs">
                    <RotateCcw size={16} aria-hidden="true" />
                  </button>
                </div>

                <label className="lesson-preset">
                  <span>Illustrative preset</span>
                  <select defaultValue="" onChange={(event) => applyPreset(event.target.value)}>
                    <option value="" disabled>Select a preset…</option>
                    {lesson.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
                <p className="lesson-preset__note">
                  {lesson.presets[0]?.description}
                </p>

                <div className="lesson-parameters">
                  {lesson.parameters.map((parameter) => (
                    <ParameterControl
                      key={parameter.id}
                      parameter={parameter}
                      value={values[parameter.id]}
                      onChange={(value) => {
                        setValues((current) => ({ ...current, [parameter.id]: value }));
                        setInputsChanged(true);
                        setSaved(false);
                      }}
                    />
                  ))}
                </div>

                {lesson.dataImport ? (
                  <DatasetImport
                    specification={lesson.dataImport}
                    attachment={attachment}
                    onChange={(nextAttachment) => {
                      setAttachment(nextAttachment);
                      setInputsChanged(true);
                      setSaved(false);
                    }}
                  />
                ) : null}

                <button
                  className="run-experiment"
                  type="button"
                  onClick={status === "running" ? cancel : runExperiment}
                >
                  <FlaskConical size={17} aria-hidden="true" />
                  {status === "running" ? "Cancel calculation" : "Run experiment"}
                </button>
                <p className={`lesson-run-status lesson-run-status--${displayedStatus}`} role="status" aria-live="polite">
                  {statusMessage(displayedStatus)}
                </p>

                <div className="scenario-actions" aria-label="Scenario actions">
                  <button type="button" onClick={save} disabled={status === "running"}>
                    {saved ? <Check size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                    {saved ? "Saved" : "Save inputs"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadScenario(
                        labId,
                        lesson,
                        normalizeValues(lesson, values),
                        output,
                        attachment,
                      )
                    }
                  >
                    <Download size={15} aria-hidden="true" /> Inputs
                  </button>
                  <button type="button" onClick={() => downloadSummary(lesson, output)} disabled={status === "running"}>
                    <Download size={15} aria-hidden="true" /> Summary
                  </button>
                </div>
                <p className="lesson-local-note">Saved locally per laboratory. No account or remote service.</p>
                {lesson.id === "mean-variance" && status === "current" ? (
                  <button
                    className="projection-seed"
                    type="button"
                    onClick={() => seedProjectionAllocation(output)}
                  >
                    Use max-Sharpe allocation in projection
                  </button>
                ) : null}
              </aside>

              <div className="lesson-results" id="lesson-results">
                {error ? (
                  <div className="error-banner" role="alert">
                    <strong>This combination needs attention.</strong>
                    <span>{error}</span>
                  </div>
                ) : null}
                <section className="lesson-result-intro" aria-live="polite">
                  <p className="eyebrow">Observe</p>
                  <h3>{output.headline}</h3>
                  <p>{output.explanation}</p>
                </section>

                {previous && changedParameters.length > 0 ? (
                  <section className="cause-effect-note">
                    <p className="eyebrow">Cause & effect</p>
                    <p>
                      You changed {changedParameters.map((parameter) => parameter.label).join(", ")}.
                      The prior run remains below for a fair, versioned comparison.
                    </p>
                    <div>
                      <span>Previous: {previous.output.metrics[0]?.value}</span>
                      <span>Current: {output.metrics[0]?.value}</span>
                    </div>
                  </section>
                ) : null}

                <dl className="lesson-metrics">
                  {output.metrics.map((item) => (
                    <div key={item.label} data-tone={item.tone}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                      <p>{item.detail}</p>
                    </div>
                  ))}
                </dl>

                <LessonChart
                  title={`${lesson.title} experiment chart`}
                  series={output.series}
                  {...output.chartAxes}
                />

                {output.additionalCharts?.map((chart) => (
                  <LessonChart
                    key={chart.title}
                    title={chart.title}
                    series={chart.series}
                    xLabel={chart.xLabel}
                    yLabel={chart.yLabel}
                    xUnit={chart.xUnit}
                    yUnit={chart.yUnit}
                  />
                ))}

                {output.table ? (
                  <div className="lesson-table-wrap">
                    <table className="lesson-table">
                      <caption>{output.table.caption}</caption>
                      <thead>
                        <tr>{output.table.columns.map((column) => <th key={column}>{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {output.table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>

            <section className="math-notebook">
              <div className="math-notebook__equation">
                <p className="eyebrow">Show the math</p>
                <div role="math" aria-label={lesson.equation}>{lesson.equation}</div>
                <p>{lesson.workedExample}</p>
              </div>
              <dl className="symbol-glossary">
                {lesson.symbols.map((symbol) => (
                  <div key={symbol.symbol}>
                    <dt>{symbol.symbol}</dt>
                    <dd>{symbol.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="lesson-checks">
              <div>
                <p className="eyebrow">Check it</p>
                <h3>{lesson.check}</h3>
              </div>
              <div className="diagnostic-list">
                {output.diagnostics.map((diagnostic) => (
                  <p key={diagnostic}><Check size={15} aria-hidden="true" />{diagnostic}</p>
                ))}
              </div>
              {output.warnings.length > 0 ? (
                <div className="lesson-warnings" role="status">
                  <strong>Warnings to carry into interpretation</strong>
                  {output.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              ) : null}
              <details className="provenance-panel">
                <summary>Deterministic provenance</summary>
                <ul>{output.provenance.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            </section>

            <section className="assumptions-limits" id="learning-method">
              <div>
                <p className="eyebrow">Assumptions</p>
                <ul>{lesson.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <p className="eyebrow">Limits</p>
                <ul>{lesson.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <p className="educational-notice">
                This laboratory is strictly educational. Illustrative inputs and model
                outputs are not live estimates, forecasts, suitability analysis, or
                investment advice.
              </p>
              <details className="model-note-panel">
                <summary>Read the full implementation note</summary>
                <pre>{modelNoteFor(lesson.modelNotePath)}</pre>
              </details>
            </section>
          </article>
        </main>
        <footer>
          <span>Montepathfolio · {lesson.title}</span>
          <span>Question → experiment → explanation → check.</span>
        </footer>
      </div>
    </>
  );
}

function ParameterControl({
  parameter,
  value,
  onChange,
}: {
  readonly parameter: LessonParameter;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const inputId = `lesson-parameter-${parameter.id}`;
  if (parameter.choices) {
    return (
      <div className="lesson-parameter lesson-parameter--choice">
        <label htmlFor={inputId}>
          <span>{parameter.label}</span>
        </label>
        <select
          id={inputId}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={`${inputId}-description`}
        >
          {parameter.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <p id={`${inputId}-description`}>{parameter.description}</p>
      </div>
    );
  }
  return (
    <div className="lesson-parameter">
      <label htmlFor={inputId}>
        <span>{parameter.label}</span>
        <output>{formatParameter(value, parameter)}</output>
      </label>
      <input
        id={inputId}
        type="range"
        min={parameter.minimum}
        max={parameter.maximum}
        step={parameter.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-describedby={`${inputId}-description`}
      />
      <div className="lesson-parameter__number">
        <input
          type="number"
          min={parameter.minimum}
          max={parameter.maximum}
          step={parameter.step}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          aria-label={`${parameter.label} exact value`}
        />
        <span>{parameter.unit}</span>
      </div>
      <p id={`${inputId}-description`}>{parameter.description}</p>
    </div>
  );
}

function defaultValues(lesson: LessonDefinition): Record<string, number> {
  return Object.fromEntries(
    lesson.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  );
}

function normalizeValues(
  lesson: LessonDefinition,
  values: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    lesson.parameters.map((parameter) => {
      const supplied = values[parameter.id];
      const finite = Number.isFinite(supplied) ? supplied : parameter.defaultValue;
      const bounded = Math.min(parameter.maximum, Math.max(parameter.minimum, finite));
      return [
        parameter.id,
        parameter.format === "integer" ? Math.round(bounded) : bounded,
      ];
    }),
  );
}

function formatParameter(value: number, parameter: LessonParameter): string {
  if (parameter.format === "decimal-percent") {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (parameter.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (parameter.format === "integer") return Math.round(value).toLocaleString();
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
}

function statusMessage(status: LessonRunStatus): string {
  if (status === "running") return "Calculating this fixed-seed experiment.";
  if (status === "changed") return "Inputs changed. Run to update the result.";
  if (status === "error") return "Review the highlighted model constraint.";
  return "Result matches the current inputs.";
}

function scenarioKey(lab: LabId): string {
  return `montepathfolio/scenario/${lab}@2`;
}

function loadScenario(
  lab: LabId,
  lesson: LessonDefinition,
  defaults: Record<string, number>,
): Record<string, number> {
  try {
    const raw =
      window.localStorage.getItem(scenarioKey(lab)) ??
      window.localStorage.getItem(`montepathfolio/scenario/${lab}@1`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as {
      contract?: string;
      lessonId?: string;
      inputs?: Record<string, unknown>;
    };
    if (
      (parsed.contract !== "educational-scenario@1" &&
        parsed.contract !== "educational-scenario@2") ||
      parsed.lessonId !== lesson.id ||
      !parsed.inputs
    ) {
      return defaults;
    }
    return Object.fromEntries(
      lesson.parameters.map((parameter) => {
        const value = parsed.inputs?.[parameter.id];
        return [
          parameter.id,
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= parameter.minimum &&
          value <= parameter.maximum
            ? value
            : parameter.defaultValue,
        ];
      }),
    );
  } catch {
    return defaults;
  }
}

function saveScenario(
  lab: LabId,
  lesson: LessonDefinition,
  values: Readonly<Record<string, number>>,
  output: LessonOutput,
  attachment: LessonDataAttachment | null,
): void {
  try {
    window.localStorage.setItem(
      scenarioKey(lab),
      JSON.stringify({
        contract: "educational-scenario@2",
        lab,
        lessonId: lesson.id,
        modelContract: output.resultContract,
        engineProvenance: output.provenance,
        fittedSnapshotReference: attachment
          ? {
              sourceContract: attachment.contract,
              filename: attachment.filename,
            }
          : null,
        inputs: values,
      }),
    );
  } catch {
    // Saving is optional; the experiment remains usable in this session.
  }
}

function downloadScenario(
  lab: LabId,
  lesson: LessonDefinition,
  values: Readonly<Record<string, number>>,
  output: LessonOutput,
  attachment: LessonDataAttachment | null,
): void {
  downloadText(
    `${lesson.id}-inputs.json`,
    JSON.stringify(
      {
        contract: "educational-scenario@2",
        lab,
        lessonId: lesson.id,
        modelContract: output.resultContract,
        engineProvenance: output.provenance,
        fittedSnapshotReference: attachment
          ? {
              sourceContract: attachment.contract,
              filename: attachment.filename,
            }
          : null,
        inputs: values,
        labels: Object.fromEntries(lesson.parameters.map((parameter) => [parameter.id, `${parameter.label} (${parameter.unit})`])),
        presetKind: "illustrative",
        modelNotePath: lesson.modelNotePath,
      },
      null,
      2,
    ),
    "application/json",
  );
}

function seedProjectionAllocation(output: LessonOutput): void {
  const weight = output.compactSummary.maximumSharpeWeightA;
  if (typeof weight !== "number" || !Number.isFinite(weight)) return;
  try {
    const current = loadStoredInputs();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...current,
        stockAllocation: Math.min(1, Math.max(0, weight)),
      }),
    );
    window.location.hash = "#/labs/portfolio-projection/accumulation";
  } catch {
    // The explicit handoff is optional when browser storage is unavailable.
  }
}

function downloadSummary(lesson: LessonDefinition, output: LessonOutput): void {
  const rows = [
    ["model", lesson.title],
    ["result_contract", output.resultContract],
    ...Object.entries(output.compactSummary).map(([key, value]) => [key, String(value)]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  downloadText(`${lesson.id}-summary.csv`, csv, "text/csv");
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
