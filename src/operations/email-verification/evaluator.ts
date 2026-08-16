import type { Confidence, Decision } from "./contract.js";

export interface EvaluationOutcome {
  readonly decisive: boolean;
  readonly useful: boolean;
  readonly groundTruth?: Exclude<Decision, "uncertain">;
  readonly correct: boolean | null;
}

export const evaluateOutcome = (
  decision: Decision,
  confidence: Confidence,
  groundTruth?: Exclude<Decision, "uncertain">,
): EvaluationOutcome => {
  const decisive = decision !== "uncertain";
  return {
    decisive,
    useful: decisive && confidence === "high",
    ...(groundTruth === undefined ? {} : { groundTruth }),
    correct: groundTruth === undefined || !decisive ? null : decision === groundTruth,
  };
};

