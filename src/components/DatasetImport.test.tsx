// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonDataAttachment } from "../labs/lesson-worker-protocol";
import { DatasetImport } from "./DatasetImport";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DatasetImport", () => {
  it("reads a bounded CSV and returns a structured attachment", async () => {
    const onChange = vi.fn<(attachment: LessonDataAttachment | null) => void>();
    act(() => {
      root!.render(
        <DatasetImport
          specification={{
            label: "Return data",
            description: "A local classroom file.",
            templateFilename: "template.csv",
            templateCsv: "date,A\n2026-01-01,0.01\n2026-02-01,0.02",
          }}
          attachment={null}
          onChange={onChange}
        />,
      );
    });
    const input = container!.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
    const file = new File(["fixture"], "returns.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: async () => "date,A\n2026-01-01,0.01\n2026-02-01,0.02",
    });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "returns.csv",
        mediaType: "text/csv",
      }),
    );
  });
});
