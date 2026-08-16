import { readFileSync } from "node:fs";
import { scoreExperiment, type EvaluationSummary } from "./scorer.js";
import {
  frozenWorkload,
  validateFrozenWorkload,
  workloadHash,
} from "./workload.js";

const readFixture = (name: string): EvaluationSummary =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as EvaluationSummary;

const errors = validateFrozenWorkload();
const selfTest = {
  knownPass: scoreExperiment(readFixture("known-pass.json")),
  knownFail: scoreExperiment(readFixture("known-fail.json")),
};
if (
  selfTest.knownPass !== "MECHANIC_PASS" ||
  selfTest.knownFail !== "MECHANIC_FAIL"
) {
  throw new Error("benchmark scorer self-test failed");
}
if (errors.length > 0)
  throw new Error(`frozen workload invalid: ${errors.join(", ")}`);

const requiredVariables = [
  "HUNTER_API_KEY",
  "HUNTER_COST_MICRO_USD",
  "ZEROBOUNCE_API_KEY",
  "ZEROBOUNCE_COST_MICRO_USD",
  "KICKBOX_API_KEY",
  "KICKBOX_COST_MICRO_USD",
] as const;
const missingVariables = requiredVariables.filter((name) => !process.env[name]);
const liveIneligible = frozenWorkload.filter(
  (item) => !item.liveEligible,
).length;

const result = {
  decision: "BLOCKED_LIVE_EVAL" as const,
  evidenceClass: "engineering_preflight_only" as const,
  workload: {
    cases: frozenWorkload.length,
    calibration: frozenWorkload.filter((item) => item.split === "calibration")
      .length,
    heldOut: frozenWorkload.filter((item) => item.split === "held_out").length,
    sha256: workloadHash,
    liveIneligibleCases: liveIneligible,
  },
  scorerSelfTest: selfTest,
  blockers: [
    ...(missingVariables.length === 0
      ? []
      : [`missing environment variables: ${missingVariables.join(", ")}`]),
    ...(liveIneligible === 0
      ? []
      : [
          `${liveIneligible} placeholder cases require owned controlled replacements`,
        ]),
    "no live measurement artifact exists for all four conditions",
  ],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
