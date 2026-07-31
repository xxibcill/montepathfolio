import { Check, Download, FileUp, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  LESSON_DATA_ATTACHMENT_CONTRACT,
  type LessonDataAttachment,
} from "../labs/lesson-worker-protocol";
import type { LessonDefinition } from "../labs/lesson-types";

const MAXIMUM_FILE_BYTES = 2_000_000;

export function DatasetImport({
  specification,
  attachment,
  onChange,
}: {
  readonly specification: NonNullable<LessonDefinition["dataImport"]>;
  readonly attachment: LessonDataAttachment | null;
  readonly onChange: (attachment: LessonDataAttachment | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAXIMUM_FILE_BYTES) {
      setError("CSV files are limited to 2 MB so the classroom worker stays responsive.");
      onChange(null);
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("The selected CSV is empty.");
      setError(null);
      onChange({
        contract: LESSON_DATA_ATTACHMENT_CONTRACT,
        filename: file.name,
        mediaType: "text/csv",
        text,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The CSV could not be read.");
      onChange(null);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(
      new Blob([specification.templateCsv], { type: "text/csv" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = specification.templateFilename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="dataset-import" aria-labelledby="dataset-import-title">
      <div>
        <p className="eyebrow">Optional local data</p>
        <h4 id="dataset-import-title">{specification.label}</h4>
        <p>{specification.description}</p>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".csv,text/csv"
        onChange={(event) => void chooseFile(event.target.files?.[0])}
      />
      <div className="dataset-import__actions">
        <button type="button" onClick={() => inputRef.current?.click()}>
          <FileUp size={15} aria-hidden="true" /> Choose CSV
        </button>
        <button type="button" onClick={downloadTemplate}>
          <Download size={15} aria-hidden="true" /> Template
        </button>
      </div>
      {attachment ? (
        <p className="dataset-import__file">
          <Check size={15} aria-hidden="true" />
          <span>{attachment.filename}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            aria-label={`Remove ${attachment.filename}`}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {error ? <p className="dataset-import__error" role="alert">{error}</p> : null}
    </section>
  );
}
