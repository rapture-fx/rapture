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
import type {
  EngineeringTaskRun,
  ExperimentConfig,
  PhaseTimings,
  TaskDefinition,
} from "./models.js";
import { timePhase } from "./timing.js";
import { deriveTrialSeed, orderTasks, trialIdFor } from "./trial.js";
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
  if (!Number.isSafeInteger(config.repetitions) || config.repetitions <= 0) {
    throw new ConfigurationError("repetitions must be a positive safe integer");
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
  const trialPlan = config.workerCounts.flatMap((workerCount) =>
    Array.from({ length: config.repetitions }, (_, index) => trialIdFor(workerCount, index + 1)),
  );
  const manifest = {
    schemaVersion: 2,
    experimentId,
    repository: config.repository,
    repositoryHead,
    repositoryFingerprint: await repositoryFingerprint(config.repository, repositoryHead),
    taskFile: config.taskFile,
    taskSetHash: await sha256File(config.taskFile),
    workerCounts: config.workerCounts,
    repetitions: config.repetitions,
    trialIds: trialPlan,
    agent: { name: adapter.name(), version: agentVersion, model: config.agentModel },
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
      `--repetitions ${config.repetitions}`,
      `--seed ${config.seed}`,
      `--agent ${config.agent}`,
      ...(config.agentModel === null ? [] : [`--agent-model ${config.agentModel}`]),
      `--output ${config.outputDirectory}`,
    ].join(" "),
  };
  await writeJsonArtifact(join(directory, "manifest.json"), manifest);
  await events.emit("experiment_started", { startedAt });
  await events.emit("experiment_configuration_recorded", { manifest });

  const integrationOutcomes: IntegrationOutcome[] = [];
  const trialFailures: unknown[] = [];
  let status: "completed" | "failed" | "interrupted" = "completed";
  let failure: unknown;
  try {
    for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
      const trialSeed = deriveTrialSeed(config.seed, repetition);
      const orderedTasks = orderTasks(config.tasks, trialSeed);
      for (const workerCount of config.workerCounts) {
        try {
          const runs = await runTrial({
            config,
            adapter,
            agentVersion,
            experimentId,
            directory,
            events,
            worktrees,
            workerCount,
            repetition,
            trialSeed,
            tasks: orderedTasks,
          });
          if (config.integration) {
            const commits = new Set(runs.map((run) => run.baseCommit));
            if (commits.size !== 1) {
              throw new ConfigurationError(
                "integration requires one common base commit per matrix",
              );
            }
            const baseCommit = commits.values().next().value;
            if (baseCommit === undefined) throw new Error("integration matrix has no runs");
            integrationOutcomes.push(
              await integratePatches({
                worktrees,
                trialId: trialIdFor(workerCount, repetition),
                workerCount,
                repetition,
                baseCommit,
                patches: runs
                  .filter((run) => run.accepted)
                  .map((run) => join(directory, run.artifacts.patch ?? "")),
                validation: config.integrationValidation,
                events,
              }),
            );
          }
        } catch (error: unknown) {
          trialFailures.push(error);
          status = error instanceof Error && error.name === "AbortError" ? "interrupted" : "failed";
          await events.emit("experiment_interrupted", {
            trialId: trialIdFor(workerCount, repetition),
            workerCount,
            repetition,
            reason: error instanceof Error ? error.name : "UnknownError",
          });
        }
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
      schemaVersion: 2,
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
  if (trialFailures.length > 0) {
    throw new AggregateError(trialFailures, `${trialFailures.length} trial(s) failed unexpectedly`);
  }
  return { experimentId, directory };
}

interface TrialInput {
  readonly config: ExperimentConfig;
  readonly adapter: AgentAdapter;
  readonly agentVersion: string | null;
  readonly experimentId: string;
  readonly directory: string;
  readonly events: EventWriter;
  readonly worktrees: WorktreeManager;
  readonly workerCount: number;
  readonly repetition: number;
  readonly trialSeed: number;
  readonly tasks: readonly TaskDefinition[];
}

async function runTrial(input: TrialInput): Promise<readonly EngineeringTaskRun[]> {
  const trialId = trialIdFor(input.workerCount, input.repetition);
  const trialDirectory = safeArtifactPath(input.directory, "trials", trialId);
  await mkdir(join(trialDirectory, "runs"), { recursive: true });
  const taskOrder = input.tasks.map((task) => task.id);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  await writeJsonArtifact(join(trialDirectory, "trial.json"), {
    schemaVersion: 1,
    trialId,
    experimentId: input.experimentId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    trialSeed: input.trialSeed,
    taskOrder,
    startedAt,
  });
  await input.events.emit("trial_started", {
    trialId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    trialSeed: input.trialSeed,
    taskOrder,
    startedAt,
  });
  let trialStatus: "completed" | "failed" = "completed";
  try {
    const settled = await runBounded(input.tasks, input.workerCount, async (task, index) => {
      const workerId = `w${input.workerCount}-${(index % input.workerCount) + 1}`;
      await input.events.emit("task_queued", {
        trialId,
        taskId: task.id,
        workerCount: input.workerCount,
        repetition: input.repetition,
      });
      await input.events.emit("worker_started", {
        trialId,
        workerId,
        workerCount: input.workerCount,
        repetition: input.repetition,
      });
      try {
        return await runTask({ ...input, trialId, trialDirectory, task, workerId });
      } finally {
        await input.events.emit("worker_finished", {
          trialId,
          workerId,
          workerCount: input.workerCount,
          repetition: input.repetition,
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
      trialStatus = "failed";
      throw new AggregateError(failures, `${failures.length} worker task(s) failed unexpectedly`);
    }
    return runs.sort((left, right) => left.taskId.localeCompare(right.taskId));
  } finally {
    const finishedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - started);
    await writeJsonArtifact(join(trialDirectory, "trial-outcome.json"), {
      schemaVersion: 1,
      trialId,
      status: trialStatus,
      startedAt,
      finishedAt,
      durationMs,
      taskOrder,
      trialSeed: input.trialSeed,
    });
    await input.events.emit("trial_finished", {
      trialId,
      workerCount: input.workerCount,
      repetition: input.repetition,
      trialSeed: input.trialSeed,
      taskOrder,
      status: trialStatus,
      finishedAt,
      durationMs,
    });
  }
}

interface RunTaskInput extends TrialInput {
  readonly trialId: string;
  readonly trialDirectory: string;
  readonly task: TaskDefinition;
  readonly workerId: string;
}

async function runTask(input: RunTaskInput): Promise<EngineeringTaskRun> {
  const runId = `${input.trialId}-${safeTaskId(input.task.id)}-${randomUUID().slice(0, 8)}`;
  const runDirectory = safeArtifactPath(input.trialDirectory, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const baseCommit = await resolveCommit(input.config.repository, input.task.baseCommit);
  const baseTreeHash = await treeHash(input.config.repository, baseCommit);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let worktreeSetupMs: number | null = null;
  let agentExecutionMs: number | null = null;
  let validationMs: number | null = null;
  let worktreeCleanupMs: number | null = null;
  let created = false;

  const phaseTimings = (): PhaseTimings => ({
    worktreeSetupMs,
    agentExecutionMs,
    validationMs,
    integrationMs: null,
    worktreeCleanupMs,
    totalRunMs: Math.round(performance.now() - started),
  });

  try {
    const setup = await timePhase(() => input.worktrees.create(runId, baseCommit));
    worktreeSetupMs = setup.durationMs;
    created = true;
    const worktree = setup.value;
    await input.events.emit("task_started", {
      runId,
      trialId: input.trialId,
      taskId: input.task.id,
      workerId: input.workerId,
      workerCount: input.workerCount,
      repetition: input.repetition,
      baseCommit,
    });
    try {
      const adapterInput = {
        task: input.task,
        worktree,
        model: input.config.agentModel,
        trialId: input.trialId,
        repetition: input.repetition,
      };
      const command = input.adapter.command(adapterInput);
      await input.events.emit("agent_process_started", { runId, trialId: input.trialId, command });
      const agent = await timePhase(() => input.adapter.run(adapterInput));
      agentExecutionMs = agent.durationMs;
      const stdoutPath = join(runDirectory, "agent.stdout.log");
      const stderrPath = join(runDirectory, "agent.stderr.log");
      const stdoutHash = await writeTextArtifact(stdoutPath, agent.value.process.stdout);
      const stderrHash = await writeTextArtifact(stderrPath, agent.value.process.stderr);
      await input.events.emit("agent_output", {
        runId,
        trialId: input.trialId,
        stdout: redactSecrets(agent.value.process.stdout),
        stderr: redactSecrets(agent.value.process.stderr),
      });
      await input.events.emit("agent_process_finished", {
        runId,
        trialId: input.trialId,
        exitCode: agent.value.process.exitCode,
        timedOut: agent.value.process.timedOut,
        durationMs: agent.value.process.durationMs,
        phaseDurationMs: agentExecutionMs,
      });

      await input.events.emit("validation_started", {
        runId,
        trialId: input.trialId,
        commands: input.task.validation,
      });
      const validation = await timePhase(() =>
        validateCommands(input.task.validation, worktree, input.task.timeoutSeconds * 1_000),
      );
      validationMs = validation.durationMs;
      const validationPath = join(runDirectory, "validation.json");
      const validationHash = await writeJsonArtifact(validationPath, validation.value.results);
      await Promise.all(
        validation.value.results.flatMap((result, index) => [
          writeTextArtifact(
            join(runDirectory, `validation-${index + 1}.stdout.log`),
            result.stdout,
          ),
          writeTextArtifact(
            join(runDirectory, `validation-${index + 1}.stderr.log`),
            result.stderr,
          ),
        ]),
      );
      await input.events.emit("validation_finished", {
        runId,
        trialId: input.trialId,
        passed: validation.value.passed,
        results: validation.value.results,
        durationMs: validationMs,
      });

      const finalTreeHash = await workingTreeHash(worktree);
      const filesChanged = await changedFiles(worktree);
      const patch = await stagedPatch(worktree);
      const patchPath = join(runDirectory, "change.patch");
      const patchHash = await writeRawTextArtifact(patchPath, patch);
      const finalCommit = await currentCommit(worktree);
      await input.events.emit("git_snapshot", {
        runId,
        trialId: input.trialId,
        finalCommit,
        finalTreeHash,
        filesChanged,
        patchSha256: patchHash,
      });

      const validationCommands = validation.value.results.map((result) => result.command);
      const commands = [agent.value.process.command, ...validationCommands];
      const groups = commandGroups(validationCommands);
      const failureClassification = !validation.value.passed
        ? "validation_failed"
        : agent.value.process.timedOut
          ? "agent_timeout_validation_passed"
          : agent.value.process.exitCode !== 0
            ? "agent_exit_nonzero_validation_passed"
            : null;
      const cleanup = await timePhase(() => input.worktrees.remove(runId));
      worktreeCleanupMs = cleanup.durationMs;
      created = false;
      const timings = phaseTimings();
      const run: EngineeringTaskRun = {
        runId,
        experimentId: input.experimentId,
        trialId: input.trialId,
        repetition: input.repetition,
        taskId: input.task.id,
        repositoryId: sha256(input.config.repository),
        baseCommit,
        baseTreeHash,
        workerId: input.workerId,
        workerCount: input.workerCount,
        agentProvider: input.adapter.name(),
        agentModel: input.config.agentModel,
        agentVersion: input.agentVersion,
        agentCommand: command,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: timings.totalRunMs,
        phaseTimings: timings,
        processExitCode: agent.value.process.exitCode,
        timedOut: agent.value.process.timedOut,
        finalCommit,
        finalTreeHash,
        filesChanged,
        commands,
        testInvocations: groups.tests,
        buildInvocations: groups.builds,
        tokenUsage: agent.value.tokenUsage,
        providerCost: agent.value.providerCost,
        validationResult: validation.value.passed ? "passed" : "failed",
        integrationResult: "not_requested",
        failureClassification,
        accepted: validation.value.passed,
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
      if (created) {
        const cleanup = await timePhase(() => input.worktrees.remove(runId));
        worktreeCleanupMs = cleanup.durationMs;
        created = false;
      }
    }
  } catch (error: unknown) {
    await input.events.emit("task_failed", {
      runId,
      trialId: input.trialId,
      taskId: input.task.id,
      workerId: input.workerId,
      workerCount: input.workerCount,
      repetition: input.repetition,
      phaseTimings: phaseTimings(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
