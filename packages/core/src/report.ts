import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { deriveMetrics } from "./metrics.js";
import type { ExperimentMetrics, MatrixCompletion } from "./models.js";

const manifestSchema = z.object({
  experimentId: z.string().min(1),
});

const outcomeSchema = z.object({
  status: z.enum(["completed", "failed", "interrupted"]),
  completion: z
    .object({
      schemaVersion: z.literal(1),
      status: z.enum(["completed", "blocked", "interrupted", "incomplete"]),
      expectedLogicalRuns: z.number(),
      completedLogicalRuns: z.number(),
      acceptedRuns: z.number(),
      rejectedRuns: z.number(),
      timedOutRuns: z.number(),
      providerBlockedRuns: z.number(),
      infrastructureFailedRuns: z.number(),
      interruptedRuns: z.number(),
      outstandingRuns: z.number(),
      completedTrials: z.number(),
      totalTrials: z.number(),
    })
    .optional(),
});

export interface ExperimentReport {
  readonly schemaVersion: 2;
  readonly experimentId: string;
  readonly status: "completed" | "failed" | "interrupted" | "incomplete";
  readonly metrics: ExperimentMetrics;
  readonly completion: MatrixCompletion | null;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function regenerateReport(experimentDirectory: string): Promise<ExperimentReport> {
  const directory = resolve(experimentDirectory);
  const manifest = manifestSchema.parse(await readJson(join(directory, "manifest.json")));
  let status: ExperimentReport["status"] = "incomplete";
  let completion: MatrixCompletion | null = null;
  try {
    const outcome = outcomeSchema.parse(await readJson(join(directory, "outcome.json")));
    status = outcome.status;
    completion = outcome.completion ?? null;
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return {
    schemaVersion: 2,
    experimentId: manifest.experimentId,
    status,
    completion,
    metrics: await deriveMetrics(join(directory, "events.jsonl")),
  };
}

function number(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function integer(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toString();
}

export function formatReport(report: ExperimentReport): string {
  const completion =
    report.completion === null
      ? ""
      : ` (matrix ${report.completion.status}: ${report.completion.completedLogicalRuns}/${report.completion.expectedLogicalRuns})`;
  const lines = [`Rapture experiment ${report.experimentId} (${report.status}${completion})`];
  lines.push("Trial results");
  lines.push(
    "trial                  accepted  tasks/hour  wall-ms  agent-ms  valid-ms  integ-ms  overhead  failures",
  );
  for (const trial of report.metrics.trialResults) {
    lines.push(
      [
        trial.trialId.padEnd(22),
        trial.acceptedTasks.toString().padStart(8),
        number(trial.acceptedTasksPerHour).padStart(10),
        integer(trial.totalWallTimeMs).padStart(7),
        integer(trial.medianAgentExecutionMs).padStart(8),
        integer(trial.medianValidationMs).padStart(8),
        integer(trial.integrationMs).padStart(8),
        integer(trial.medianRaptureOverheadMs).padStart(8),
        (trial.validationFailures + trial.integrationFailures).toString().padStart(8),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push("Worker aggregates");
  lines.push(
    "workers  trials  accepted  median-tph  min-tph  max-tph  speedup  efficiency  validation-fail  integration-fail",
  );
  for (const row of report.metrics.workerResults) {
    lines.push(
      [
        row.workerCount.toString().padStart(7),
        row.trialCount.toString().padStart(6),
        row.acceptedTasks.toString().padStart(8),
        number(row.medianAcceptedTasksPerHour).padStart(10),
        number(row.minAcceptedTasksPerHour).padStart(7),
        number(row.maxAcceptedTasksPerHour).padStart(7),
        number(row.speedup).padStart(7),
        number(row.parallelEfficiency).padStart(10),
        row.validationFailures.toString().padStart(15),
        row.integrationFailures.toString().padStart(16),
      ].join("  "),
    );
  }
  return lines.join("\n");
}

export interface ExperimentInspection {
  readonly experimentId: string;
  readonly status: ExperimentReport["status"];
  readonly artifactDirectory: string;
  readonly manifest: string;
  readonly events: string;
  readonly outcome: string | null;
  readonly trialManifests: readonly string[];
  readonly runResults: readonly string[];
}

async function listFiles(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function inspectExperiment(
  experimentDirectory: string,
): Promise<ExperimentInspection> {
  const directory = resolve(experimentDirectory);
  const report = await regenerateReport(directory);
  const trialNames = await listFiles(join(directory, "trials"));
  const trialManifests = trialNames
    .map((name) => join(directory, "trials", name, "trial.json"))
    .sort();
  const runResults: string[] = [];
  for (const trialName of trialNames) {
    const runNames = await listFiles(join(directory, "trials", trialName, "runs"));
    for (const runName of runNames) {
      runResults.push(join(directory, "trials", trialName, "runs", runName, "result.json"));
    }
  }
  const legacyRuns = await listFiles(join(directory, "runs"));
  for (const runName of legacyRuns) {
    runResults.push(join(directory, "runs", runName, "result.json"));
  }
  return {
    experimentId: report.experimentId,
    status: report.status,
    artifactDirectory: directory,
    manifest: join(directory, "manifest.json"),
    events: join(directory, "events.jsonl"),
    outcome: report.status === "incomplete" ? null : join(directory, "outcome.json"),
    trialManifests,
    runResults: runResults.sort(),
  };
}
