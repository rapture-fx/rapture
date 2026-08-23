import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { classifyRunOutcome, detectIntegritySignals } from "@rapture/kernel";
import { codexAgentAdapter } from "./adapters/codex.js";
import { fakeAgentAdapter } from "./adapters/fake.js";
import { opencodeAgentAdapter } from "./adapters/opencode.js";
import type { AgentAdapter, AgentRunResult } from "./adapters/types.js";
import {
  redactSecrets,
  safeArtifactPath,
  sha256,
  sha256File,
  writeJsonArtifact,
  writeJsonArtifactIfAbsent,
  writeJsonArtifactOverwrite,
  writeRawTextArtifact,
  writeTextArtifact,
} from "./artifacts.js";
import { appendObservedOutcomes, persistStepPredictions } from "./capacity-report.js";
import { ConfigurationError, loadTasks } from "./config.js";
import {
  collectEnvironmentFingerprint,
  createContinuationProvenance,
  environmentFingerprintDiffers,
} from "./continuation.js";
import type { PricingContext } from "./economics.js";
import { createEventWriter, type EventWriter } from "./events.js";
import {
  changedFiles,
  collectFileChanges,
  currentCommit,
  repositoryFingerprint,
  resolveCommit,
  runGit,
  stagedPatch,
  treeHash,
  workingTreeHash,
} from "./git.js";
import { detectAgentEnvironmentVariables, persistHostStateSnapshot } from "./host-state.js";
import { type IntegrationOutcome, integratePatches } from "./integration.js";
import { createRunLedger, type RunLedger } from "./ledger.js";
import {
  canonicalExperimentIdentity,
  type ExperimentIdentity,
  isRerunEligibleState,
  isTerminalRunState,
  type LogicalRunState,
  logicalRunIdFor,
} from "./logical-run.js";
import { deriveMetrics } from "./metrics.js";
import type {
  ContinuationRecord,
  EngineeringTaskRun,
  ExperimentConfig,
  MatrixCompletion,
  MatrixCompletionStatus,
  PhaseTimings,
  TaskDefinition,
} from "./models.js";
import {
  createProcessTelemetryFileSink,
  createProcessTelemetrySampler,
} from "./process-telemetry.js";
import { extractRuntimeObservability, type RuntimeObservability } from "./provider-events.js";
import { persistRuntimeFingerprint, platformSummary } from "./runtime-fingerprint.js";
import { createHostTelemetrySampler, type TelemetrySink } from "./telemetry.js";
import { timePhase } from "./timing.js";
import { deriveTrialSeed, orderTasks, trialIdFor } from "./trial.js";
import { validateCommands } from "./validation.js";
import { runBounded } from "./worker.js";
import { createWorktreeManager, type WorktreeManager } from "./worktree.js";

function adapterFor(name: ExperimentConfig["agent"]): AgentAdapter {
  if (name === "fake") return fakeAgentAdapter;
  if (name === "opencode") return opencodeAgentAdapter;
  return codexAgentAdapter;
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

const PROVIDER_BLOCK_PATTERNS: readonly RegExp[] = [
  /\busage limit\b/iu,
  /\brate limit\b/iu,
  /\bquota\b/iu,
  /\btry again at\b/iu,
  /\binsufficient_quota\b/iu,
  /\b429\b/u,
];

export function classifyProviderBlock(result: {
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number | null;
}): boolean {
  if (result.exitCode === 0) return false;
  const combined = `${result.stderr}\n${result.stdout}`;
  return PROVIDER_BLOCK_PATTERNS.some((pattern) => pattern.test(combined));
}

export interface ExperimentExecution {
  readonly experimentId: string;
  readonly directory: string;
}

export interface RunExperimentOptions {
  readonly resumeDirectory?: string;
}

interface AgentActivity {
  readonly active: number;
  readonly increment: () => void;
  readonly decrement: () => void;
}

function createAgentActivity(): AgentActivity {
  const state = { active: 0 };
  return {
    get active() {
      return state.active;
    },
    increment: () => {
      state.active += 1;
    },
    decrement: () => {
      state.active = Math.max(0, state.active - 1);
    },
  };
}

export interface LogicalRunPlanEntry {
  readonly logicalRunId: string;
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly taskId: string;
  readonly trialSeed: number;
  readonly taskOrder: readonly string[];
}

export interface ExperimentPlan {
  readonly experimentIdentity: ExperimentIdentity;
  readonly experimentIdentityHash: string;
  readonly logicalRuns: readonly LogicalRunPlanEntry[];
  readonly trialSeeds: Readonly<Record<number, number>>;
  readonly taskOrderByRepetition: Readonly<Record<number, readonly string[]>>;
}

export function buildExperimentPlan(
  config: ExperimentConfig,
  identity: ExperimentIdentity,
): ExperimentPlan {
  const trialSeeds: Record<number, number> = {};
  const taskOrderByRepetition: Record<number, readonly string[]> = {};
  const logicalRuns: LogicalRunPlanEntry[] = [];
  for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
    const trialSeed = deriveTrialSeed(config.seed, repetition);
    const orderedTasks = orderTasks(config.tasks, trialSeed);
    trialSeeds[repetition] = trialSeed;
    taskOrderByRepetition[repetition] = orderedTasks.map((task) => task.id);
    for (const workerCount of config.workerCounts) {
      const trialId = trialIdFor(workerCount, repetition);
      for (const task of orderedTasks) {
        logicalRuns.push({
          logicalRunId: logicalRunIdFor({
            experimentIdentityHash: canonicalExperimentIdentity(identity),
            workerCount,
            repetition,
            taskId: task.id,
            trialSeed,
            agent: identity.agent,
            agentModel: identity.agentModel,
            agentVersion: identity.agentVersion,
          }),
          trialId,
          workerCount,
          repetition,
          taskId: task.id,
          trialSeed,
          taskOrder: orderedTasks.map((item) => item.id),
        });
      }
    }
  }
  return {
    experimentIdentity: identity,
    experimentIdentityHash: canonicalExperimentIdentity(identity),
    logicalRuns,
    trialSeeds,
    taskOrderByRepetition,
  };
}

