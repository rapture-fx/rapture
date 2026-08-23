import { expect, it } from "vitest";
import { classifyRunOutcome } from "../src/policy/classify.js";

const pass = { timedOut: false, exitCode: 0 };

type Input = Parameters<typeof classifyRunOutcome>[0];

function input(overrides: Partial<Input> = {}): Input {
  return {
    agentTimedOut: false,
    agentExitCode: 0,
    validationPassed: true,
    validationResults: [pass],
    benchmarkScoped: false,
    outOfScopeFiles: [],
    ...overrides,
  };
}

it("accepts a clean passing run", () => {
  const outcome = classifyRunOutcome(input());
  expect(outcome.runState).toBe("accepted");
  expect(outcome.failureClassification).toBeNull();
});

it("flags accepted runs whose agent process exited nonzero", () => {
  const outcome = classifyRunOutcome(input({ agentExitCode: 2 }));
  expect(outcome.runState).toBe("accepted");
  expect(outcome.failureClassification).toBe("agent_exit_nonzero_validation_passed");
});

it("rejects failing validation as validation_failed", () => {
  const outcome = classifyRunOutcome(
    input({
      validationPassed: false,
      validationResults: [{ timedOut: false, exitCode: 1 }],
    }),
  );
  expect(outcome.runState).toBe("rejected");
  expect(outcome.failureClassification).toBe("validation_failed");
});

it("prefers agent timeout over rejection when validation also fails", () => {
  const outcome = classifyRunOutcome(
    input({
      validationPassed: false,
      agentTimedOut: true,
      validationResults: [{ timedOut: true, exitCode: null }],
    }),
  );
  expect(outcome.runState).toBe("timed_out");
  expect(outcome.failureClassification).toBe("agent_timeout");
});

it("classifies editable scope violations with the offending files", () => {
  const outcome = classifyRunOutcome(input({ outOfScopeFiles: ["src/a.ts", "src/b.ts"] }));
  expect(outcome.runState).toBe("rejected");
  expect(outcome.failureClassification).toBe("editable_scope_violation:src/a.ts,src/b.ts");
});

it("treats validator timeouts as infrastructure failure for scoped tasks", () => {
  const outcome = classifyRunOutcome(
    input({ benchmarkScoped: true, validationResults: [{ timedOut: true, exitCode: null }] }),
  );
  expect(outcome.runState).toBe("infrastructure_failed");
  expect(outcome.failureClassification).toBe("validator_infrastructure_failure");
});

it("treats validator exit codes above one as infrastructure failure", () => {
  const outcome = classifyRunOutcome(
    input({ benchmarkScoped: true, validationResults: [pass, { timedOut: false, exitCode: 2 }] }),
  );
  expect(outcome.runState).toBe("infrastructure_failed");
});

it("ignores validator exit-code anomalies for unscoped tasks", () => {
  const outcome = classifyRunOutcome(
    input({ benchmarkScoped: false, validationResults: [{ timedOut: false, exitCode: 3 }] }),
  );
  expect(outcome.runState).toBe("accepted");
});
