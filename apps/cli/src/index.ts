#!/usr/bin/env node

import { resolve } from "node:path";
import type { CapacityContext } from "@rapture/core";
import {
  benchmarkTasksForRepository,
  buildExperimentConfig,
  ConfigurationError,
  createPredictionStore,
  DoctorError,
  detectCapacityKnee,
  doctorExitCode,
  evaluateStoredPredictions,
  formatDoctor,
  formatFactor,
  formatReport,
  inspectExperiment,
  loadBenchmarkSuite,
  loadCapacityContext,
  loadTasks,
  materializeBenchmarkRepository,
  observeOutcomes,
  persistDoctorArtifacts,
  regenerateReport,
  regenerateStepPredictions,
  resumeExperiment,
  runBenchmarkDoctor,
  runDoctor,
  runExperiment,
  simulateControllerStop,
} from "@rapture/core";
import { Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";

const runOptionsSchema = z.object({
  repo: z.string().min(1),
  tasks: z.string().min(1),
  workers: z.string().min(1),
  repetitions: z.string().min(1),
  seed: z.string().min(1),
  agent: z.enum(["fake", "codex", "opencode"]),
  agentModel: z.string().optional(),
  output: z.string().min(1),
  integration: z.boolean(),
  integrationValidation: z.array(z.string()),
  order: z.enum(["repetition-major", "worker-major"]),
  pricing: z.string().optional(),
  json: z.boolean(),
});

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const program = new Command()
  .name("rapture")
  .description("Profile autonomous coding-agent fleet scaling")
  .version("0.1.0");

program
  .command("validate")
  .description("validate a task definition without running agents")
  .requiredOption("--tasks <path>", "task definition JSON")
  .action(async (options: { readonly tasks: string }) => {
    const tasks = await loadTasks(options.tasks);
    process.stdout.write(`valid: ${tasks.length} task(s)\n`);
  });

const benchmarkDoctorOptionsSchema = z.object({
  manifest: z.string().min(1),
  json: z.boolean(),
});

program
  .command("benchmark-doctor")
  .description("verify a benchmark manifest, fixtures, validators, and known-good proofs")
  .requiredOption("--manifest <path>", "benchmark suite manifest")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = benchmarkDoctorOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const result = await runBenchmarkDoctor({
      manifestPath: resolve(invocationRoot, options.manifest),
    });
    if (options.json) printJson(result);
    else {
      process.stdout.write(
        `Rapture benchmark doctor ${result.status} (${result.suiteId}@${result.suiteVersion})\n`,
      );
      for (const check of result.checks) {
        process.stdout.write(`${check.id.padEnd(36)} ${check.status.padEnd(8)} ${check.message}\n`);
      }
    }
    process.exitCode = result.status === "BLOCKED" ? 2 : 0;
  });

const benchmarkMaterializeOptionsSchema = z.object({
  manifest: z.string().min(1),
  repository: z.string().min(1),
  destination: z.string().min(1),
  tasksOutput: z.string().optional(),
});

program
  .command("benchmark-materialize")
  .description("materialize one pinned benchmark repository and optionally write Rapture tasks")
  .requiredOption("--manifest <path>", "benchmark suite manifest")
  .requiredOption("--repository <id>", "benchmark repository ID")
  .requiredOption("--destination <path>", "new destination directory")
  .option("--tasks-output <path>", "write compatible task JSON for this repository")
  .action(async (rawOptions: unknown) => {
    const options = benchmarkMaterializeOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const manifestPath = resolve(invocationRoot, options.manifest);
    const suite = await loadBenchmarkSuite(manifestPath);
    await materializeBenchmarkRepository({
      manifestPath,
      suite,
      repositoryId: options.repository,
      destination: resolve(invocationRoot, options.destination),
    });
    if (options.tasksOutput !== undefined) {
      const { writeFile } = await import("node:fs/promises");
      const tasks = benchmarkTasksForRepository({
        manifestPath,
        suite,
        repositoryId: options.repository,
      });
      await writeFile(
        resolve(invocationRoot, options.tasksOutput),
        `${JSON.stringify({ tasks }, null, 2)}\n`,
        "utf8",
      );
    }
    process.stdout.write(`materialized ${options.repository} at ${options.destination}\n`);
  });

const doctorOptionsSchema = z.object({
  config: z.string().optional(),
  agent: z.enum(["fake", "codex", "opencode"]).optional(),
  agentModel: z.string().optional(),
  repo: z.string().optional(),
  tasks: z.string().optional(),
  output: z.string().optional(),
  pricing: z.string().optional(),
  writeDir: z.string().optional(),
  json: z.boolean(),
});

