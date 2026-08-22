import { z } from "zod";
import { readEvents } from "./events.js";
import type { ExperimentMetrics, PhaseTimings, TrialMetrics, WorkerMetrics } from "./models.js";
import { raptureOverheadMs } from "./timing.js";
import { trialIdFor } from "./trial.js";

const commandSchema = z.array(z.string());
const phaseTimingsSchema = z.object({
  worktreeSetupMs: z.number().nonnegative().nullable(),
  queueWaitMs: z.number().nonnegative().nullable(),
  agentExecutionMs: z.number().nonnegative().nullable(),
  validationMs: z.number().nonnegative().nullable(),
  artifactPersistenceMs: z.number().nonnegative().nullable(),
  integrationMs: z.number().nonnegative().nullable(),
  worktreeCleanupMs: z.number().nonnegative().nullable(),
  otherOrchestrationMs: z.number().nonnegative().nullable(),
  totalRunMs: z.number().nonnegative(),
});

const taskFinishedSchema = z.object({
  trialId: z.string().min(1).optional(),
  repetition: z.number().int().positive().optional(),
  workerCount: z.number().int().positive(),
  accepted: z.boolean(),
  runState: z
    .enum([
      "pending",
      "running",
      "accepted",
      "rejected",
      "timed_out",
      "provider_blocked",
      "infrastructure_failed",
      "interrupted",
    ])
    .optional(),
  durationMs: z.number().nonnegative(),
  validationResult: z.enum(["passed", "failed", "not_run"]),
  commands: z.array(commandSchema),
  testInvocations: z.array(commandSchema),
  buildInvocations: z.array(commandSchema),
  tokenUsage: z.number().nonnegative().nullable(),
  providerCost: z.number().nonnegative().nullable(),
  phaseTimings: phaseTimingsSchema.optional(),
});

const taskBoundarySchema = z.object({
  trialId: z.string().min(1).optional(),
  workerCount: z.number().int().positive(),
});

