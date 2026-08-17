import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { deriveMetrics } from "./metrics.js";
import type { ExperimentMetrics } from "./models.js";

const manifestSchema = z.object({
  experimentId: z.string().min(1),
});

const outcomeSchema = z.object({
  status: z.enum(["completed", "failed", "interrupted"]),
});

export interface ExperimentReport {
  readonly schemaVersion: 1;
  readonly experimentId: string;
  readonly status: "completed" | "failed" | "interrupted" | "incomplete";
  readonly metrics: ExperimentMetrics;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function regenerateReport(experimentDirectory: string): Promise<ExperimentReport> {
  const directory = resolve(experimentDirectory);
  const manifest = manifestSchema.parse(await readJson(join(directory, "manifest.json")));
  let status: ExperimentReport["status"] = "incomplete";
  try {
    status = outcomeSchema.parse(await readJson(join(directory, "outcome.json"))).status;
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return {
    schemaVersion: 1,
    experimentId: manifest.experimentId,
    status,
    metrics: await deriveMetrics(join(directory, "events.jsonl")),
  };
}

function number(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

export function formatReport(report: ExperimentReport): string {
  const lines = [`Rapture experiment ${report.experimentId} (${report.status})`];
  lines.push(
    "workers  accepted  tasks/hour  speedup  efficiency  validation-fail  integration-fail",
  );
  for (const row of report.metrics.workerResults) {
    lines.push(
      [
        row.workerCount.toString().padStart(7),
        row.acceptedTasks.toString().padStart(8),
        number(row.acceptedTasksPerHour).padStart(10),
        number(row.speedup).padStart(7),
        number(row.parallelEfficiency).padStart(10),
        number(row.validationFailureRate).padStart(15),
        number(row.integrationFailureRate).padStart(16),
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
  readonly runResults: readonly string[];
}

export async function inspectExperiment(
  experimentDirectory: string,
): Promise<ExperimentInspection> {
  const directory = resolve(experimentDirectory);
  const report = await regenerateReport(directory);
  const runsDirectory = join(directory, "runs");
  let names: readonly string[] = [];
  try {
    names = await readdir(runsDirectory);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const runResults = names.map((name) => join(runsDirectory, name, "result.json")).sort();
  return {
    experimentId: report.experimentId,
    status: report.status,
    artifactDirectory: directory,
    manifest: join(directory, "manifest.json"),
    events: join(directory, "events.jsonl"),
    outcome: report.status === "incomplete" ? null : join(directory, "outcome.json"),
    runResults,
  };
}
