import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { ConfigurationError } from "./config.js";

export const REAL_SCALE_2_EXPECTED = Object.freeze({
  experimentName: "real-scale-2",
  agent: "codex" as const,
  workerCounts: [1, 2],
  repetitions: 3,
  seed: 20260817,
  taskFile: "fixtures/ledger-kit/tasks.json",
  taskCount: 6,
  taskIds: [
    "fix-parse-money",
    "add-volume-discount",
    "validate-sku",
    "one-based-pagination",
    "extract-normalize-email",
    "parse-config-comments",
  ],
  timeoutSecondsPerTask: 180,
  integration: false,
});

const frozenExperimentSchema = z
  .object({
    experimentName: z.string().min(1),
    configuration: z
      .object({
        agent: z.enum(["fake", "codex"]),
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

export function frozenSemanticMismatches(frozen: FrozenExperiment): readonly string[] {
  if (frozen.experimentName !== REAL_SCALE_2_EXPECTED.experimentName) return [];
  const configuration = frozen.configuration;
  const expected = REAL_SCALE_2_EXPECTED;
  const mismatches: string[] = [];
  if (configuration.agent !== expected.agent) mismatches.push("agent");
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