interface ResumeManifest {
  readonly schemaVersion?: number;
  readonly experimentId: string;
  readonly experimentIdentityHash: string;
  readonly repository: string;
  readonly repositoryFingerprint: string;
  readonly repositoryHead: string;
  readonly taskFile: string;
  readonly taskSetHash: string;
  readonly workerCounts: readonly number[];
  readonly repetitions: number;
  readonly seed: number;
  readonly agent: {
    readonly name: "fake" | "codex" | "opencode";
    readonly version: string | null;
    readonly model: string | null;
  };
  readonly integration: boolean;
  readonly integrationValidation: readonly string[];
  readonly executionOrder?: "repetition-major" | "worker-major";
  readonly environment: Readonly<Record<string, unknown>>;
  readonly benchmark?: {
    readonly suiteIds: readonly string[];
    readonly suiteVersions: readonly string[];
    readonly repositoryIds: readonly string[];
    readonly taskClasses: readonly string[];
  };
  readonly pricing?: PricingContext | null;
}

async function resumeConfigFromManifest(
  manifest: ResumeManifest,
  resumeDirectory: string,
): Promise<ExperimentConfig> {
  const tasks = await loadTasks(manifest.taskFile);
  return {
    repository: manifest.repository,
    taskFile: manifest.taskFile,
    tasks,
    workerCounts: manifest.workerCounts,
    repetitions: manifest.repetitions,
    agent: manifest.agent.name,
    agentModel: manifest.agent.model,
    outputDirectory: resumeDirectory,
    budget: {},
    seed: manifest.seed,
    integration: manifest.integration,
    integrationValidation: manifest.integrationValidation,
    executionOrder: manifest.executionOrder,
    pricing: manifest.pricing ?? null,
  };
}

function assertConfigMatchesManifest(config: ExperimentConfig, manifest: ResumeManifest): void {
  if (config.repository !== manifest.repository) {
    throw new ConfigurationError(
      `resume repository mismatch: expected ${manifest.repository}, got ${config.repository}`,
    );
  }
  if (JSON.stringify(config.workerCounts) !== JSON.stringify(manifest.workerCounts)) {
    throw new ConfigurationError("resume workerCounts mismatch with the recorded manifest");
  }
  if (config.repetitions !== manifest.repetitions) {
    throw new ConfigurationError("resume repetitions mismatch with the recorded manifest");
  }
  if (config.seed !== manifest.seed) {
    throw new ConfigurationError("resume seed mismatch with the recorded manifest");
  }
  if (config.agent !== manifest.agent.name) {
    throw new ConfigurationError("resume agent mismatch with the recorded manifest");
  }
  if (config.integration !== manifest.integration) {
    throw new ConfigurationError("resume agent integration mismatch with the recorded manifest");
  }
  const manifestOrder = manifest.executionOrder ?? "repetition-major";
  if ((config.executionOrder ?? "repetition-major") !== manifestOrder) {
    throw new ConfigurationError("resume executionOrder mismatch with the recorded manifest");
  }
  if (JSON.stringify(config.pricing ?? null) !== JSON.stringify(manifest.pricing ?? null)) {
    throw new ConfigurationError("resume pricing context mismatch with the recorded manifest");
  }
}

export async function resumeExperiment(resumeDirectory: string): Promise<ExperimentExecution> {
  const raw = JSON.parse(await readFile(join(resumeDirectory, "manifest.json"), "utf8")) as unknown;
  const manifest = raw as ResumeManifest;
  const config = await resumeConfigFromManifest(manifest, resumeDirectory);
  return runExperiment(config, { resumeDirectory });
}

