#!/usr/bin/env node

import {
  buildExperimentConfig,
  ConfigurationError,
  DoctorError,
  doctorExitCode,
  formatDoctor,
  formatReport,
  inspectExperiment,
  loadTasks,
  persistDoctorArtifacts,
  regenerateReport,
  resumeExperiment,
  runDoctor,
  runExperiment,
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

const doctorOptionsSchema = z.object({
  config: z.string().optional(),
  agent: z.enum(["fake", "codex", "opencode"]).optional(),
  agentModel: z.string().optional(),
  repo: z.string().optional(),
  tasks: z.string().optional(),
  output: z.string().optional(),
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
