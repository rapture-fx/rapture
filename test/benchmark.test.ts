import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  scoreExperiment,
  type EvaluationSummary,
} from "../benchmark/scorer.js";
import {
  frozenWorkload,
  validateFrozenWorkload,
} from "../benchmark/workload.js";

const fixture = (name: string): EvaluationSummary =>
  JSON.parse(
    readFileSync(
      new URL(`../benchmark/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as EvaluationSummary;

describe("frozen benchmark", () => {
  it("has at least 100 privacy-safe segmented cases with a frozen hash", () => {
    expect(frozenWorkload).toHaveLength(120);
    expect(validateFrozenWorkload()).toEqual([]);
    expect(
      frozenWorkload.filter((item) => item.split === "calibration"),
    ).toHaveLength(48);
    expect(
      frozenWorkload.filter((item) => item.split === "held_out"),
    ).toHaveLength(72);
  });

  it("classifies the known-PASS scorer fixture as MECHANIC_PASS", () => {
    expect(scoreExperiment(fixture("known-pass.json"))).toBe("MECHANIC_PASS");
  });

  it("classifies the known-FAIL scorer fixture as MECHANIC_FAIL", () => {
    expect(scoreExperiment(fixture("known-fail.json"))).toBe("MECHANIC_FAIL");
  });

  it("never classifies non-live input as product evidence", () => {
    expect(
      scoreExperiment({ ...fixture("known-pass.json"), live: false }),
    ).toBe("BLOCKED_LIVE_EVAL");
  });
});