export async function runExperiment(
  config: ExperimentConfig,
  options: RunExperimentOptions = {},
): Promise<ExperimentExecution> {
  const resuming = options.resumeDirectory !== undefined;
  const continuationSessionId = resuming ? randomUUID() : null;
  let experimentId: string;
  let directory: string;
  let manifest: ResumeManifest | null = null;
  let existingEventsPath: string | null = null;
  let effectiveConfig = config;

  if (resuming) {
    const resumeDirectory = options.resumeDirectory;
    if (resumeDirectory === undefined) throw new Error("resume directory required");
    const raw = JSON.parse(
      await readFile(join(resumeDirectory, "manifest.json"), "utf8"),
    ) as unknown;
    const parsed = raw as ResumeManifest;
    manifest = parsed;
    experimentId = parsed.experimentId;
    directory = resumeDirectory;
    existingEventsPath = join(directory, "events.jsonl");
    effectiveConfig = await resumeConfigFromManifest(parsed, resumeDirectory);
    assertConfigMatchesManifest(effectiveConfig, parsed);
  } else {
    experimentId = `exp-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 12)}`;
    directory = join(config.outputDirectory, experimentId);
  }

  if (effectiveConfig.tasks.some((task) => !task.independent || task.dependsOn.length > 0)) {
    throw new ConfigurationError(
      "V0 execution supports independent tasks only; dependencies are validated but not executed",
    );
  }
  if (!Number.isSafeInteger(effectiveConfig.repetitions) || effectiveConfig.repetitions <= 0) {
    throw new ConfigurationError("repetitions must be a positive safe integer");
  }
  const adapter = adapterFor(effectiveConfig.agent);
  const availability = await adapter.isAvailable();
  if (!availability.available) {
    throw new ConfigurationError(`agent adapter unavailable: ${availability.detail}`);
  }
  const repositoryHead = await resolveCommit(effectiveConfig.repository, "HEAD");
  const targetStatus = await runGit(effectiveConfig.repository, ["status", "--porcelain"]);
  if (targetStatus.stdout.trim().length > 0) {
    throw new ConfigurationError(
      "target repository must be clean so the recorded base commit fully defines the experiment",
    );
  }
  const agentVersion = await adapter.version();
  if (!resuming) {
    await mkdir(config.outputDirectory, { recursive: true });
    await mkdir(directory, { recursive: false });
  }

  const events = await createEventWriter(
    join(directory, "events.jsonl"),
    experimentId,
    existingEventsPath === null ? {} : { append: true },
  );
  const worktrees = await createWorktreeManager(
    effectiveConfig.repository,
    join(directory, ".worktrees"),
  );
  const ledger = await createRunLedger(join(directory, "logical-runs.jsonl"));
  const telemetrySink = createTelemetryFileSink(join(directory, "telemetry.jsonl"));
  const processTelemetrySink = createProcessTelemetryFileSink(
    join(directory, "process-telemetry.jsonl"),
  );
  const continuation = await createContinuationProvenance(join(directory, "continuations.jsonl"));
  const startedAt = new Date().toISOString();
  const trialPlan = effectiveConfig.workerCounts.flatMap((workerCount) =>
    Array.from({ length: effectiveConfig.repetitions }, (_, index) =>
      trialIdFor(workerCount, index + 1),
    ),
  );
  const repositoryFingerprintHash =
    manifest === null
      ? await repositoryFingerprint(effectiveConfig.repository, repositoryHead)
      : manifest.repositoryFingerprint;
  const taskSetHash =
    manifest === null ? await sha256File(effectiveConfig.taskFile) : manifest.taskSetHash;
  const experimentIdentity: ExperimentIdentity = {
    repositoryFingerprint: repositoryFingerprintHash,
    taskSetHash,
    workerCounts: effectiveConfig.workerCounts,
    repetitions: effectiveConfig.repetitions,
    seed: effectiveConfig.seed,
    agent: effectiveConfig.agent,
    agentModel: effectiveConfig.agentModel,
    agentVersion,
    integration: effectiveConfig.integration,
  };
  const plan = buildExperimentPlan(effectiveConfig, experimentIdentity);
  if (manifest !== null && manifest.experimentIdentityHash !== plan.experimentIdentityHash) {
    throw new ConfigurationError(
      "resume identity drifted from the recorded manifest; refusing to continue",
    );
  }

  const executionOrder = effectiveConfig.executionOrder ?? "repetition-major";
  if (manifest === null) {
    manifest = {
      schemaVersion: 2,
      experimentId,
      experimentIdentityHash: plan.experimentIdentityHash,
      repository: effectiveConfig.repository,
      repositoryHead,
      repositoryFingerprint: repositoryFingerprintHash,
      taskFile: effectiveConfig.taskFile,
      taskSetHash,
      workerCounts: effectiveConfig.workerCounts,
      repetitions: effectiveConfig.repetitions,
      trialIds: trialPlan,
      agent: { name: adapter.name(), version: agentVersion, model: effectiveConfig.agentModel },
      environment: await environmentFingerprintValue(),
      benchmark: {
        suiteIds: [
          ...new Set(effectiveConfig.tasks.flatMap((task) => task.benchmark?.suiteId ?? [])),
        ].sort(),
        suiteVersions: [
          ...new Set(effectiveConfig.tasks.flatMap((task) => task.benchmark?.suiteVersion ?? [])),
        ].sort(),
        repositoryIds: [
          ...new Set(effectiveConfig.tasks.flatMap((task) => task.benchmark?.repositoryId ?? [])),
        ].sort(),
        taskClasses: [
          ...new Set(effectiveConfig.tasks.flatMap((task) => task.benchmark?.taskClass ?? [])),
        ].sort(),
      },
      integration: effectiveConfig.integration,
      integrationValidation: effectiveConfig.integrationValidation,
      executionOrder,
      budget: effectiveConfig.budget,
      seed: effectiveConfig.seed,
      startedAt,
      pricing: effectiveConfig.pricing ?? null,
      reproduction: [
        "rapture run",
        `--repo ${effectiveConfig.repository}`,
        `--tasks ${effectiveConfig.taskFile}`,
        `--workers ${effectiveConfig.workerCounts.join(",")}`,
        `--repetitions ${effectiveConfig.repetitions}`,
        `--seed ${effectiveConfig.seed}`,
        `--agent ${effectiveConfig.agent}`,
        ...(effectiveConfig.agentModel === null
          ? []
          : [`--agent-model ${effectiveConfig.agentModel}`]),
        `--output ${config.outputDirectory}`,
      ].join(" "),
    } as ResumeManifest;
    await writeJsonArtifact(join(directory, "manifest.json"), manifest);
    await events.emit("experiment_started", { startedAt });
    await events.emit("experiment_configuration_recorded", { manifest });
  } else if (continuationSessionId !== null) {
    await events.emit("continuation_started", {
      continuationSessionId,
      previousManifest: { experimentId },
      resumedFrom: directory,
    });
  }

  const envFingerprint = await collectEnvironmentFingerprint(process.cwd());
  const previousEnv = manifest.environment as Readonly<Record<string, unknown>> | undefined;
  const environmentDifferences =
    previousEnv === undefined
      ? []
      : environmentFingerprintDiffers(previousEnv, { ...envFingerprint });

  const integrationOutcomes: IntegrationOutcome[] = [];
  const trialFailures: unknown[] = [];
  let status: "completed" | "failed" | "interrupted" = "completed";
  let failure: unknown;
  const activity = createAgentActivity();
  const agentActivity = activity;
  let telemetryError: unknown = null;
  try {
    // Clean-host protocol: persist a preflight host-state snapshot with the
    // experiment provenance (exclusive create; resume keeps the original).
    await persistHostStateSnapshot(directory);
  } catch {
    // host provenance is best-effort and must never block execution
  }
  try {
    // Provider/runtime capability fingerprint (exclusive create).
    await persistRuntimeFingerprint(directory, {
      agentProvider: adapter.name(),
      agentCliVersion: agentVersion,
      agentModel: effectiveConfig.agentModel,
      agentMode: "build",
      structuredOutputFormat: effectiveConfig.agent === "opencode" ? "json" : null,
      structuredEventTypesObserved: null,
      adapterName: adapter.name(),
      adapterVersion: agentVersion,
      modelProbe: null,
      ...platformSummary(),
      agentEnvironmentVariableNames: detectAgentEnvironmentVariables(process.env),
    });
  } catch {
    // runtime provenance is best-effort and must never block execution
  }
  const processSampler = createProcessTelemetrySampler(processTelemetrySink, {
    worktreeMarker: join(directory, ".worktrees"),
    onError: () => undefined,
  });
  const sampler = createHostTelemetrySampler(telemetrySink, {
    intervalMs: 1_000,
    activeAgentWorkers: () => agentActivity.active,
    onError: (error) => {
      telemetryError = error;
      void events.emit("telemetry_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  sampler.start();
  processSampler.start();

  let resumedRuns = 0;
  let skippedCompletedRuns = 0;

  try {
    const executeTrialGroup = async (workerCount: number, repetition: number): Promise<void> => {
      const trialSeed = deriveTrialSeed(effectiveConfig.seed, repetition);
      const orderedTasks = orderTasks(effectiveConfig.tasks, trialSeed);
      const trialId = trialIdFor(workerCount, repetition);
      const trialEntries = plan.logicalRuns.filter((entry) => entry.trialId === trialId);
      for (const entry of trialEntries) {
        const recorded = ledger.get(entry.logicalRunId);
        if (recorded !== null && isTerminalRunState(recorded.state)) {
          skippedCompletedRuns += 1;
          void events.emit("run_skipped", {
            trialId,
            taskId: entry.taskId,
            workerCount,
            repetition,
            logicalRunId: entry.logicalRunId,
            state: recorded.state,
          });
        }
      }
      const pending = trialEntries.filter((entry) => {
        const recorded = ledger.get(entry.logicalRunId);
        const state = recorded?.state ?? "pending";
        return !isTerminalRunState(state);
      });
      resumedRuns += pending.filter((entry) =>
        isRerunEligibleState(ledger.get(entry.logicalRunId)?.state ?? "pending"),
      ).length;
      if (pending.length === 0) {
        return;
      }
      try {
        const runs = await runTrial({
          config: effectiveConfig,
          adapter,
          agentVersion,
          experimentIdentityHash: plan.experimentIdentityHash,
          experimentId,
          directory,
          events,
          worktrees,
          ledger,
          workerCount,
          repetition,
          trialSeed,
          tasks: orderedTasks,
          pendingEntries: pending,
          activity: agentActivity,
        });
        if (effectiveConfig.integration) {
          const commits = new Set(runs.map((run) => run.baseCommit));
          if (commits.size !== 1) {
            throw new ConfigurationError("integration requires one common base commit per matrix");
          }
          const baseCommit = commits.values().next().value;
          if (baseCommit === undefined) throw new Error("integration matrix has no runs");
          integrationOutcomes.push(
            await integratePatches({
              worktrees,
              trialId,
              workerCount,
              repetition,
              baseCommit,
              patches: runs
                .filter((run) => run.accepted)
                .map((run) => join(directory, run.artifacts.patch ?? "")),
              validation: effectiveConfig.integrationValidation,
              events,
            }),
          );
        }
      } catch (error: unknown) {
        trialFailures.push(error);
        status = error instanceof Error && error.name === "AbortError" ? "interrupted" : "failed";
        await events.emit("experiment_interrupted", {
          trialId,
          workerCount,
          repetition,
          reason: error instanceof Error ? error.name : "UnknownError",
        });
      }
    };
    if (executionOrder === "worker-major") {
      const sortedWorkerCounts = [...effectiveConfig.workerCounts].sort(
        (left, right) => left - right,
      );
      for (const workerCount of sortedWorkerCounts) {
        for (
          let repetition = 1;
          repetition <= effectiveConfig.repetitions && status === "completed";
          repetition += 1
        ) {
          await executeTrialGroup(workerCount, repetition);
        }
        if (status === "completed") {
          // Persist next-step predictions BEFORE any trial of the next worker
          // count executes (capacity-prediction chronology).
          await persistStepPredictions(directory, workerCount, effectiveConfig.repetitions).catch(
            () => undefined,
          );
        }
      }
    } else {
      for (let repetition = 1; repetition <= effectiveConfig.repetitions; repetition += 1) {
        for (const workerCount of effectiveConfig.workerCounts) {
          await executeTrialGroup(workerCount, repetition);
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
    await sampler.stop();
    await processSampler.stop();
    const completion = await computeMatrixCompletion(directory, plan);
    const metrics = await deriveMetrics(join(directory, "events.jsonl"));
    try {
      // Append observed held-out outcomes for persisted predictions. Existing
      // records are never rewritten.
      await appendObservedOutcomes(directory);
    } catch {
      // prediction chronology must not fail experiment finalization
    }
    await writeJsonArtifactOverwrite(join(directory, "outcome.json"), {
      schemaVersion: 2,
      experimentId,
      status,
      startedAt,
      finishedAt,
      metrics,
      integrationOutcomes,
      completion,
      continuationSessionId,
      environmentDifferences,
      telemetryError: telemetryError === null ? null : String(telemetryError),
    });
    await events.emit("matrix_completion", { completion });
    if (continuationSessionId !== null) {
      const record: ContinuationRecord = {
        schemaVersion: 1,
        continuationSessionId,
        startedAt,
        finishedAt,
        experimentDirectory: directory,
        experimentFingerprintHash: plan.experimentIdentityHash,
        environmentFingerprint: { ...envFingerprint },
        previousContinuationSessionId: null,
        resumedRuns,
        skippedCompletedRuns,
        providerBlockedRuns: completion.providerBlockedRuns,
        infrastructureFailedRuns: completion.infrastructureFailedRuns,
        interruptedRuns: completion.interruptedRuns,
        newOutstandingRuns: completion.outstandingRuns,
      };
      await continuation.record(record);
      await events.emit("continuation_finished", {
        continuationSessionId,
        experimentId,
        resumedRuns,
        skippedCompletedRuns,
        providerBlockedRuns: completion.providerBlockedRuns,
        infrastructureFailedRuns: completion.infrastructureFailedRuns,
        interruptedRuns: completion.interruptedRuns,
        outstandingRuns: completion.outstandingRuns,
      });
    }
    await events.emit("experiment_finished", { status, finishedAt });
    await rmdir(worktrees.root).catch(() => undefined);
  }
  if (failure !== undefined) throw failure;
  if (trialFailures.length > 0) {
    throw new AggregateError(trialFailures, `${trialFailures.length} trial(s) failed unexpectedly`);
  }
  return { experimentId, directory };
}

async function environmentFingerprintValue(): Promise<Readonly<Record<string, unknown>>> {
  const fingerprint = await collectEnvironmentFingerprint(process.cwd());
  return { ...fingerprint };
}

interface TrialInput {
  readonly config: ExperimentConfig;
  readonly adapter: AgentAdapter;
  readonly agentVersion: string | null;
  readonly experimentIdentityHash: string;
  readonly experimentId: string;
  readonly directory: string;
  readonly events: EventWriter;
  readonly worktrees: WorktreeManager;
  readonly ledger: RunLedger;
  readonly workerCount: number;
  readonly repetition: number;
  readonly trialSeed: number;
  readonly tasks: readonly TaskDefinition[];
  readonly pendingEntries: readonly LogicalRunPlanEntry[];
  readonly activity: AgentActivity;
}

async function runTrial(input: TrialInput): Promise<readonly EngineeringTaskRun[]> {
  const trialId = trialIdFor(input.workerCount, input.repetition);
  const trialDirectory = safeArtifactPath(input.directory, "trials", trialId);
  await mkdir(join(trialDirectory, "runs"), { recursive: true });
  const taskOrder = input.tasks.map((task) => task.id);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  await writeJsonArtifactIfAbsent(join(trialDirectory, "trial.json"), {
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
    const taskById = new Map(input.tasks.map((task) => [task.id, task]));
    const pendingTasks = input.pendingEntries
      .map((entry) => taskById.get(entry.taskId))
      .filter((task): task is TaskDefinition => task !== undefined);
    const settled = await runBounded(
      pendingTasks,
      input.workerCount,
      (task, index, queueWaitMs) => {
        const workerId = `w${input.workerCount}-${(index % input.workerCount) + 1}`;
        void input.events.emit("task_queued", {
          trialId,
          taskId: task.id,
          workerCount: input.workerCount,
          repetition: input.repetition,
          queueWaitMs,
        });
        void input.events.emit("worker_started", {
          trialId,
          workerId,
          workerCount: input.workerCount,
          repetition: input.repetition,
        });
        return runTask({
          ...input,
          trialId,
          trialDirectory,
          task,
          workerId,
          queueWaitMs,
        }).finally(async () => {
          await input.events.emit("worker_finished", {
            trialId,
            workerId,
            workerCount: input.workerCount,
            repetition: input.repetition,
          });
        });
      },
    );
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
    await writeJsonArtifactOverwrite(join(trialDirectory, "trial-outcome.json"), {
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
  readonly queueWaitMs: number;
}

async function runTask(input: RunTaskInput): Promise<EngineeringTaskRun> {
  const planEntry = planEntryForRun(input);
  const attemptId = `${input.trialId}-${safeTaskId(input.task.id)}-${randomUUID().slice(0, 8)}`;
  const runDirectory = safeArtifactPath(input.trialDirectory, "runs", attemptId);
  await mkdir(runDirectory, { recursive: true });
  const baseCommit = await resolveCommit(input.config.repository, input.task.baseCommit);
  const baseTreeHash = await treeHash(input.config.repository, baseCommit);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let worktreeSetupMs: number | null = null;
  let agentExecutionMs: number | null = null;
  let validationMs: number | null = null;
  let artifactPersistenceMs: number | null = null;
  let worktreeCleanupMs: number | null = null;
  let created = false;
  let activeAgentsAtStart = 0;
  let activeAgentsAtEnd = 0;
  const priorAttempts = input.ledger.get(planEntry.logicalRunId);
  const attemptCount = (priorAttempts?.attemptCount ?? 0) + 1;

  const phaseTimings = (): PhaseTimings => {
    const totalRunMs = Math.round(performance.now() - started);
    const otherOrchestrationMs =
      worktreeSetupMs !== null &&
      agentExecutionMs !== null &&
      validationMs !== null &&
      artifactPersistenceMs !== null &&
      worktreeCleanupMs !== null
        ? Math.max(
            0,
            totalRunMs -
              worktreeSetupMs -
              input.queueWaitMs -
              agentExecutionMs -
              validationMs -
              artifactPersistenceMs -
              worktreeCleanupMs,
          )
        : null;
    return {
      worktreeSetupMs,
      queueWaitMs: input.queueWaitMs,
      agentExecutionMs,
      validationMs,
      artifactPersistenceMs,
      integrationMs: null,
      worktreeCleanupMs,
      otherOrchestrationMs,
      totalRunMs,
    };
  };

  await input.ledger.record({
    logicalRunId: planEntry.logicalRunId,
    attemptId,
    state: "running",
    trialId: input.trialId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    taskId: input.task.id,
    attemptedAt: startedAt,
    attemptCount,
  });

  try {
    const setup = await timePhase(() => input.worktrees.create(attemptId, baseCommit));
    worktreeSetupMs = setup.durationMs;
    created = true;
    const worktree = setup.value;
    await input.events.emit("task_started", {
      runId: attemptId,
      logicalRunId: planEntry.logicalRunId,
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
      await input.events.emit("agent_process_started", {
        runId: attemptId,
        trialId: input.trialId,
        command,
      });
      input.activity.increment();
      activeAgentsAtStart = input.activity.active;
      let agent: { readonly value: AgentRunResult; readonly durationMs: number };
      try {
        agent = await timePhase(() => input.adapter.run(adapterInput));
      } finally {
        activeAgentsAtEnd = input.activity.active;
        input.activity.decrement();
      }
      agentExecutionMs = agent.durationMs;
      // Provider/runtime boundary observability, parsed from the structured
      // stream before redaction. Adapters without structured events yield
      // null fields; parsing must never invalidate the engineering run.
      let runtimeObservability: RuntimeObservability | null = null;
      try {
        runtimeObservability = extractRuntimeObservability(agent.value.process.stdout, {
          processStartedAt: agent.value.process.startedAt,
          processFinishedAt: agent.value.process.finishedAt,
          totalRunMs: agentExecutionMs,
        });
      } catch {
        runtimeObservability = null;
      }
      const stdoutPath = join(runDirectory, "agent.stdout.log");
      const stderrPath = join(runDirectory, "agent.stderr.log");
      const persistStart = performance.now();
      const stdoutHash = await writeTextArtifact(stdoutPath, agent.value.process.stdout);
      const stderrHash = await writeTextArtifact(stderrPath, agent.value.process.stderr);
      const validationPath = join(runDirectory, "validation.json");
      const patchPath = join(runDirectory, "change.patch");
      const resultPath = join(runDirectory, "result.json");
      artifactPersistenceMs = Math.round(performance.now() - persistStart);
      await input.events.emit("agent_output", {
        runId: attemptId,
        trialId: input.trialId,
        stdout: redactSecrets(agent.value.process.stdout),
        stderr: redactSecrets(agent.value.process.stderr),
      });
      await input.events.emit("agent_process_finished", {
        runId: attemptId,
        trialId: input.trialId,
        exitCode: agent.value.process.exitCode,
        timedOut: agent.value.process.timedOut,
        durationMs: agent.value.process.durationMs,
        phaseDurationMs: agentExecutionMs,
      });

      const providerBlocked = classifyProviderBlock(agent.value.process);
      if (providerBlocked) {
        const runState: LogicalRunState = "provider_blocked";
        await input.events.emit("provider_blocked", {
          runId: attemptId,
          logicalRunId: planEntry.logicalRunId,
          trialId: input.trialId,
          taskId: input.task.id,
          workerCount: input.workerCount,
          repetition: input.repetition,
          exitCode: agent.value.process.exitCode,
          stderr: redactSecrets(agent.value.process.stderr),
        });
        const timings = phaseTimings();
        const run: EngineeringTaskRun = {
          runId: attemptId,
          logicalRunId: planEntry.logicalRunId,
          attemptId,
          runState,
          experimentId: input.experimentId,
          trialId: input.trialId,
          repetition: input.repetition,
          taskId: input.task.id,
          repositoryId: input.task.benchmark?.repositoryId ?? sha256(input.config.repository),
          benchmarkSuiteId: input.task.benchmark?.suiteId ?? null,
          benchmarkSuiteVersion: input.task.benchmark?.suiteVersion ?? null,
          benchmarkTaskClass: input.task.benchmark?.taskClass ?? null,
          baseCommit,
          baseTreeHash,
          workerId: input.workerId,
          workerCount: input.workerCount,
          activeAgentsAtStart,
          activeAgentsAtEnd,
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
          finalCommit: null,
          finalTreeHash: null,
          filesChanged: [],
          commands: [agent.value.process.command],
          testInvocations: [],
          buildInvocations: [],
          tokenUsage: agent.value.tokenUsage,
          providerCost: agent.value.providerCost,
          usage: agent.value.usage,
          validationResult: "not_run",
          integrationResult: "not_requested",
          failureClassification: "provider_blocked",
          accepted: false,
          runtimeObservability,
          artifacts: {
            stdout: relative(input.directory, stdoutPath),
            stdoutSha256: stdoutHash,
            stderr: relative(input.directory, stderrPath),
            stderrSha256: stderrHash,
          },
        };
        await input.ledger.record({
          logicalRunId: planEntry.logicalRunId,
          attemptId,
          state: runState,
          trialId: input.trialId,
          workerCount: input.workerCount,
          repetition: input.repetition,
          taskId: input.task.id,
          attemptedAt: startedAt,
          attemptCount,
        });
        await writeJsonArtifact(resultPath, run);
        await input.events.emit("task_finished", run);
        return run;
      }

      await input.events.emit("validation_started", {
        runId: attemptId,
        trialId: input.trialId,
        commands: input.task.validation,
      });
      const validation = await timePhase(() =>
        validateCommands(input.task.validation, worktree, input.task.timeoutSeconds * 1_000),
      );
      validationMs = validation.durationMs;
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
        runId: attemptId,
        trialId: input.trialId,
        passed: validation.value.passed,
        results: validation.value.results,
        durationMs: validationMs,
      });

      const finalTreeHash = await workingTreeHash(worktree);
      const filesChanged = await changedFiles(worktree);
      const outOfScopeFiles =
        input.task.benchmark === undefined
          ? []
          : filesChanged.filter(
              (file) =>
                !input.task.benchmark?.editableScope.some(
                  (scope) => file === scope || file.startsWith(`${scope}/`),
                ),
            );
      const patch = await stagedPatch(worktree);
      const patchHash = await writeRawTextArtifact(patchPath, patch);
      const finalCommit = await currentCommit(worktree);
      const fileChanges = await collectFileChanges(worktree, input.task.baseCommit, filesChanged);
      const integritySignals = detectIntegritySignals(fileChanges);
      const integritySignalsPath = join(runDirectory, "integrity-signals.json");
      const integritySignalsHash = await writeJsonArtifact(integritySignalsPath, {
        schemaVersion: 1,
        signals: integritySignals,
      });
      await input.events.emit("git_snapshot", {
        runId: attemptId,
        trialId: input.trialId,
        finalCommit,
        finalTreeHash,
        filesChanged,
        patchSha256: patchHash,
        integritySignalCount: integritySignals.length,
        integritySignalKinds: [...new Set(integritySignals.map((signal) => signal.kind))],
      });

      const validationCommands = validation.value.results.map((result) => result.command);
      const commands = [agent.value.process.command, ...validationCommands];
      const groups = commandGroups(validationCommands);
      const outcome = classifyRunOutcome({
        agentTimedOut: agent.value.process.timedOut,
        agentExitCode: agent.value.process.exitCode,
        validationPassed: validation.value.passed,
        validationResults: validation.value.results,
        benchmarkScoped: input.task.benchmark !== undefined,
        outOfScopeFiles,
      });
      const runState: LogicalRunState = outcome.runState;
      const failureClassification = outcome.failureClassification;
      const cleanup = await timePhase(() => input.worktrees.remove(attemptId));
      worktreeCleanupMs = cleanup.durationMs;
      created = false;
      const timings = phaseTimings();
      const run: EngineeringTaskRun = {
        runId: attemptId,
        logicalRunId: planEntry.logicalRunId,
        attemptId,
        runState,
        experimentId: input.experimentId,
        trialId: input.trialId,
        repetition: input.repetition,
        taskId: input.task.id,
        repositoryId: input.task.benchmark?.repositoryId ?? sha256(input.config.repository),
        benchmarkSuiteId: input.task.benchmark?.suiteId ?? null,
        benchmarkSuiteVersion: input.task.benchmark?.suiteVersion ?? null,
        benchmarkTaskClass: input.task.benchmark?.taskClass ?? null,
        baseCommit,
        baseTreeHash,
        workerId: input.workerId,
        workerCount: input.workerCount,
        activeAgentsAtStart,
        activeAgentsAtEnd,
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
        usage: agent.value.usage,
        validationResult: validation.value.passed ? "passed" : "failed",
        integrationResult: "not_requested",
        failureClassification,
        accepted: runState === "accepted",
        runtimeObservability,
        artifacts: {
          stdout: relative(input.directory, stdoutPath),
          stdoutSha256: stdoutHash,
          stderr: relative(input.directory, stderrPath),
          stderrSha256: stderrHash,
          validation: relative(input.directory, validationPath),
          validationSha256: validationHash,
          patch: relative(input.directory, patchPath),
          patchSha256: patchHash,
          integritySignals: relative(input.directory, integritySignalsPath),
          integritySignalsSha256: integritySignalsHash,
        },
      };
      await input.ledger.record({
        logicalRunId: planEntry.logicalRunId,
        attemptId,
        state: runState,
        trialId: input.trialId,
        workerCount: input.workerCount,
        repetition: input.repetition,
        taskId: input.task.id,
        attemptedAt: startedAt,
        attemptCount,
      });
      await writeJsonArtifact(join(runDirectory, "result.json"), run);
      await input.events.emit("task_finished", run);
      return run;
    } finally {
      if (created) {
        const cleanup = await timePhase(() => input.worktrees.remove(attemptId));
        worktreeCleanupMs = cleanup.durationMs;
        created = false;
      }
    }
  } catch (error: unknown) {
    const interrupted = error instanceof Error && error.name === "AbortError";
    const state: LogicalRunState = interrupted ? "interrupted" : "infrastructure_failed";
    await input.ledger.record({
      logicalRunId: planEntry.logicalRunId,
      attemptId,
      state,
      trialId: input.trialId,
      workerCount: input.workerCount,
      repetition: input.repetition,
      taskId: input.task.id,
      attemptedAt: startedAt,
      attemptCount,
    });
    if (interrupted) {
      await input.events.emit("run_interrupted", {
        runId: attemptId,
        logicalRunId: planEntry.logicalRunId,
        trialId: input.trialId,
        taskId: input.task.id,
        workerCount: input.workerCount,
        repetition: input.repetition,
        reason: error instanceof Error ? error.message : String(error),
      });
    } else {
      await input.events.emit("infrastructure_failed", {
        runId: attemptId,
        logicalRunId: planEntry.logicalRunId,
        trialId: input.trialId,
        taskId: input.task.id,
        workerCount: input.workerCount,
        repetition: input.repetition,
        error: error instanceof Error ? error.message : String(error),
        phaseTimings: phaseTimings(),
      });
    }
    await input.events.emit("task_failed", {
      runId: attemptId,
      logicalRunId: planEntry.logicalRunId,
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

function planEntryForRun(input: RunTaskInput): LogicalRunPlanEntry {
  const trialSeed = deriveTrialSeed(input.config.seed, input.repetition);
  const orderedTasks = orderTasks(input.config.tasks, trialSeed);
  return {
    logicalRunId: logicalRunIdFor({
      experimentIdentityHash: input.experimentIdentityHash,
      workerCount: input.workerCount,
      repetition: input.repetition,
      taskId: input.task.id,
      trialSeed,
      agent: input.config.agent,
      agentModel: input.config.agentModel,
      agentVersion: input.agentVersion,
    }),
    trialId: input.trialId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    taskId: input.task.id,
    trialSeed,
    taskOrder: orderedTasks.map((task) => task.id),
  };
}

export function createTelemetryFileSink(path: string): TelemetrySink {
  let closed = false;
  return {
    write: async (sample) => {
      if (closed) return;
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, `${JSON.stringify(sample)}\n`);
    },
    close: async () => {
      closed = true;
    },
  };
}

export async function computeMatrixCompletion(
  experimentDirectory: string,
  plan: ExperimentPlan,
): Promise<MatrixCompletion> {
  const ledger = await createRunLedger(join(experimentDirectory, "logical-runs.jsonl"));
  const expectedLogicalRuns = plan.logicalRuns.length;
  let acceptedRuns = 0;
  let rejectedRuns = 0;
  let timedOutRuns = 0;
  let providerBlockedRuns = 0;
  let infrastructureFailedRuns = 0;
  let interruptedRuns = 0;
  let outstandingRuns = 0;
  const trialIds = new Set(plan.logicalRuns.map((entry) => entry.trialId));
  const completedTrials = new Set<string>();
  const plannedByTrial = new Map<string, number>();
  for (const entry of plan.logicalRuns) {
    plannedByTrial.set(entry.trialId, (plannedByTrial.get(entry.trialId) ?? 0) + 1);
  }
  for (const entry of plan.logicalRuns) {
    const recorded = ledger.get(entry.logicalRunId);
    const state = recorded?.state ?? "pending";
    switch (state) {
      case "accepted":
        acceptedRuns += 1;
        break;
      case "rejected":
        rejectedRuns += 1;
        break;
      case "timed_out":
        timedOutRuns += 1;
        break;
      case "provider_blocked":
        providerBlockedRuns += 1;
        break;
      case "infrastructure_failed":
        infrastructureFailedRuns += 1;
        break;
      case "interrupted":
        interruptedRuns += 1;
        break;
      default:
        outstandingRuns += 1;
    }
  }
  for (const trialId of trialIds) {
    const planned = plannedByTrial.get(trialId) ?? 0;
    let done = 0;
    for (const entry of plan.logicalRuns) {
      if (entry.trialId !== trialId) continue;
      const recorded = ledger.get(entry.logicalRunId);
      const state = recorded?.state ?? "pending";
      if (isTerminalRunState(state)) done += 1;
    }
    if (done === planned) completedTrials.add(trialId);
  }
  const completedLogicalRuns = acceptedRuns + rejectedRuns + timedOutRuns;
  const hasBlocks = providerBlockedRuns > 0 || infrastructureFailedRuns > 0;
  const status: MatrixCompletionStatus =
    completedLogicalRuns === expectedLogicalRuns && expectedLogicalRuns > 0
      ? "completed"
      : interruptedRuns > 0 || outstandingRuns > 0
        ? hasBlocks
          ? "blocked"
          : "incomplete"
        : hasBlocks
          ? "blocked"
          : "completed";
  return {
    schemaVersion: 1,
    expectedLogicalRuns,
    completedLogicalRuns,
    acceptedRuns,
    rejectedRuns,
    timedOutRuns,
    providerBlockedRuns,
    infrastructureFailedRuns,
    interruptedRuns,
    outstandingRuns,
    status,
    completedTrials: completedTrials.size,
    totalTrials: trialIds.size,
  };
}
