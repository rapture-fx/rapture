import type { ProcessResult } from "../types.js";
import type { LogicalRunState } from "./logical-run.js";

export interface RunOutcomeInput {
  readonly agentTimedOut: boolean;
  readonly agentExitCode: number | null;
  readonly validationPassed: boolean;
  readonly validationResults: ReadonlyArray<Pick<ProcessResult, "timedOut" | "exitCode">>;
  readonly benchmarkScoped: boolean;
  readonly outOfScopeFiles: readonly string[];
}

export interface RunOutcomeClassification {
  readonly runState: LogicalRunState;
  readonly failureClassification: string | null;
}

function validatorInfrastructureFailed(
  scoped: boolean,
  results: RunOutcomeInput["validationResults"],
): boolean {
  if (!scoped) return false;
  return results.some(
    (result) =>
      result.timedOut ||
      result.exitCode === null ||
      (result.exitCode !== null && result.exitCode > 1),
  );
}

export function classifyRunOutcome(input: RunOutcomeInput): RunOutcomeClassification {
  const infrastructureFailed = validatorInfrastructureFailed(
    input.benchmarkScoped,
    input.validationResults,
  );
  const runState: LogicalRunState = infrastructureFailed
    ? "infrastructure_failed"
    : input.validationPassed && input.outOfScopeFiles.length === 0
      ? "accepted"
      : input.agentTimedOut
        ? "timed_out"
        : "rejected";
  const failureClassification =
    runState === "accepted"
      ? input.agentExitCode !== 0
        ? "agent_exit_nonzero_validation_passed"
        : null
      : infrastructureFailed
        ? "validator_infrastructure_failure"
        : input.outOfScopeFiles.length > 0
          ? `editable_scope_violation:${input.outOfScopeFiles.join(",")}`
          : runState === "timed_out"
            ? "agent_timeout"
            : "validation_failed";
  return { runState, failureClassification };
}
