// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InPageLink } from "./InPageLink";

describe("InPageLink", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("focuses its target without replacing the SPA hash route", () => {
    window.location.hash = "#/labs/risk/var-cvar";
    const target = document.createElement("section");
    target.id = "results";
    target.scrollIntoView = vi.fn();
    const container = document.createElement("div");
    document.body.append(container, target);
    const root = createRoot(container);
    act(() => root.render(<InPageLink targetId="results">Skip</InPageLink>));

    act(() => (container.querySelector("a") as HTMLAnchorElement).click());

    expect(window.location.hash).toBe("#/labs/risk/var-cvar");
    expect(document.activeElement).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
