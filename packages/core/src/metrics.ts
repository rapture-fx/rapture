import { z } from "zod";
import { readEvents } from "./events.js";
import type { ExperimentMetrics, WorkerMetrics } from "./models.js";

const commandSchema = z.array(z.string());
const taskFinishedSchema = z.object({
  workerCount: z.number().int().positive(),
  accepted: z.boolean(),
  durationMs: z.number().nonnegative(),
  validationResult: z.enum(["passed", "failed", "not_run"]),
  commands: z.array(commandSchema),
  testInvocations: z.array(commandSchema),
  buildInvocations: z.array(commandSchema),
  tokenUsage: z.number().nonnegative().nullable(),
  providerCost: z.number().nonnegative().nullable(),
});

const taskBoundarySchema = z.object({ workerCount: z.number().int().positive() });
const integrationSchema = z.object({
  workerCount: z.number().int().positive(),
  status: z.enum(["passed", "failed", "conflict"]),
});

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) return null;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? null : (left + right) / 2;
}

function duplicates(commands: readonly (readonly string[])[]): number {
  const counts = new Map<string, number>();
  for (const command of commands) {
    const key = JSON.stringify(command);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

export async function deriveMetrics(eventsPath: string): Promise<ExperimentMetrics> {
  const events = await readEvents(eventsPath);
  const finished = new Map<number, z.infer<typeof taskFinishedSchema>[]>();
  const boundaries = new Map<number, number[]>();
  const integrations = new Map<number, z.infer<typeof integrationSchema>>();
  for (const event of events) {
    if (event.eventType === "task_finished") {
      const data = taskFinishedSchema.parse(event.data);
      const existing = finished.get(data.workerCount) ?? [];
      existing.push(data);
      finished.set(data.workerCount, existing);
    }
    if (event.eventType === "task_started" || event.eventType === "task_finished") {
      const data = taskBoundarySchema.parse(event.data);
      const existing = boundaries.get(data.workerCount) ?? [];
      existing.push(Date.parse(event.timestamp));
      boundaries.set(data.workerCount, existing);
    }
    if (event.eventType === "integration_finished") {
      const data = integrationSchema.parse(event.data);
      integrations.set(data.workerCount, data);
    }
  }

  const rows: WorkerMetrics[] = [];
  let baseline: number | null = null;
  for (const workerCount of [...finished.keys()].sort((left, right) => left - right)) {
    const runs = finished.get(workerCount) ?? [];
    const times = boundaries.get(workerCount) ?? [];
    const durationHours =
      times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : 0;
    const integration = integrations.get(workerCount);
    const validated = runs.filter((run) => run.accepted).length;
    const accepted = integration !== undefined && integration.status !== "passed" ? 0 : validated;
    const throughput = durationHours > 0 ? accepted / durationHours : null;
    if (workerCount === 1) baseline = throughput;
    const acceptedRuns = runs.filter((run) => run.accepted);
    const totalTokens = acceptedRuns.every((run) => run.tokenUsage !== null)
      ? acceptedRuns.reduce((total, run) => total + (run.tokenUsage ?? 0), 0)
      : null;
    const totalCost = acceptedRuns.every((run) => run.providerCost !== null)
      ? acceptedRuns.reduce((total, run) => total + (run.providerCost ?? 0), 0)
      : null;
    rows.push({
      workerCount,
      taskRuns: runs.length,
      acceptedTasks: accepted,
      acceptedTasksPerHour: throughput,
      speedup: throughput !== null && baseline ? throughput / baseline : null,
      parallelEfficiency:
        throughput !== null && baseline ? throughput / (workerCount * baseline) : null,
      medianDurationMs: median(runs.map((run) => run.durationMs)),
      p95DurationMs: percentile(
        runs.map((run) => run.durationMs),
        0.95,
      ),
      validationFailureRate:
        runs.length > 0
          ? runs.filter((run) => run.validationResult !== "passed").length / runs.length
          : null,
      integrationFailureRate:
        integration === undefined ? null : integration.status === "passed" ? 0 : 1,
      duplicateCommands: duplicates(runs.flatMap((run) => run.commands)),
      duplicateTestInvocations: duplicates(runs.flatMap((run) => run.testInvocations)),
      duplicateBuildInvocations: duplicates(runs.flatMap((run) => run.buildInvocations)),
      tokenUsagePerAcceptedTask:
        totalTokens !== null && accepted > 0 ? totalTokens / accepted : null,
      providerCostPerAcceptedTask: totalCost !== null && accepted > 0 ? totalCost / accepted : null,
    });
  }
  return { schemaVersion: 1, workerResults: rows };
}
