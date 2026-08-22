import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { loadPricingContext } from "./economics.js";
import type {
  ExperimentConfig,
  FakeAgentConfig,
  FakeUsageConfig,
  TaskDefinition,
} from "./models.js";
import { parseCommand } from "./validation.js";

const fakeUsageSchema = z
  .object({
    inputTokens: z.number().nonnegative().nullable().optional(),
    outputTokens: z.number().nonnegative().nullable().optional(),
    cachedInputTokens: z.number().nonnegative().nullable().optional(),
    reasoningTokens: z.number().nonnegative().nullable().optional(),
    providerReportedCost: z.number().nonnegative().nullable().optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/u)
      .nullable()
      .optional(),
  })
  .strict();

const fakeAgentSchema = z
  .object({
    files: z.record(z.string(), z.string()).default({}),
    exitCode: z.number().int().default(0),
    delayMs: z.number().nonnegative().default(0),
    stdout: z.string().default("fake agent completed"),
    stderr: z.string().default(""),
    failOnRepetition: z.number().int().positive().optional(),
    usage: fakeUsageSchema.optional(),
  })
  .strict();

const benchmarkTaskProvenanceSchema = z
  .object({
    suiteId: z.string().trim().min(1),
    suiteVersion: z.string().trim().min(1),
    repositoryId: z.string().trim().min(1),
    editableScope: z.array(z.string().trim().min(1)).min(1),
    taskClass: z.enum([
      "bug_fix",
      "small_feature",
      "refactor",
      "test_repair",
      "repository_exploration",
      "build_or_typecheck_heavy",
      "config_change",
      "api_change",
    ]),
    // Carried through the materialize -> run round trip so the features an analysis reads
    // come from the frozen task definition rather than being re-derived later.
    delegationFeatures: z
      .object({
        acceptanceCriteriaType: z.enum([
          "unit_test",
          "integration_test",
          "type_contract",
          "static_analysis",
          "behavioral_contract",
        ]),
        editableFileCount: z.number().int().positive(),
        expectedChangeBreadth: z.enum(["single_file", "multi_file_single_module", "cross_module"]),
        specificationClarity: z.enum(["explicit", "moderate", "underspecified"]),
        verificationCostClass: z.enum(["cheap", "moderate", "expensive"]),
        reversibility: z.enum(["fully_reversible", "reversible_with_review", "high_consequence"]),
      })
      .strict()
      .optional(),
  })
  .strict();

const taskContextSchema = z
  .object({
    files: z.record(z.string().trim().min(1), z.string()),
    ignorePaths: z.array(z.string().trim().min(1)).readonly(),
    promptSuffix: z.string(),
  })
  .strict();

export const taskDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    context: taskContextSchema.optional(),
    description: z.string().trim().min(1),
    baseCommit: z.string().trim().min(1).default("HEAD"),
    validation: z.array(z.string().trim().min(1)).min(1),
    timeoutSeconds: z.number().positive().default(900),
    independent: z.boolean().default(true),
    dependsOn: z.array(z.string().trim().min(1)).default([]),
    fake: fakeAgentSchema.optional(),
    benchmark: benchmarkTaskProvenanceSchema.optional(),
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

export function parseRepetitions(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigurationError("repetitions must be a positive integer");
  }
  const repetitions = Number(value);
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
    throw new ConfigurationError("repetitions must be a positive safe integer");
  }
  return repetitions;
}

export function parseSeed(value: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new ConfigurationError("seed must be an integer");
  }
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) {
    throw new ConfigurationError("seed must be a safe integer");
  }
  return seed;
}

function quoteArgv(args: readonly string[]): string {
  return args
    .map((arg) => (/^[A-Za-z0-9_./:@+=,-]+$/u.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveValidationCommand(
  command: string,
  taskDirectory: string,
): Promise<string> {
  const args = parseCommand(command);
  const resolved = await Promise.all(
    args.map(async (arg) => {
      if (arg.startsWith("-")) return arg;
      const looksLikePath = arg.includes("/") || /\.[A-Za-z0-9]+$/u.test(arg);
      if (!looksLikePath) return arg;
      const candidate = resolve(taskDirectory, arg);
      return (await pathExists(candidate)) ? candidate : arg;
    }),
  );
  return quoteArgv(resolved);
}

function toFakeAgentConfig(fake: {
  readonly files: Readonly<Record<string, string>>;
  readonly exitCode: number;
  readonly delayMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failOnRepetition?: number | undefined;
  readonly usage?: FakeUsageConfig | undefined;
}): FakeAgentConfig {
  const failOnRepetition = fake.failOnRepetition;
  const base = {
    files: fake.files,
    exitCode: fake.exitCode,
    delayMs: fake.delayMs,
    stdout: fake.stdout,
    stderr: fake.stderr,
    ...(fake.usage === undefined ? {} : { usage: fake.usage }),
  };
  return failOnRepetition === undefined ? base : { ...base, failOnRepetition };
}

export function parseTaskFile(value: unknown): readonly TaskDefinition[] {
  const result = taskFileSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigurationError(z.prettifyError(result.error));
  }
  return result.data.tasks.map(({ fake, benchmark, ...task }) => {
    const withBenchmark = benchmark === undefined ? task : { ...task, benchmark };
    return fake === undefined ? withBenchmark : { ...withBenchmark, fake: toFakeAgentConfig(fake) };
  });
}

export async function loadTasks(path: string): Promise<readonly TaskDefinition[]> {
  const resolvedPath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolvedPath, "utf8")) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`unable to read task file: ${detail}`);
  }
  const taskDirectory = dirname(resolvedPath);
  const tasks = parseTaskFile(value);
  return Promise.all(
    tasks.map(async (task) => ({
      ...task,
      validation: await Promise.all(
        task.validation.map((command) => resolveValidationCommand(command, taskDirectory)),
      ),
    })),
  );
}

export interface BuildConfigInput {
  readonly repository: string;
  readonly taskFile: string;
  readonly workers: string;
  readonly repetitions?: string;
  readonly seed?: string;
  readonly agent: "fake" | "codex" | "opencode";
  readonly agentModel?: string;
  readonly outputDirectory: string;
  readonly integration: boolean;
  readonly integrationValidation: readonly string[];
  readonly order?: string;
  readonly pricingPath?: string;
}

export function parseExecutionOrder(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (value === "repetition-major" || value === "worker-major") return value;
  throw new ConfigurationError(
    `invalid execution order "${value}": expected repetition-major or worker-major`,
  );
}

export async function buildExperimentConfig(input: BuildConfigInput): Promise<ExperimentConfig> {
  if (input.integration && input.integrationValidation.length === 0) {
    throw new ConfigurationError("integration requires explicit integration validation commands");
  }
  const taskFile = resolve(input.taskFile);
  const tasks = await loadTasks(taskFile);
  const pricing =
    input.pricingPath === undefined ? null : await loadPricingContext(input.pricingPath);
  return {
    repository: resolve(input.repository),
    taskFile,
    tasks,
    workerCounts: parseWorkerCounts(input.workers),
    repetitions: parseRepetitions(input.repetitions ?? "1"),
    agent: input.agent,
    agentModel:
      input.agentModel === undefined || input.agentModel.trim() === "" ? null : input.agentModel,
    outputDirectory: resolve(input.outputDirectory),
    budget: {},
    seed: parseSeed(input.seed ?? "0"),
    integration: input.integration,
    integrationValidation: input.integrationValidation,
    executionOrder: parseExecutionOrder(input.order),
    pricing,
  };
}
