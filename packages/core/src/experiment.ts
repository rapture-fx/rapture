import { randomUUID } from "node:crypto";
import { mkdir, rmdir } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { codexAgentAdapter } from "./adapters/codex.js";
import { fakeAgentAdapter } from "./adapters/fake.js";
import type { AgentAdapter } from "./adapters/types.js";
import {
  redactSecrets,
  safeArtifactPath,
  sha256,
  sha256File,
  writeJsonArtifact,
  writeRawTextArtifact,
  writeTextArtifact,
} from "./artifacts.js";
import { ConfigurationError } from "./config.js";
import { createEventWriter, type EventWriter } from "./events.js";
import {
  changedFiles,
  currentCommit,
  repositoryFingerprint,
  resolveCommit,
  runGit,
  stagedPatch,
  treeHash,
  workingTreeHash,
} from "./git.js";
import { type IntegrationOutcome, integratePatches } from "./integration.js";
import { deriveMetrics } from "./metrics.js";
import type { EngineeringTaskRun, ExperimentConfig, TaskDefinition } from "./models.js";
import { validateCommands } from "./validation.js";
import { runBounded } from "./worker.js";
import { createWorktreeManager, type WorktreeManager } from "./worktree.js";

function adapterFor(name: ExperimentConfig["agent"]): AgentAdapter {
  return name === "fake" ? fakeAgentAdapter : codexAgentAdapter;
}

function commandGroups(commands: readonly (readonly string[])[]): {
  readonly tests: readonly (readonly string[])[];
  readonly builds: readonly (readonly string[])[];
} {
  const tests: (readonly string[])[] = [];
  const builds: (readonly string[])[] = [];
  for (const command of commands) {
    const value = command.join(" ").toLowerCase();
    if (/(^|\s)(test|vitest|pytest|jest|unittest|node --test)(\s|$)/u.test(value)) {
      tests.push(command);
    }
    if (/(^|\s)(build|compile|make|cargo check)(\s|$)/u.test(value)) {
      builds.push(command);
    }
  }
  return { tests, builds };
}