program
  .command("doctor")
  .description("inspect whether this environment can execute a Rapture experiment")
  .option("--config <path>", "frozen experiment JSON")
  .addOption(
    new Option("--agent <adapter>", "agent adapter").choices(["fake", "codex", "opencode"]),
  )
  .option("--agent-model <name>", "optional pinned provider model identifier")
  .option("--repo <path>", "local Git repository")
  .option("--tasks <path>", "task definition JSON")
  .option("--output <path>", "experiment output directory")
  .option("--pricing <path>", "versioned pricing context JSON; enables derived monetary economics")
  .option("--write-dir <path>", "write doctor.json and runner-fingerprint.json")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = doctorOptionsSchema.parse(rawOptions);
    try {
      const result = await runDoctor({
        workspaceRoot: process.cwd(),
        env: process.env,
        ...(options.repo === undefined ? {} : { repository: options.repo }),
        ...(options.tasks === undefined ? {} : { taskFile: options.tasks }),
        ...(options.output === undefined ? {} : { outputDirectory: options.output }),
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(options.agentModel === undefined ? {} : { agentModel: options.agentModel }),
        ...(options.config === undefined ? {} : { configPath: options.config }),
        ...(options.pricing === undefined ? {} : { pricingPath: options.pricing }),
      });
      const writeDir = options.writeDir ?? options.output;
      if (writeDir !== undefined) {
        await persistDoctorArtifacts(writeDir, result, process.env);
      }
      if (options.json) printJson(result);
      else process.stdout.write(`${formatDoctor(result)}\n`);
      process.exitCode = doctorExitCode(result.status);
    } catch (error: unknown) {
      if (error instanceof ConfigurationError || error instanceof z.ZodError) {
        process.stderr.write(`configuration error: ${error.message}\n`);
        process.exitCode = 3;
        return;
      }
      if (error instanceof DoctorError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = error.exitCode;
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`doctor internal failure: ${detail}\n`);
      process.exitCode = 4;
    }
  });

program
  .command("run")
  .description("execute a scaling experiment")
  .requiredOption("--repo <path>", "local Git repository")
  .requiredOption("--tasks <path>", "task definition JSON")
  .requiredOption("--workers <counts>", "comma-separated worker counts")
  .option("--repetitions <count>", "number of repeated trials per worker count", "1")
  .option("--seed <integer>", "root experiment seed for deterministic task order", "0")
  .addOption(
    new Option("--agent <adapter>", "agent adapter")
      .choices(["fake", "codex", "opencode"])
      .default("fake"),
  )
  .option("--agent-model <name>", "optional pinned provider model identifier")
  .requiredOption("--output <path>", "artifact output directory")
  .option("--integration", "attempt deterministic integration", false)
  .option(
    "--integration-validation <command>",
    "post-integration validation command; repeat for multiple commands",
    (value: string, previous: readonly string[]) => [...previous, value],
    [],
  )
  .addOption(
    new Option("--order <mode>", "trial execution order")
      .choices(["repetition-major", "worker-major"])
      .default("repetition-major"),
  )
  .option("--pricing <path>", "versioned pricing context JSON; enables derived monetary economics")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = runOptionsSchema.parse(rawOptions);
    const config = await buildExperimentConfig({
      repository: options.repo,
      taskFile: options.tasks,
      workers: options.workers,
      repetitions: options.repetitions,
      seed: options.seed,
      agent: options.agent,
      ...(options.agentModel === undefined ? {} : { agentModel: options.agentModel }),
      outputDirectory: options.output,
      integration: options.integration,
      integrationValidation: options.integrationValidation,
      order: options.order,
      ...(options.pricing === undefined ? {} : { pricingPath: options.pricing }),
    });
    const execution = await runExperiment(config);
    const report = await regenerateReport(execution.directory);
    if (options.json) printJson(report);
    else {
      process.stdout.write(`${formatReport(report)}\nArtifacts: ${execution.directory}\n`);
    }
  });

program
  .command("report")
  .description("regenerate metrics from persisted raw artifacts")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const report = await regenerateReport(experiment);
    if (options.json) printJson(report);
    else process.stdout.write(`${formatReport(report)}\n`);
  });

