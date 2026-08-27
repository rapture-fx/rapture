import { subscriptionSeatUpgradeScenario } from "./reference/subscription-seat-upgrade.js";
import { subscriptionSeatUpgradePostgresScenario } from "./reference/subscription-seat-upgrade-postgres.js";
import { type RunScenarioOptions, runScenario, type ScenarioResult } from "./scenario.js";

/**
 * Which world backs the reference scenario. The scenario itself — name, fixture,
 * expectations, business semantics — is identical either way.
 */
export type ScenarioWorldKind = "memory" | "postgres";

export const SCENARIO_WORLD_KINDS: readonly ScenarioWorldKind[] = ["memory", "postgres"];

export function isScenarioWorldKind(value: string): value is ScenarioWorldKind {
  return (SCENARIO_WORLD_KINDS as readonly string[]).includes(value);
}

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
  world: ScenarioWorldKind = "memory",
): Promise<ScenarioResult> {
  if (name !== subscriptionSeatUpgradeScenario.name) {
    throw new Error(`unknown scenario: ${name}`);
  }
  return runScenario(
    world === "postgres"
      ? subscriptionSeatUpgradePostgresScenario
      : subscriptionSeatUpgradeScenario,
    options,
  );
}