function safeTaskId(taskId: string): string {
  return taskId
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

async function environmentFingerprint(): Promise<Readonly<Record<string, string | number>>> {
  const gitVersion = await runGit(process.cwd(), ["--version"], { allowFailure: true });
  return {
    platform: platform(),
    operatingSystemRelease: release(),
    nodeVersion: process.version,
    gitVersion: gitVersion.stdout.trim(),
    cpuCount: cpus().length,
  };
}

export interface ExperimentExecution {
  readonly experimentId: string;
  readonly directory: string;
}

export async function runExperiment(config: ExperimentConfig): Promise<ExperimentExecution> {
  if (config.tasks.some((task) => !task.independent || task.dependsOn.length > 0)) {
    throw new ConfigurationError(
      "V0 execution supports independent tasks only; dependencies are validated but not executed",
    );
  }
  const adapter = adapterFor(config.agent);
  const availability = await adapter.isAvailable();
  if (!availability.available) {
    throw new ConfigurationError(`agent adapter unavailable: ${availability.detail}`);
  }
  const repositoryHead = await resolveCommit(config.repository, "HEAD");
  const targetStatus = await runGit(config.repository, ["status", "--porcelain"]);
  if (targetStatus.stdout.trim().length > 0) {
    throw new ConfigurationError(
      "target repository must be clean so the recorded base commit fully defines the experiment",
    );
  }
  const agentVersion = await adapter.version();
  const experimentId = `exp-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 12)}`;
  const directory = join(config.outputDirectory, experimentId);
  await mkdir(config.outputDirectory, { recursive: true });
  await mkdir(directory, { recursive: false });
  const events = await createEventWriter(join(directory, "events.jsonl"), experimentId);
  const worktrees = await createWorktreeManager(config.repository, join(directory, ".worktrees"));
  const startedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    experimentId,
    repository: config.repository,
    repositoryHead,
    repositoryFingerprint: await repositoryFingerprint(config.repository, repositoryHead),
    taskFile: config.taskFile,
    taskSetHash: await sha256File(config.taskFile),
    workerCounts: config.workerCounts,
    agent: { name: adapter.name(), version: agentVersion },
    environment: await environmentFingerprint(),
    integration: config.integration,
    integrationValidation: config.integrationValidation,
    budget: config.budget,
    seed: config.seed,
    startedAt,
    reproduction: [
      "rapture run",
      `--repo ${config.repository}`,
      `--tasks ${config.taskFile}`,
      `--workers ${config.workerCounts.join(",")}`,
      `--agent ${config.agent}`,
      `--output ${config.outputDirectory}`,
    ].join(" "),
  };
  await writeJsonArtifact(join(directory, "manifest.json"), manifest);
  await events.emit("experiment_started", { startedAt });
  await events.emit("experiment_configuration_recorded", { manifest });

  const integrationOutcomes: IntegrationOutcome[] = [];
  let status: "completed" | "failed" | "interrupted" = "completed";
  let failure: unknown;
  try {
    for (const workerCount of config.workerCounts) {
      const runs = await runMatrix({
        config,
        adapter,
        agentVersion,
        experimentId,
        directory,
        events,
        worktrees,
        workerCount,
      });
      if (config.integration) {
        const commits = new Set(runs.map((run) => run.baseCommit));
        if (commits.size !== 1) {
          throw new ConfigurationError("integration requires one common base commit per matrix");
        }
        const baseCommit = commits.values().next().value;
        if (baseCommit === undefined) throw new Error("integration matrix has no runs");
        integrationOutcomes.push(
          await integratePatches({
            worktrees,
            workerCount,
            baseCommit,
            patches: runs
              .filter((run) => run.accepted)
              .map((run) => join(directory, run.artifacts.patch ?? "")),
            validation: config.integrationValidation,
            events,
          }),
        );
      }
    }
  } catch (error: unknown) {
    failure = error;
    status = error instanceof Error && error.name === "AbortError" ? "interrupted" : "failed";
    await events.emit("experiment_interrupted", {
      reason: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    const finishedAt = new Date().toISOString();
    const metrics = await deriveMetrics(join(directory, "events.jsonl"));
    await writeJsonArtifact(join(directory, "outcome.json"), {
      schemaVersion: 1,
      experimentId,
      status,
      startedAt,
      finishedAt,
      metrics,
      integrationOutcomes,
    });
    await events.emit("experiment_finished", { status, finishedAt });
    await rmdir(worktrees.root).catch(() => undefined);
  }
  if (failure !== undefined) throw failure;
  return { experimentId, directory };
}

interface MatrixInput {
  readonly config: ExperimentConfig;
  readonly adapter: AgentAdapter;
  readonly agentVersion: string | null;
  readonly experimentId: string;
  readonly directory: string;
  readonly events: EventWriter;
  readonly worktrees: WorktreeManager;
  readonly workerCount: number;
}

async function runMatrix(input: MatrixInput): Promise<readonly EngineeringTaskRun[]> {
  const settled = await runBounded(input.config.tasks, input.workerCount, async (task, index) => {
    const workerId = `w${input.workerCount}-${(index % input.workerCount) + 1}`;
    await input.events.emit("task_queued", {
      taskId: task.id,
      workerCount: input.workerCount,
    });
    await input.events.emit("worker_started", {
      workerId,
      workerCount: input.workerCount,
    });
    try {
      return await runTask({ ...input, task, workerId });
    } finally {
      await input.events.emit("worker_finished", {
        workerId,
        workerCount: input.workerCount,
      });
    }
  });
  const runs: EngineeringTaskRun[] = [];
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") runs.push(result.value);
    else failures.push(result.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} worker task(s) failed unexpectedly`);
  }
  return runs.sort((left, right) => left.taskId.localeCompare(right.taskId));
}

interface RunTaskInput extends MatrixInput {
  readonly task: TaskDefinition;
  readonly workerId: string;
}

async function runTask(input: RunTaskInput): Promise<EngineeringTaskRun> {
  const runId = `w${input.workerCount}-${safeTaskId(input.task.id)}-${randomUUID().slice(0, 8)}`;
  const runDirectory = safeArtifactPath(input.directory, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const baseCommit = await resolveCommit(input.config.repository, input.task.baseCommit);
  const baseTreeHash = await treeHash(input.config.repository, baseCommit);
  const worktree = await input.worktrees.create(runId, baseCommit);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  await input.events.emit("task_started", {
    runId,
    taskId: input.task.id,
    workerId: input.workerId,
    workerCount: input.workerCount,
    baseCommit,
  });
  try {
    const adapterInput = { task: input.task, worktree };
    const command = input.adapter.command(adapterInput);
    await input.events.emit("agent_process_started", { runId, command });
    const agent = await input.adapter.run(adapterInput);
    const stdoutPath = join(runDirectory, "agent.stdout.log");
    const stderrPath = join(runDirectory, "agent.stderr.log");
    const stdoutHash = await writeTextArtifact(stdoutPath, agent.process.stdout);
    const stderrHash = await writeTextArtifact(stderrPath, agent.process.stderr);
    await input.events.emit("agent_output", {
      runId,
      stdout: redactSecrets(agent.process.stdout),
      stderr: redactSecrets(agent.process.stderr),
    });
    await input.events.emit("agent_process_finished", {
      runId,
      exitCode: agent.process.exitCode,
      timedOut: agent.process.timedOut,
      durationMs: agent.process.durationMs,
    });

    await input.events.emit("validation_started", {
      runId,
      commands: input.task.validation,
    });
    const validation = await validateCommands(
      input.task.validation,
      worktree,
      input.task.timeoutSeconds * 1_000,
    );
    const validationPath = join(runDirectory, "validation.json");
    const validationHash = await writeJsonArtifact(validationPath, validation.results);
    await Promise.all(
      validation.results.flatMap((result, index) => [
        writeTextArtifact(join(runDirectory, `validation-${index + 1}.stdout.log`), result.stdout),
        writeTextArtifact(join(runDirectory, `validation-${index + 1}.stderr.log`), result.stderr),
      ]),
    );
    await input.events.emit("validation_finished", {
      runId,
      passed: validation.passed,
      results: validation.results,
    });

    const finalTreeHash = await workingTreeHash(worktree);
    const filesChanged = await changedFiles(worktree);
    const patch = await stagedPatch(worktree);
    const patchPath = join(runDirectory, "change.patch");
    const patchHash = await writeRawTextArtifact(patchPath, patch);
    const finalCommit = await currentCommit(worktree);
    await input.events.emit("git_snapshot", {
      runId,
      finalCommit,
      finalTreeHash,
      filesChanged,
      patchSha256: patchHash,
    });

    const validationCommands = validation.results.map((result) => result.command);
    const commands = [agent.process.command, ...validationCommands];
    const groups = commandGroups(validationCommands);
    const failureClassification = !validation.passed
      ? "validation_failed"
      : agent.process.timedOut
        ? "agent_timeout_validation_passed"
        : agent.process.exitCode !== 0
          ? "agent_exit_nonzero_validation_passed"
          : null;
    const run: EngineeringTaskRun = {
      runId,
      experimentId: input.experimentId,
      taskId: input.task.id,
      repositoryId: sha256(input.config.repository),
      baseCommit,
      baseTreeHash,
      workerId: input.workerId,
      workerCount: input.workerCount,
      agentProvider: input.adapter.name(),
      agentModel: null,
      agentVersion: input.agentVersion,
      agentCommand: command,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      processExitCode: agent.process.exitCode,
      timedOut: agent.process.timedOut,
      finalCommit,
      finalTreeHash,
      filesChanged,
      commands,
      testInvocations: groups.tests,
      buildInvocations: groups.builds,
      tokenUsage: agent.tokenUsage,
      providerCost: agent.providerCost,
      validationResult: validation.passed ? "passed" : "failed",
      integrationResult: "not_requested",
      failureClassification,
      accepted: validation.passed,
      artifacts: {
        stdout: relative(input.directory, stdoutPath),
        stdoutSha256: stdoutHash,
        stderr: relative(input.directory, stderrPath),
        stderrSha256: stderrHash,
        validation: relative(input.directory, validationPath),
        validationSha256: validationHash,
        patch: relative(input.directory, patchPath),
        patchSha256: patchHash,
      },
    };
    await writeJsonArtifact(join(runDirectory, "result.json"), run);
    await input.events.emit("task_finished", run);
    return run;
  } finally {
    await input.worktrees.remove(runId);
  }
}