program
  .command("capacity")
  .description(
    "build the capacity curve, knee detection, prediction chronology, baselines, and retrospective simulation from persisted evidence",
  )
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const context: CapacityContext = await loadCapacityContext(experiment);
    const knee = detectCapacityKnee(context.curve);
    const store = await createPredictionStore(
      `${experiment}/predictions.jsonl`.replace(/\/+/g, "/"),
    );
    const stored = await store.read();
    const workerCounts = context.curve.points
      .map((point) => point.workerCount)
      .sort((a, b) => a - b);
    const regenerated = regenerateStepPredictions(context, workerCounts, 0);
    const outcomes = observeOutcomes(
      context,
      stored.predictions.map((prediction) => prediction.targetWorkerCount),
    );
    const evaluations = evaluateStoredPredictions(
      stored.predictions.map((prediction) => ({
        predictorId: prediction.predictorId,
        targetWorkerCount: prediction.targetWorkerCount,
        predictedState: prediction.predictedState,
      })),
      outcomes,
    );
    const simulation =
      knee.candidateKnee === null
        ? null
        : simulateControllerStop(
            context.curve,
            knee.candidateKnee,
            context.metrics.workerResults.reduce((total, row) => total + row.acceptedTasks, 0),
          );
    if (options.json) {
      printJson({
        experimentId: context.experimentId,
        curve: context.curve,
        knee,
        predictions: stored.predictions,
        outcomes: stored.outcomes,
        regeneratedMatchesStored: verifyRegenerated(regenerated, stored.predictions),
        evaluations,
        simulation,
      });
      return;
    }
    process.stdout.write(
      formatCapacityText(context, knee, stored, regenerated, evaluations, simulation),
    );
  });

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toString();
}

function verifyRegenerated(
  regenerated: ReturnType<typeof regenerateStepPredictions>,
  stored: readonly { predictorId: string; targetWorkerCount: number; predictedState: string }[],
): boolean {
  for (const step of regenerated) {
    for (const prediction of step.predictions) {
      const match = stored.some(
        (item) =>
          item.predictorId === prediction.predictor.id &&
          item.targetWorkerCount === prediction.targetWorkerCount &&
          item.predictedState === prediction.predictedState,
      );
      if (!match) return false;
    }
  }
  return true;
}

