import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { ConfigurationError } from "./config.js";

const LEDGER_KIT_TASK_IDS = Object.freeze([
  "fix-parse-money",
  "add-volume-discount",
  "validate-sku",
  "one-based-pagination",
  "extract-normalize-email",
  "parse-config-comments",
]);

export const REAL_SCALE_2_EXPECTED = Object.freeze({
  experimentName: "real-scale-2",
  agent: "codex" as const,
  workerCounts: [1, 2],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: LEDGER_KIT_TASK_IDS,
  timeoutSecondsPerTask: 180,
  integration: false,
});

export const REAL_SCALE_4_EXPECTED = Object.freeze({
  experimentName: "real-scale-4",
  agent: "codex" as const,
  workerCounts: [1, 2, 4],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: LEDGER_KIT_TASK_IDS,
  timeoutSecondsPerTask: 180,
  integration: false,
});

export const OPENCODE_SCALE_4_EXPECTED = Object.freeze({
  experimentName: "opencode-scale-4",
  agent: "opencode" as const,
  agentModel: "opencode/deepseek-v4-flash-free",
  workerCounts: [1, 2, 4],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: LEDGER_KIT_TASK_IDS,
  timeoutSecondsPerTask: 180,
  integration: false,
});

export const OPENCODE_SCALE_4_DIAGNOSTIC_EXPECTED = Object.freeze({
  experimentName: "opencode-scale-4-diagnostic",
  agent: "opencode" as const,
  agentModel: "opencode/deepseek-v4-flash-free",
  workerCounts: [1, 2, 4],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: LEDGER_KIT_TASK_IDS,
  timeoutSecondsPerTask: 180,
  integration: false,
});

export const OPENCODE_CAPACITY_CURVE_EXPECTED = Object.freeze({
  experimentName: "opencode-capacity-curve",
  agent: "opencode" as const,
  // Provider-forced substitution: deepseek-v4-flash-free was removed from the
  // provider catalog mid-task (documented in the frozen file's deviations).
  agentModel: "opencode/hy3-free",
  workerCounts: [1, 2, 3, 4],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: LEDGER_KIT_TASK_IDS,
  timeoutSecondsPerTask: 180,
  integration: false,
});

const frozenExperimentSchema = z
  .object({
    experimentName: z.string().min(1),
    configuration: z
      .object({
        agent: z.enum(["fake", "codex", "opencode"]),
        agentVersion: z.string().nullable().optional(),
        agentModel: z.string().nullable().optional(),
        workerCounts: z.array(z.number().int().positive()).min(1),
        repetitions: z.number().int().positive(),
        seed: z.number().int(),
        taskFile: z.string().min(1),
        taskCount: z.number().int().positive().optional(),
        taskIds: z.array(z.string().min(1)).optional(),
        timeoutSecondsPerTask: z.number().positive().optional(),
        integration: z.boolean(),
        intendedCommand: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type FrozenExperiment = z.infer<typeof frozenExperimentSchema>;

export async function loadFrozenExperiment(path: string): Promise<FrozenExperiment> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`unable to read frozen experiment: ${detail}`);
  }
  const parsed = frozenExperimentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigurationError(`invalid frozen experiment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

type ExpectedFrozenExperiment = {
  readonly experimentName: string;
  readonly agent: "codex" | "opencode";
  readonly agentModel?: string;
  readonly workerCounts: readonly number[];
  readonly repetitions: number;
  readonly seed: number;
  readonly taskFile: string;
  readonly taskCount: number;
  readonly taskIds: readonly string[];
  readonly timeoutSecondsPerTask: number;
  readonly integration: boolean;
};

function expectedForExperiment(experimentName: string): ExpectedFrozenExperiment | null {
  if (experimentName === REAL_SCALE_2_EXPECTED.experimentName) return REAL_SCALE_2_EXPECTED;
  if (experimentName === REAL_SCALE_4_EXPECTED.experimentName) return REAL_SCALE_4_EXPECTED;
  if (experimentName === OPENCODE_SCALE_4_EXPECTED.experimentName) return OPENCODE_SCALE_4_EXPECTED;
  if (experimentName === OPENCODE_SCALE_4_DIAGNOSTIC_EXPECTED.experimentName) {
    return OPENCODE_SCALE_4_DIAGNOSTIC_EXPECTED;
  }
  if (experimentName === OPENCODE_CAPACITY_CURVE_EXPECTED.experimentName) {
    return OPENCODE_CAPACITY_CURVE_EXPECTED;
  }
  return null;
}

export function frozenSemanticMismatches(frozen: FrozenExperiment): readonly string[] {
  const expected = expectedForExperiment(frozen.experimentName);
  if (expected === null) return [];
  const configuration = frozen.configuration;
  const mismatches: string[] = [];
  if (configuration.agent !== expected.agent) mismatches.push("agent");
  if (expected.agentModel !== undefined && configuration.agentModel !== expected.agentModel) {
    mismatches.push("agentModel");
  }
  if (JSON.stringify(configuration.workerCounts) !== JSON.stringify(expected.workerCounts)) {
    mismatches.push("workerCounts");
  }
  if (configuration.repetitions !== expected.repetitions) mismatches.push("repetitions");
  if (configuration.seed !== expected.seed) mismatches.push("seed");
  if (configuration.taskFile !== expected.taskFile) mismatches.push("taskFile");
  if (configuration.taskCount !== expected.taskCount) mismatches.push("taskCount");
  if (
    configuration.taskIds !== undefined &&
    JSON.stringify(configuration.taskIds) !== JSON.stringify(expected.taskIds)
  ) {
    mismatches.push("taskIds");
  }
  if (configuration.timeoutSecondsPerTask !== expected.timeoutSecondsPerTask) {
    mismatches.push("timeoutSecondsPerTask");
  }
  if (configuration.integration !== expected.integration) mismatches.push("integration");
  return mismatches;
}

export function isLedgerKitExperiment(experimentName: string): boolean {
  return expectedForExperiment(experimentName) !== null;
}
