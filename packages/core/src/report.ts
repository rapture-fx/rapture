import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { type PricingContext, pricingContextSchema } from "./economics.js";
import { deriveEconomics, type EconomicsReport } from "./economics-metrics.js";
import { deriveMetrics } from "./metrics.js";
import type { ExperimentMetrics, MatrixCompletion } from "./models.js";

const manifestSchema = z.object({
  experimentId: z.string().min(1),
});

const manifestPricingSchema = z.object({
  pricing: pricingContextSchema.nullable().optional(),
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
  readonly economics: EconomicsReport;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function regenerateReport(experimentDirectory: string): Promise<ExperimentReport> {
  const directory = resolve(experimentDirectory);
  const manifest = manifestSchema.parse(await readJson(join(directory, "manifest.json")));
  let pricing: PricingContext | null = null;
  try {
    const rawManifest = await readJson(join(directory, "manifest.json"));
    const parsedPricing = manifestPricingSchema.safeParse(rawManifest);
    if (parsedPricing.success && parsedPricing.data.pricing) {
      pricing = parsedPricing.data.pricing;
    }
  } catch {
    pricing = null;
  }
  let status: ExperimentReport["status"] = "incomplete";
  let completion: MatrixCompletion | null = null;
  try {
    const outcome = outcomeSchema.parse(await readJson(join(directory, "outcome.json")));
    status = outcome.status;
    completion = outcome.completion ?? null;
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const metrics = await deriveMetrics(join(directory, "events.jsonl"));
  const economics = await deriveEconomics(join(directory, "events.jsonl"), pricing);
  return {
    schemaVersion: 2,
    experimentId: manifest.experimentId,
    status,
    completion,
    metrics,
    economics,
  };
}

function number(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function integer(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toString();
}

function money(value: { amount: number; currency: string } | null, digits = 6): string {
  return value === null ? "n/a" : `${value.amount.toFixed(digits)} ${value.currency}`;
}

function economicsSections(report: ExperimentReport): string[] {
  const economics = report.economics;
  const lines = ["", "Engineering economics"];
  const availability = economics.usageAvailability;
  lines.push(
    `Usage availability: ${availability.runsWithUsage}/${availability.totalRuns} runs with structured usage, ${availability.runsWithProviderReportedCost} with provider-reported cost`,
  );
  for (const source of availability.usageSources) {
    lines.push(`  usageSource=${source.source}: ${source.runs} runs`);
  }
  const pricing = economics.pricingContext;
  if (pricing === null) {
    lines.push("Pricing context: none supplied; derived monetary metrics are null");
  } else {
    lines.push(
      `Pricing context: provider=${pricing.provider} model=${pricing.model} currency=${pricing.currency} source="${pricing.pricingSource}" effective=${pricing.pricingEffectiveDate}`,
    );
    lines.push(
      `  input=${pricing.inputCostPerMillionTokens}/Mtok output=${pricing.outputCostPerMillionTokens}/Mtok cachedInput=${
        pricing.cachedInputCostPerMillionTokens ?? "n/a"
      }/Mtok reasoning=${pricing.reasoningCostPerMillionTokens ?? "n/a"}/Mtok machine=${
        pricing.machineCostPerHour ?? "n/a"
      }/hour`,
    );
  }
  lines.push("");
  lines.push(
    "workers  accepted  runs  agent-hours  machine-hours  accepted/agent-hr  accepted/machine-hr",
  );
  for (const worker of economics.workers) {
    lines.push(
      [
        worker.workerCount.toString().padStart(7),
        worker.acceptedTasks.toString().padStart(8),
        worker.totalRuns.toString().padStart(5),
        number(
          worker.agentWallMsTotal === null ? null : worker.agentWallMsTotal / 3_600_000,
        ).padStart(11),
        number(
          worker.machineWallMsTotal === null ? null : worker.machineWallMsTotal / 3_600_000,
        ).padStart(13),
        number(worker.acceptedTasksPerAgentHour).padStart(17),
        number(worker.acceptedTasksPerMachineHour).padStart(19),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push(
    "workers  derived-provider-cost  machine-cost  configured-total  provider-cost/accepted-task  configured-cost/accepted-task",
  );
  for (const worker of economics.workers) {
    lines.push(
      [
        worker.workerCount.toString().padStart(7),
        money(worker.derivedProviderCostTotal).padStart(21),
        money(worker.machineCostTotal).padStart(13),
        money(worker.totalConfiguredCost).padStart(16),
        money(worker.providerCostPerAcceptedTask).padStart(27),
        money(worker.totalConfiguredCostPerAcceptedTask).padStart(29),
      ].join("  "),
      `    tokens in/out/cached/reasoning: ${integer(worker.inputTokensTotal)}/${integer(
        worker.outputTokensTotal,
      )}/${integer(worker.cachedInputTokensTotal)}/${integer(worker.reasoningTokensTotal)}`,
    );
  }
  if (economics.marginal.length > 0) {
    lines.push("");
    lines.push("Marginal worker economics (adjacent worker counts)");
    lines.push(
      "from->to  incremental-accepted  incremental-agent-hrs  incremental-machine-hrs  marginal-provider-cost/additional-task  marginal-configured-cost/additional-task",
    );
    for (const marginal of economics.marginal) {
      lines.push(
        [
          `${marginal.fromWorkers}->${marginal.toWorkers}`.padEnd(8),
          integer(marginal.incrementalAcceptedTasks).padStart(20),
          number(marginal.incrementalAgentHours).padStart(21),
          number(marginal.incrementalMachineHours).padStart(23),
          money(marginal.marginalProviderCostPerAdditionalAcceptedTask).padStart(38),
          money(marginal.marginalConfiguredTotalCostPerAdditionalAcceptedTask).padStart(39),
        ].join("  "),
      );
    }
  }
  if (economics.missingDataNotes.length > 0) {
    lines.push("");
    lines.push("Missing data:");
    for (const note of economics.missingDataNotes) {
      lines.push(`  - ${note}`);
    }
  }
  return lines;
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
  lines.push(...economicsSections(report));
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
