import {
  validateReturnDataset,
  type ObservationFrequency,
  type ReturnConvention,
  type ReturnDataset,
} from "../lib/quant/market-models";
import { QuantError } from "../lib/quant/core";
import type { LessonDataAttachment } from "./lesson-worker-protocol";

export function parseReturnDatasetCsv(
  csv: string,
  options: Omit<
    ReturnDataset,
    "contract" | "assetIds" | "timestamps" | "rows"
  >,
): ReturnDataset {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()));
  if (lines.length < 3 || lines[0].length < 2) {
    throw new QuantError(
      "INVALID_INPUT",
      "CSV needs a timestamp column, at least one asset, and two data rows.",
    );
  }
  if (lines.some((line) => line.length !== lines[0].length)) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Every CSV row must contain the same number of columns as its header.",
    );
  }
  const dataset: ReturnDataset = {
    contract: "return-dataset@1",
    assetIds: lines[0].slice(1),
    timestamps: lines.slice(1).map((row) => row[0]),
    rows: lines.slice(1).map((row) =>
      row.slice(1).map((cell) => {
        if (cell === "") {
          throw new QuantError("INVALID_INPUT", "Missing CSV values are rejected.");
        }
        return Number(cell);
      }),
    ),
    ...options,
  };
  validateReturnDataset(dataset);
  return dataset;
}

export function parseImportedReturnDataset(
  attachment: LessonDataAttachment,
  options: {
    readonly frequency?: ObservationFrequency;
    readonly returnConvention?: ReturnConvention;
  } = {},
): ReturnDataset {
  return parseReturnDatasetCsv(attachment.text, {
    frequency: options.frequency ?? "monthly",
    returnConvention: options.returnConvention ?? "simple",
    missingValuePolicy: "reject",
    alignmentPolicy: "intersection",
    provenance: {
      label: `User-imported ${attachment.filename}`,
      kind: "user-imported",
    },
  });
}

/**
 * Splits a learner-friendly combined file into independently provenance-labelled
 * asset and factor datasets. Columns use `asset:` and `factor:` prefixes.
 */
export function parseImportedFactorDataset(
  attachment: LessonDataAttachment,
  frequency: ObservationFrequency = "monthly",
): {
  readonly assetReturns: ReturnDataset;
  readonly factorReturns: ReturnDataset;
} {
  const rows = attachment.text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()));
  if (rows.length < 3) {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor CSV needs a header and at least two dated observations.",
    );
  }
  const header = rows[0];
  if (header[0]?.toLowerCase() !== "date") {
    throw new QuantError("INVALID_INPUT", "The first factor CSV column must be date.");
  }
  if (rows.some((row) => row.length !== header.length)) {
    throw new QuantError(
      "DIMENSION_MISMATCH",
      "Every factor CSV row must contain the same number of columns as its header.",
    );
  }
  const assetIndexes = prefixedIndexes(header, "asset:");
  const factorIndexes = prefixedIndexes(header, "factor:");
  if (assetIndexes.length === 0 || factorIndexes.length === 0) {
    throw new QuantError(
      "INVALID_INPUT",
      "Factor CSV needs at least one asset: column and one factor: column.",
    );
  }

  return {
    assetReturns: parseProjectedDataset(
      attachment,
      rows,
      assetIndexes,
      "asset:",
      frequency,
      "assets",
    ),
    factorReturns: parseProjectedDataset(
      attachment,
      rows,
      factorIndexes,
      "factor:",
      frequency,
      "factors",
    ),
  };
}

function prefixedIndexes(
  header: readonly string[],
  prefix: string,
): number[] {
  return header.flatMap((name, index) =>
    name.toLowerCase().startsWith(prefix) && name.slice(prefix.length).trim()
      ? [index]
      : [],
  );
}

function parseProjectedDataset(
  attachment: LessonDataAttachment,
  rows: readonly (readonly string[])[],
  indexes: readonly number[],
  prefix: string,
  frequency: ObservationFrequency,
  role: string,
): ReturnDataset {
  const projected = rows.map((row, rowIndex) => [
    row[0],
    ...indexes.map((index) =>
      rowIndex === 0 ? row[index].slice(prefix.length).trim() : row[index],
    ),
  ]);
  return parseReturnDatasetCsv(
    projected.map((row) => row.join(",")).join("\n"),
    {
      frequency,
      returnConvention: "simple",
      missingValuePolicy: "reject",
      alignmentPolicy: "intersection",
      provenance: {
        label: `User-imported ${role} from ${attachment.filename}`,
        kind: "user-imported",
      },
    },
  );
}