function formatCapacityText(
  context: CapacityContext,
  knee: ReturnType<typeof detectCapacityKnee>,
  stored: Awaited<ReturnType<Awaited<ReturnType<typeof createPredictionStore>>["read"]>>,
  regenerated: ReturnType<typeof regenerateStepPredictions>,
  evaluations: ReturnType<typeof evaluateStoredPredictions>,
  simulation: ReturnType<typeof simulateControllerStop> | null,
): string {
  const lines: string[] = [];
  lines.push(`Rapture capacity curve ${context.experimentId}`);
  lines.push("");
  lines.push("Capacity curve");
  lines.push(
    "workers  accepted  accept-rate  median-tph  min-tph  max-tph  speedup  efficiency  agent-ms  infl-vs-1  cpu-mean  mem-used  load-p95",
  );
  for (const point of context.curve.points) {
    lines.push(
      [
        point.workerCount.toString().padStart(7),
        point.acceptedTasks.toString().padStart(8),
        pct(point.acceptanceRate).padStart(11),
        (point.medianTasksPerHour === null ? "n/a" : point.medianTasksPerHour.toFixed(2)).padStart(
          10,
        ),
        (point.minTasksPerHour === null ? "n/a" : point.minTasksPerHour.toFixed(2)).padStart(8),
        (point.maxTasksPerHour === null ? "n/a" : point.maxTasksPerHour.toFixed(2)).padStart(8),
        formatFactor(point.speedup).padStart(8),
        formatFactor(point.parallelEfficiency).padStart(11),
        ms(point.medianAgentExecutionMs).padStart(9),
        formatFactor(point.agentLatencyInflationVsBaseline).padStart(10),
        pct(point.resources?.cpuUtilizationMean ?? null).padStart(9),
        pct(point.resources?.memoryUsedFractionMean ?? null).padStart(9),
        (point.resources?.loadAverage1mP95 === null || point.resources === null
          ? "n/a"
          : point.resources.loadAverage1mP95.toFixed(1)
        ).padStart(8),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push("Adjacent marginal yield");
  lines.push("step   gain-tph  gain-%   yield/worker  incr-eff  latency-infl");
  for (const step of context.curve.adjacentSteps) {
    lines.push(
      [
        `T(${step.toWorkerCount})-T(${step.fromWorkerCount})`,
        (step.marginalThroughputGain === null
          ? "n/a"
          : step.marginalThroughputGain.toFixed(2)
        ).padStart(8),
        pct(step.marginalThroughputGainFraction).padStart(7),
        (step.marginalWorkerYield === null ? "n/a" : step.marginalWorkerYield.toFixed(2)).padStart(
          13,
        ),
        formatFactor(step.incrementalWorkerEfficiency).padStart(9),
        formatFactor(step.agentLatencyInflation).padStart(12),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push(
    `Candidate knee: ${knee.status}${knee.candidateKnee === null ? "" : ` at N=${knee.candidateKnee} (confidence ${knee.confidence})`}`,
  );
  for (const reason of knee.reasons) lines.push(`  - ${reason}`);
  lines.push("");
  lines.push("Prediction chronology (persisted before held-out results)");
  const sortedPredictions = [...stored.predictions].sort(
    (a, b) =>
      a.targetWorkerCount - b.targetWorkerCount || a.persistedAt.localeCompare(b.persistedAt),
  );
  for (const prediction of sortedPredictions) {
    lines.push(
      `  [${prediction.persistedAt}] ${prediction.predictorId} observed=${prediction.observedWorkerCounts.join(",")} -> N=${prediction.targetWorkerCount}: ${prediction.predictedState} (${prediction.confidence})`,
    );
  }
  for (const outcome of stored.outcomes) {
    lines.push(
      `  [${outcome.recordedAt}] observed outcome N=${outcome.targetWorkerCount}: ${JSON.stringify(outcome.observedOutcome)}`,
    );
  }
  lines.push("");
  lines.push(
    `Predictions reproducible from persisted restricted evidence: ${verifyRegenerated(regenerated, stored.predictions) ? "yes" : "no"}`,
  );
  lines.push("");
  lines.push("Predictor vs held-out outcomes (descriptive agreement only)");
  lines.push("predictor           steps  correct  agreement");
  for (const evaluation of evaluations) {
    lines.push(
      [
        evaluation.predictorId.padEnd(19),
        evaluation.evaluableSteps.toString().padStart(5),
        evaluation.correctSteps.toString().padStart(8),
        (evaluation.agreementFraction === null
          ? "n/a"
          : pct(evaluation.agreementFraction)
        ).padStart(10),
      ].join("  "),
    );
  }
  if (simulation !== null) {
    lines.push("");
    lines.push("Retrospective controller simulation (NOT a live adaptive controller)");
    lines.push(
      `stop-at N=${simulation.stopAtWorkers}: tph=${simulation.throughputAtStopWorkers?.toFixed(2) ?? "n/a"} wall=${simulation.estimatedWallHoursAtStopWorkers?.toFixed(2) ?? "n/a"}h occupancy=${pct(simulation.workerOccupancyAtStopWorkers)}`,
    );
    lines.push(
      `max N=${simulation.maxWorkers}: tph=${simulation.throughputAtMaxWorkers?.toFixed(2) ?? "n/a"} wall=${simulation.estimatedWallHoursAtMaxWorkers?.toFixed(2) ?? "n/a"}h occupancy=${pct(simulation.workerOccupancyAtMaxWorkers)}`,
    );
    lines.push(`wall-time delta (stop-vs-max): ${pct(simulation.wallTimeReductionFraction)}`);
  } else {
    lines.push("");
    lines.push("Retrospective controller simulation: unavailable (no candidate knee detected)");
  }
  return lines.join("\n");
}

program
  .command("resume")
  .description("resume a previously interrupted experiment")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const execution = await resumeExperiment(experiment);
    const report = await regenerateReport(execution.directory);
    if (options.json) printJson(report);
    else {
      process.stdout.write(`${formatReport(report)}\nArtifacts: ${execution.directory}\n`);
    }
  });

program
  .command("inspect")
  .description("inspect raw experiment metadata and artifact locations")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const inspection = await inspectExperiment(experiment);
    if (options.json) printJson(inspection);
    else {
      process.stdout.write(
        `Rapture experiment ${inspection.experimentId} (${inspection.status})\n` +
          `Artifacts: ${inspection.artifactDirectory}\n` +
          `Trials: ${inspection.trialManifests.length}\n` +
          `Runs: ${inspection.runResults.length}\n`,
      );
    }
  });

program.configureOutput({
  outputError: (value, write) => write(value),
});

try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  if (error instanceof DoctorError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else if (error instanceof ConfigurationError || error instanceof z.ZodError) {
    process.stderr.write(`configuration error: ${error.message}\n`);
    process.exitCode = 2;
  } else if (error instanceof InvalidArgumentError) {
    process.stderr.write(`argument error: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`execution error: ${detail}\n`);
    process.exitCode = 3;
  }
}
