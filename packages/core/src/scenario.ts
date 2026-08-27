import { createJsonlAppender, type JsonValue, redactSecrets, sha256 } from "@rapture/kernel";
import { diffState, type StateExpectation } from "./state-diff.js";

export const SCENARIO_RESULT_SCHEMA_VERSION = "1";

export type ScenarioStatus = "PASS" | "FAIL" | "ERROR";
export type ScenarioPhase = "prepare" | "seed" | "action" | "observe" | "expect" | "reset";

export interface ScenarioStage {
  readonly phase: ScenarioPhase;
  readonly status: "PASS" | "ERROR" | "SKIPPED";
}

export interface ScenarioFailure {
  readonly phase: ScenarioPhase;
  readonly name: string;
  readonly message: string;
}

export interface ScenarioArtifact {
  readonly kind: string;
  readonly path: string;
  readonly sha256?: string;
}

export interface ScenarioResult {
  readonly schemaVersion: typeof SCENARIO_RESULT_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: ScenarioStatus;
  readonly stages: readonly ScenarioStage[];
  readonly expectations: readonly StateExpectation[];
  readonly observedState?: JsonValue;
  readonly artifacts: readonly ScenarioArtifact[];
  readonly failures: readonly ScenarioFailure[];
  readonly resultHash: string;
}

export interface ScenarioWorld<Fixture, Observation extends JsonValue> {
  readonly prepare: () => Promise<void>;
  readonly seedOrRestore: (fixture: Fixture) => Promise<void>;
  readonly run: () => Promise<void>;
  readonly observe: () => Promise<Observation>;
  readonly disposeOrReset: () => Promise<void>;
}

export interface ScenarioDefinition<Fixture, Observation extends JsonValue> {
  readonly name: string;
  readonly description: string;
  readonly fixture: Fixture;
  readonly expected: Observation;
  readonly unexpectedState?: "ignore" | "fail";
  readonly createWorld: () => ScenarioWorld<Fixture, Observation>;
}

export interface ScenarioEvent {
  readonly schemaVersion: "1";
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly phase: ScenarioPhase;
  readonly status: "PASS" | "ERROR";
  readonly at: string;
}

export interface ScenarioJournal {
  readonly append: (event: ScenarioEvent) => Promise<void>;
}

export interface RunScenarioOptions {
  readonly clock?: () => Date;
  readonly journal?: ScenarioJournal;
}

export function defineScenario<Fixture, Observation extends JsonValue>(
  definition: ScenarioDefinition<Fixture, Observation>,
): ScenarioDefinition<Fixture, Observation> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(definition.name)) {
    throw new Error("scenario name must be lowercase kebab-case");
  }
  return definition;
}

export async function createScenarioJournal(path: string): Promise<ScenarioJournal> {
  const appender = await createJsonlAppender(path);
  return {
    append: async (event) => appender.appendLine(JSON.stringify(event)),
  };
}

function toFailure(phase: ScenarioPhase, error: unknown): ScenarioFailure {
  if (error instanceof Error) {
    return { phase, name: error.name, message: redactSecrets(error.message) };
  }
  return { phase, name: "Error", message: redactSecrets(String(error)) };
}

function deterministicResultHash(input: {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly status: ScenarioStatus;
  readonly expectations: readonly StateExpectation[];
  readonly observedState?: JsonValue;
  readonly failures: readonly ScenarioFailure[];
}): string {
  return sha256(JSON.stringify({ schemaVersion: SCENARIO_RESULT_SCHEMA_VERSION, ...input }));
}

export async function runScenario<Fixture, Observation extends JsonValue>(
  definition: ScenarioDefinition<Fixture, Observation>,
  options: RunScenarioOptions = {},
): Promise<ScenarioResult> {
  const clock = options.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const scenarioId = sha256(`rapture-scenario:v1:${definition.name}`);
  const stages: ScenarioStage[] = [];
  const failures: ScenarioFailure[] = [];
  let phase: ScenarioPhase = "prepare";
  let status: ScenarioStatus = "ERROR";
  let expectations: readonly StateExpectation[] = [];
  let observedState: JsonValue | undefined;
  let world: ScenarioWorld<Fixture, Observation> | undefined;

  const record = async (recordPhase: ScenarioPhase, recordStatus: "PASS" | "ERROR") => {
    await options.journal?.append({
      schemaVersion: "1",
      scenarioId,
      scenarioName: definition.name,
      phase: recordPhase,
      status: recordStatus,
      at: clock().toISOString(),
    });
    stages.push({ phase: recordPhase, status: recordStatus });
  };

  try {
    world = definition.createWorld();
    await world.prepare();
    await record("prepare", "PASS");

    phase = "seed";
    await world.seedOrRestore(definition.fixture);
    await record("seed", "PASS");

    phase = "action";
    await world.run();
    await record("action", "PASS");

    phase = "observe";
    observedState = await world.observe();
    await record("observe", "PASS");

    phase = "expect";
    expectations = diffState(definition.expected, observedState, {
      unexpected: definition.unexpectedState ?? "ignore",
    });
    await record("expect", "PASS");
    status = expectations.some((entry) => entry.status === "FAIL") ? "FAIL" : "PASS";
  } catch (error: unknown) {
    failures.push(toFailure(phase, error));
    status = "ERROR";
    if (!stages.some((stage) => stage.phase === phase)) {
      stages.push({ phase, status: "ERROR" });
    }
  } finally {
    if (world === undefined) {
      stages.push({ phase: "reset", status: "SKIPPED" });
    } else {
      try {
        await world.disposeOrReset();
        await record("reset", "PASS");
      } catch (error: unknown) {
        failures.push(toFailure("reset", error));
        status = "ERROR";
        stages.push({ phase: "reset", status: "ERROR" });
      }
    }
  }

  const completedAt = clock().toISOString();
  const hashInput = {
    scenarioId,
    scenarioName: definition.name,
    status,
    expectations,
    ...(observedState === undefined ? {} : { observedState }),
    failures,
  };
  return {
    schemaVersion: SCENARIO_RESULT_SCHEMA_VERSION,
    scenarioId,
    scenarioName: definition.name,
    startedAt,
    completedAt,
    status,
    stages,
    expectations,
    ...(observedState === undefined ? {} : { observedState }),
    artifacts: [],
    failures,
    resultHash: deterministicResultHash(hashInput),
  };
}
