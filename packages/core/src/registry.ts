import { subscriptionSeatUpgradeScenario } from "./reference/subscription-seat-upgrade.js";
import { type RunScenarioOptions, runScenario, type ScenarioResult } from "./scenario.js";

export interface ScenarioSummary {
  readonly name: string;
  readonly description: string;
}

export function listScenarios(): readonly ScenarioSummary[] {
  return [
    {
      name: subscriptionSeatUpgradeScenario.name,
      description: subscriptionSeatUpgradeScenario.description,
    },
  ];
}

export async function runNamedScenario(
  name: string,
  options: RunScenarioOptions = {},
): Promise<ScenarioResult> {
  if (name !== subscriptionSeatUpgradeScenario.name) {
    throw new Error(`unknown scenario: ${name}`);
  }
  return runScenario(subscriptionSeatUpgradeScenario, options);
}
