import { describe, expect, it } from "vitest";
import { LAB_IDS, labHref, parseLabRoute, type LabId } from "./routes";

const expectedDefaults: Readonly<Record<LabId, string>> = {
  "portfolio-projection": "accumulation",
  "portfolio-construction": "mean-variance",
  risk: "var-cvar",
  derivatives: "black-scholes",
  "rates-credit": "vasicek",
  trading: "ornstein-uhlenbeck",
};

describe("laboratory hash routes", () => {
  it.each(["", "#", "#/", "#/about", "#/labs/unknown/model"])(
    "treats %s as the home route",
    (hash) => {
      expect(parseLabRoute(hash)).toEqual({ kind: "home" });
    },
  );

  it.each(LAB_IDS)("selects the default lesson for %s", (lab) => {
    expect(parseLabRoute(`#/labs/${lab}`)).toEqual({
      kind: "lab",
      lab,
      lesson: expectedDefaults[lab],
    });
    expect(labHref(lab)).toBe(`#/labs/${lab}/${expectedDefaults[lab]}`);
  });

  it("preserves an explicit lesson identifier", () => {
    expect(parseLabRoute("#/labs/derivatives/heston")).toEqual({
      kind: "lab",
      lab: "derivatives",
      lesson: "heston",
    });
    expect(labHref("derivatives", "heston")).toBe(
      "#/labs/derivatives/heston",
    );
  });
});
