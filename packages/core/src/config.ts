import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ExperimentConfig, TaskDefinition } from "./models.js";

const fakeAgentSchema = z
  .object({
    files: z.record(z.string(), z.string()).default({}),
    exitCode: z.number().int().default(0),
    delayMs: z.number().nonnegative().default(0),
    stdout: z.string().default("fake agent completed"),
    stderr: z.string().default(""),
  })
  .strict();

export const taskDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    baseCommit: z.string().trim().min(1).default("HEAD"),
    validation: z.array(z.string().trim().min(1)).min(1),
    timeoutSeconds: z.number().positive().default(900),
    independent: z.boolean().default(true),
    dependsOn: z.array(z.string().trim().min(1)).default([]),
    fake: fakeAgentSchema.optional(),
  })
  .strict();

const taskFileSchema = z
  .object({ tasks: z.array(taskDefinitionSchema).min(1) })
  .strict()
  .superRefine(({ tasks }, context) => {
    const ids = new Set<string>();
    for (const [index, task] of tasks.entries()) {
      if (ids.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `duplicate task ID: ${task.id}`,
        });
      }
      ids.add(task.id);
    }
    for (const [index, task] of tasks.entries()) {
      for (const dependency of task.dependsOn) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "dependsOn"],
            message: `unknown dependency: ${dependency}`,
          });
        }
      }
    }

    const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (taskId: string): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      for (const dependency of graph.get(taskId) ?? []) {
        if (visit(dependency)) return true;
      }
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    for (const task of tasks) {
      if (visit(task.id)) {
        context.addIssue({ code: "custom", path: ["tasks"], message: "dependency cycle detected" });
        break;
      }
    }
  });

export class ConfigurationError extends Error {
  public override readonly name = "ConfigurationError";
}

export function parseWorkerCounts(value: string): readonly number[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new ConfigurationError("worker counts must be comma-separated positive integers");
  }
  const workers = parts.map(Number);
  if (workers.some((worker) => !Number.isSafeInteger(worker) || worker <= 0)) {
    throw new ConfigurationError("worker counts must be positive safe integers");
  }
  if (new Set(workers).size !== workers.length) {
    throw new ConfigurationError("worker counts must not contain duplicates");
  }
  return workers;
}

export function parseTaskFile(value: unknown): readonly TaskDefinition[] {
  const result = taskFileSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigurationError(z.prettifyError(result.error));
  }
  return result.data.tasks.map(({ fake, ...task }) =>
    fake === undefined ? task : { ...task, fake },
  );
}

export async function loadTasks(path: string): Promise<readonly TaskDefinition[]> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`unable to read task file: ${detail}`);
  }
  return parseTaskFile(value);
}

export interface BuildConfigInput {
  readonly repository: string;
  readonly taskFile: string;
  readonly workers: string;
  readonly agent: "fake" | "codex";
  readonly outputDirectory: string;
  readonly integration: boolean;
  readonly integrationValidation: readonly string[];
}

export async function buildExperimentConfig(input: BuildConfigInput): Promise<ExperimentConfig> {
  if (input.integration && input.integrationValidation.length === 0) {
    throw new ConfigurationError("integration requires explicit integration validation commands");
  }
  const tasks = await loadTasks(resolve(input.taskFile));
  return {
    repository: resolve(input.repository),
    taskFile: resolve(input.taskFile),
    tasks,
    workerCounts: parseWorkerCounts(input.workers),
    agent: input.agent,
    outputDirectory: resolve(input.outputDirectory),
    budget: {},
    seed: 0,
    integration: input.integration,
    integrationValidation: input.integrationValidation,
  };
}
