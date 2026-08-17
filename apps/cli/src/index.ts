#!/usr/bin/env node

import {
  buildExperimentConfig,
  ConfigurationError,
  formatReport,
  inspectExperiment,
  loadTasks,
  regenerateReport,
  runExperiment,
} from "@rapture/core";
import { Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";

const runOptionsSchema = z.object({
  repo: z.string().min(1),
  tasks: z.string().min(1),
  workers: z.string().min(1),
  agent: z.enum(["fake", "codex"]),
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

program
  .command("run")
  .description("execute a scaling experiment")
  .requiredOption("--repo <path>", "local Git repository")
  .requiredOption("--tasks <path>", "task definition JSON")
  .requiredOption("--workers <counts>", "comma-separated worker counts")
  .addOption(
    new Option("--agent <adapter>", "agent adapter").choices(["fake", "codex"]).default("fake"),
  )
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
      agent: options.agent,
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
          `Artifacts: ${inspection.artifactDirectory}\nRuns: ${inspection.runResults.length}\n`,
      );
    }
  });

program.configureOutput({
  outputError: (value, write) => write(value),
});

try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  if (error instanceof ConfigurationError || error instanceof z.ZodError) {
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
