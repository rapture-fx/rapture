import type { ScenarioResult } from "./scenario.js";

function value(value: unknown, present: boolean): string {
  return present ? JSON.stringify(value) : "<missing>";
}

export function formatScenarioResult(result: ScenarioResult): string {
  const lines = ["RAPTURE", `Scenario: ${result.scenarioName}`, "", "World"];
  const prepare = result.stages.find((stage) => stage.phase === "prepare");
  const seed = result.stages.find((stage) => stage.phase === "seed");
  lines.push(`${prepare?.status === "PASS" ? "PASS" : "ERROR"} world prepared`);
  lines.push(`${seed?.status === "PASS" ? "PASS" : "ERROR"} fixture loaded`);
  lines.push("", "Action");
  const action = result.stages.find((stage) => stage.phase === "action");
  lines.push(`${action?.status === "PASS" ? "PASS" : "ERROR"} workflow executed`);
  lines.push("", "State");
  for (const expectation of result.expectations) {
    lines.push(
      `${expectation.status} ${expectation.path} expected=${value(
        expectation.expected,
        expectation.hasExpected,
      )} actual=${value(expectation.actual, expectation.hasActual)}`,
    );
  }
  for (const failure of result.failures) {
    lines.push(`ERROR ${failure.phase}: ${failure.name}: ${failure.message}`);
  }
  lines.push("", `RESULT: ${result.status}`, "");
  return lines.join("\n");
}