const trialBoundarySchema = z.object({
  trialId: z.string().min(1),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive(),
  trialSeed: z.number().int().nonnegative().optional(),
  taskOrder: z.array(z.string()).optional(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(["completed", "failed"]).optional(),
});

const integrationSchema = z.object({
  trialId: z.string().min(1).optional(),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive().optional(),
  status: z.enum(["passed", "failed", "conflict"]),
  durationMs: z.number().nonnegative().optional(),
});

interface TaskRecord {
  readonly trialId: string;
  readonly workerCount: number;
  readonly accepted: boolean;
  readonly runState:
    | "pending"
    | "running"
    | "accepted"
    | "rejected"
    | "timed_out"
    | "provider_blocked"
    | "infrastructure_failed"
    | "interrupted"
    | null;
  readonly durationMs: number;
  readonly validationResult: "passed" | "failed" | "not_run";
  readonly commands: readonly (readonly string[])[];
  readonly testInvocations: readonly (readonly string[])[];
  readonly buildInvocations: readonly (readonly string[])[];
  readonly tokenUsage: number | null;
  readonly providerCost: number | null;
  readonly phaseTimings: PhaseTimings | null;
}

function isGenuineFailure(run: TaskRecord): boolean {
  if (run.runState === "provider_blocked" || run.runState === "infrastructure_failed") {
    return false;
  }
  return run.validationResult !== "passed";
}

interface TrialRecord {
  trialId: string;
  workerCount: number;
  repetition: number;
  trialSeed: number | null;
  taskOrder: string[];
  durationMs: number | null;
  boundaryTimes: number[];
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function median(values: readonly number[]): number | null {
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

function implicitTrialId(workerCount: number, repetition = 1): string {
  return trialIdFor(workerCount, repetition);
}

function throughput(accepted: number, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  return accepted / (durationMs / 3_600_000);
}

function sumIfComplete(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function collectNumbers(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function trialMetricsFrom(
  trial: TrialRecord,
  runs: readonly TaskRecord[],
  integration: z.infer<typeof integrationSchema> | undefined,
): TrialMetrics {
  const durationMs =
    trial.durationMs ??
    (trial.boundaryTimes.length > 1
      ? Math.max(...trial.boundaryTimes) - Math.min(...trial.boundaryTimes)
      : null);
  const validated = runs.filter((run) => run.accepted).length;
  const accepted = integration !== undefined && integration.status !== "passed" ? 0 : validated;
  const agentTimes = collectNumbers(runs.map((run) => run.phaseTimings?.agentExecutionMs ?? null));
  const validationTimes = collectNumbers(runs.map((run) => run.phaseTimings?.validationMs ?? null));
  const overheadTimes = collectNumbers(
    runs.map((run) => (run.phaseTimings === null ? null : raptureOverheadMs(run.phaseTimings))),
  );
  const tokenUsage = sumIfComplete(runs.filter((run) => run.accepted).map((run) => run.tokenUsage));
  const providerCost = sumIfComplete(
    runs.filter((run) => run.accepted).map((run) => run.providerCost),
  );
  return {
    trialId: trial.trialId,
    workerCount: trial.workerCount,
    repetition: trial.repetition,
    trialSeed: trial.trialSeed,
    taskOrder: trial.taskOrder,
    acceptedTasks: accepted,
    acceptedTasksPerHour: throughput(accepted, durationMs),
    totalWallTimeMs: durationMs,
    medianTaskLatencyMs: median(runs.map((run) => run.durationMs)),
    p95TaskLatencyMs: percentile(
      runs.map((run) => run.durationMs),
      0.95,
    ),
    medianAgentExecutionMs: median(agentTimes),
    medianValidationMs: median(validationTimes),
    integrationMs: integration?.durationMs ?? null,
    medianRaptureOverheadMs: median(overheadTimes),
    validationFailures: runs.filter((run) => isGenuineFailure(run)).length,
    integrationFailures: integration === undefined ? 0 : integration.status === "passed" ? 0 : 1,
    tokenUsage,
    providerCost,
  };
}

export async function deriveMetrics(eventsPath: string): Promise<ExperimentMetrics> {
  const events = await readEvents(eventsPath);
  const finished = new Map<string, TaskRecord[]>();
  const trials = new Map<string, TrialRecord>();
  const integrations = new Map<string, z.infer<typeof integrationSchema>>();

  const ensureTrial = (trialId: string, workerCount: number, repetition: number): TrialRecord => {
    const existing = trials.get(trialId);
    if (existing !== undefined) return existing;
    const created: TrialRecord = {
      trialId,
      workerCount,
      repetition,
      trialSeed: null,
      taskOrder: [],
      durationMs: null,
      boundaryTimes: [],
    };
    trials.set(trialId, created);
    return created;
  };

  for (const event of events) {
    if (event.eventType === "trial_started" || event.eventType === "trial_finished") {
      const data = trialBoundarySchema.parse(event.data);
      const trial = ensureTrial(data.trialId, data.workerCount, data.repetition);
      if (data.trialSeed !== undefined) trial.trialSeed = data.trialSeed;
      if (data.taskOrder !== undefined) trial.taskOrder = [...data.taskOrder];
      if (event.eventType === "trial_finished" && data.durationMs !== undefined) {
        trial.durationMs = data.durationMs;
      }
    }
    if (event.eventType === "task_finished") {
      const data = taskFinishedSchema.parse(event.data);
      const trialId = data.trialId ?? implicitTrialId(data.workerCount, data.repetition ?? 1);
      const repetition = data.repetition ?? 1;
      ensureTrial(trialId, data.workerCount, repetition);
      const existing = finished.get(trialId) ?? [];
      existing.push({
        trialId,
        workerCount: data.workerCount,
        accepted: data.accepted,
        runState: data.runState ?? null,
        durationMs: data.durationMs,
        validationResult: data.validationResult,
        commands: data.commands,
        testInvocations: data.testInvocations,
        buildInvocations: data.buildInvocations,
        tokenUsage: data.tokenUsage,
        providerCost: data.providerCost,
        phaseTimings: data.phaseTimings ?? null,
      });
      finished.set(trialId, existing);
    }
    if (event.eventType === "task_started" || event.eventType === "task_finished") {
      const data = taskBoundarySchema.parse(event.data);
      const trialId = data.trialId ?? implicitTrialId(data.workerCount);
      const trial = ensureTrial(trialId, data.workerCount, 1);
      trial.boundaryTimes.push(Date.parse(event.timestamp));
    }
    if (event.eventType === "integration_finished") {
      const data = integrationSchema.parse(event.data);
      const trialId = data.trialId ?? implicitTrialId(data.workerCount, data.repetition ?? 1);
      integrations.set(trialId, data);
    }
  }

  const trialResults = [...trials.values()]
    .map((trial) =>
      trialMetricsFrom(trial, finished.get(trial.trialId) ?? [], integrations.get(trial.trialId)),
    )
    .sort((left, right) =>
      left.workerCount === right.workerCount
        ? left.repetition - right.repetition
        : left.workerCount - right.workerCount,
    );

  const byWorker = new Map<number, TrialMetrics[]>();
  for (const trial of trialResults) {
    const existing = byWorker.get(trial.workerCount) ?? [];
    existing.push(trial);
    byWorker.set(trial.workerCount, existing);
  }

  const baselineTrials = byWorker.get(1) ?? [];
  const baselineMedian = median(
    collectNumbers(baselineTrials.map((trial) => trial.acceptedTasksPerHour)),
  );
  const baselineByRepetition = new Map(
    baselineTrials.map((trial) => [trial.repetition, trial.acceptedTasksPerHour]),
  );

  const rows: WorkerMetrics[] = [];
  for (const workerCount of [...byWorker.keys()].sort((left, right) => left - right)) {
    const workerTrials = byWorker.get(workerCount) ?? [];
    const runs = workerTrials.flatMap((trial) => finished.get(trial.trialId) ?? []);
    const throughputs = workerTrials.map((trial) => trial.acceptedTasksPerHour);
    const presentThroughputs = collectNumbers(throughputs);
    const medianThroughput = median(presentThroughputs);
    const pairedSpeedups = workerTrials.map((trial) => {
      const baseline = baselineByRepetition.get(trial.repetition);
      if (trial.acceptedTasksPerHour === null || baseline === null || baseline === undefined) {
        return null;
      }
      return trial.acceptedTasksPerHour / baseline;
    });
    const acceptedRuns = runs.filter((run) => run.accepted);
    const totalTokens = sumIfComplete(acceptedRuns.map((run) => run.tokenUsage));
    const totalCost = sumIfComplete(acceptedRuns.map((run) => run.providerCost));
    const accepted = workerTrials.reduce((total, trial) => total + trial.acceptedTasks, 0);
    const validationFailures = workerTrials.reduce(
      (total, trial) => total + trial.validationFailures,
      0,
    );
    const integrationFailures = workerTrials.reduce(
      (total, trial) => total + trial.integrationFailures,
      0,
    );
    const integrationCount = workerTrials.filter((trial) => integrations.has(trial.trialId)).length;
    rows.push({
      workerCount,
      trialCount: workerTrials.length,
      taskRuns: runs.length,
      acceptedTasks: accepted,
      acceptedTasksPerHour: medianThroughput,
      acceptedTasksPerHourPerTrial: throughputs,
      medianAcceptedTasksPerHour: medianThroughput,
      minAcceptedTasksPerHour:
        presentThroughputs.length > 0 ? Math.min(...presentThroughputs) : null,
      maxAcceptedTasksPerHour:
        presentThroughputs.length > 0 ? Math.max(...presentThroughputs) : null,
      medianTotalTrialWallTimeMs: median(
        collectNumbers(workerTrials.map((trial) => trial.totalWallTimeMs)),
      ),
      speedup:
        medianThroughput !== null && baselineMedian !== null && baselineMedian > 0
          ? medianThroughput / baselineMedian
          : null,
      parallelEfficiency:
        medianThroughput !== null && baselineMedian !== null && baselineMedian > 0
          ? medianThroughput / (workerCount * baselineMedian)
          : null,
      pairedSpeedups,
      pairedParallelEfficiencies: pairedSpeedups.map((value) =>
        value === null ? null : value / workerCount,
      ),
      medianDurationMs: median(runs.map((run) => run.durationMs)),
      p95DurationMs: percentile(
        runs.map((run) => run.durationMs),
        0.95,
      ),
      medianAgentExecutionMs: median(
        collectNumbers(workerTrials.map((trial) => trial.medianAgentExecutionMs)),
      ),
      medianValidationMs: median(
        collectNumbers(workerTrials.map((trial) => trial.medianValidationMs)),
      ),
      medianIntegrationMs: median(collectNumbers(workerTrials.map((trial) => trial.integrationMs))),
      medianRaptureOverheadMs: median(
        collectNumbers(workerTrials.map((trial) => trial.medianRaptureOverheadMs)),
      ),
      validationFailures,
      integrationFailures,
      validationFailureRate: runs.length > 0 ? validationFailures / runs.length : null,
      integrationFailureRate:
        integrationCount === 0 ? null : integrationFailures / integrationCount,
      duplicateCommands: duplicates(runs.flatMap((run) => run.commands)),
      duplicateTestInvocations: duplicates(runs.flatMap((run) => run.testInvocations)),
      duplicateBuildInvocations: duplicates(runs.flatMap((run) => run.buildInvocations)),
      tokenUsage: totalTokens,
      providerCost: totalCost,
      tokenUsagePerAcceptedTask:
        totalTokens !== null && accepted > 0 ? totalTokens / accepted : null,
      providerCostPerAcceptedTask: totalCost !== null && accepted > 0 ? totalCost / accepted : null,
    });
  }
  return { schemaVersion: 2, workerResults: rows, trialResults };
}
