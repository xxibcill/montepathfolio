import { describe, expect, it } from "vitest";
import { LESSON_DATA_ATTACHMENT_CONTRACT } from "./lesson-worker-protocol";
import {
  parseImportedFactorDataset,
  parseImportedReturnDataset,
} from "./imported-datasets";

const attachment = {
  contract: LESSON_DATA_ATTACHMENT_CONTRACT,
  filename: "lesson.csv",
  mediaType: "text/csv" as const,
  text: "date,Asset A\n2026-01-01,0.01\n2026-02-01,-0.02",
};

describe("learner CSV adapters", () => {
  it("labels a simple return matrix as user imported", () => {
    const dataset = parseImportedReturnDataset(attachment);
    expect(dataset.rows).toEqual([[0.01], [-0.02]]);
    expect(dataset.provenance).toEqual({
      label: "User-imported lesson.csv",
      kind: "user-imported",
    });
  });

  it("splits combined asset and data-defined factor columns", () => {
    const split = parseImportedFactorDataset({
      ...attachment,
      text: [
        "date,asset:Portfolio,factor:Market,factor:Value",
        "2026-01-01,0.01,0.02,-0.01",
        "2026-02-01,-0.02,-0.01,0.03",
      ].join("\n"),
    });
    expect(split.assetReturns.assetIds).toEqual(["Portfolio"]);
    expect(split.factorReturns.assetIds).toEqual(["Market", "Value"]);
    expect(split.assetReturns.timestamps).toEqual(split.factorReturns.timestamps);
  });

  it("rejects ambiguous factor columns", () => {
    expect(() =>
      parseImportedFactorDataset({
        ...attachment,
        text: "date,Portfolio,Market\n2026-01-01,0.01,0.02\n2026-02-01,0,0",
      }),
    ).toThrow(/asset: column/);
  });
});
