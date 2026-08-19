import { access, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { REAL_SCALE_2_CREDENTIALS_MISSING } from "./adapters/auth.js";
import type { AgentAdapter } from "./adapters/types.js";
import { loadTasks } from "./config.js";
import type { DoctorCheck, DoctorCheckStatus, JsonDetails } from "./doctor.js";
import { type FrozenExperiment, frozenSemanticMismatches } from "./frozen.js";
import { currentCommit, repositoryFingerprint, resolveCommit, runGit } from "./git.js";
import {
  computeFrozenIntegrity,
  frozenIntegrityPath,
  integrityDrift,
  loadExpectedIntegrity,
} from "./integrity.js";
import { runProcess } from "./process.js";
import { validateCommands } from "./validation.js";
import { createWorktreeManager } from "./worktree.js";

function check(
  id: DoctorCheck["id"],
  status: DoctorCheckStatus,
  message: string,
  details: JsonDetails = {},
  remediation?: string,
): DoctorCheck {
  return remediation === undefined
    ? { id, status, message, details }
    : { id, status, message, details, remediation };
}

export function nodeMajor(version: string): number | null {
  const match = version.replace(/^v/u, "").match(/^(\d+)/u);
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

export function evaluateNodeRuntime(
  version: string,
  minimumMajor: number,
  pinned?: string,
): DoctorCheck {
  const major = nodeMajor(version);
  if (major === null) {
    return check("NODE_RUNTIME", "BLOCKED", "Unable to parse Node.js version.", { version });
  }
  if (major < minimumMajor) {
    return check(
      "NODE_RUNTIME",
      "BLOCKED",
      `Node.js ${version} does not satisfy >=${minimumMajor}.`,
      { version, major, minimumMajor },
      `Install Node.js ${minimumMajor} or newer.`,
    );
  }
  if (pinned !== undefined && version.replace(/^v/u, "") !== pinned.replace(/^v/u, "")) {
    return check(
      "NODE_RUNTIME",
      "WARNING",
      `Node.js ${version} satisfies >=${minimumMajor} but is not the pinned ${pinned}.`,
      { version, major, minimumMajor, pinned },
    );
  }
  return check("NODE_RUNTIME", "PASS", `Node.js ${version} is available.`, {
    version,
    major,
    minimumMajor,
  });
}

export async function checkNodeRuntime(pinned?: string): Promise<DoctorCheck> {
  return evaluateNodeRuntime(process.version, 22, pinned);
}

export async function checkPnpmRuntime(cwd: string): Promise<DoctorCheck> {
  try {
    const result = await runProcess("pnpm", ["--version"], { cwd, timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      return check(
        "PNPM_RUNTIME",
        "BLOCKED",
        "pnpm is not available.",
        { stderr: result.stderr.trim() },
        "Install pnpm 10.12.1 (see packageManager in package.json).",
      );
    }
    return check("PNPM_RUNTIME", "PASS", `pnpm ${result.stdout.trim()} is available.`, {
      version: result.stdout.trim(),
    });
  } catch (error: unknown) {
    return check(
      "PNPM_RUNTIME",
      "BLOCKED",
      "pnpm is not available.",
      { error: error instanceof Error ? error.message : String(error) },
      "Install pnpm 10.12.1 (see packageManager in package.json).",
    );
  }
}

export async function checkGitRuntime(cwd: string): Promise<DoctorCheck> {
  try {
    const result = await runProcess("git", ["--version"], { cwd, timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      return check(
        "GIT_RUNTIME",
        "BLOCKED",
        "Git is not available.",
        { stderr: result.stderr.trim() },
        "Install Git and ensure it is on PATH.",
      );
    }
    return check("GIT_RUNTIME", "PASS", result.stdout.trim() || "Git is available.", {
      version: result.stdout.trim(),
    });
  } catch (error: unknown) {
    return check(
      "GIT_RUNTIME",
      "BLOCKED",
      "Git is not available.",
      { error: error instanceof Error ? error.message : String(error) },
      "Install Git and ensure it is on PATH.",
    );
  }
}

export async function checkRepositoryState(
  repository: string | null,
  requireClean: boolean,
): Promise<DoctorCheck> {
  if (repository === null) {
    return check(
      "REPOSITORY_STATE",
      "WARNING",
      "No target repository was provided.",
      { repository: null },
      "Pass --repo or a frozen experiment that can create ledger-kit.",
    );
  }
  try {
    await access(repository);
  } catch {
    return check(
      "REPOSITORY_STATE",
      "BLOCKED",
      "Target repository does not exist.",
      { repository },
      "Create the target Git repository before running the experiment.",
    );
  }
  const inside = await runGit(repository, ["rev-parse", "--is-inside-work-tree"], {
    allowFailure: true,
  });
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return check(
      "REPOSITORY_STATE",
      "BLOCKED",
      "Target is not a Git repository.",
      { repository },
      "Initialize a Git repository at the target path.",
    );
  }
  const status = await runGit(repository, ["status", "--porcelain"]);
  const dirty = status.stdout.trim().length > 0;
  if (requireClean && dirty) {
    return check(
      "REPOSITORY_STATE",
      "BLOCKED",
      "Target repository is dirty; a clean baseline is required.",
      { repository, dirty: true },
      "Commit or restore uncommitted files in the target repository.",
    );
  }
  let baseCommit: string | null = null;
  try {
    baseCommit = await resolveCommit(repository, "HEAD");
  } catch (error: unknown) {
    return check("REPOSITORY_STATE", "BLOCKED", "Base commit could not be resolved.", {
      repository,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return check("REPOSITORY_STATE", "PASS", "Target Git repository is usable.", {
    repository,
    dirty,
    baseCommit,
  });
}

export async function checkWorktreeState(repository: string | null): Promise<DoctorCheck> {
  if (repository === null) {
    return check("WORKTREE_STATE", "WARNING", "Skipping worktree probe; no target repository.", {
      repository: null,
    });
  }
  const listed = await runGit(repository, ["worktree", "list", "--porcelain"], {
    allowFailure: true,
  });
  const leaked = listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => path.includes(`${sep}.worktrees${sep}`) || path.endsWith(`${sep}.worktrees`));
  if (leaked.length > 0) {
    return check(
      "WORKTREE_STATE",
      "BLOCKED",
      "Leaked Rapture-managed worktrees exist for the target repository.",
      { leaked: leaked.slice(0, 20) },
      "Remove leftover Git worktrees under .worktrees and run git worktree prune.",
    );
  }
  const probeRoot = join(tmpdir(), `rapture-doctor-worktrees-${process.pid}`);
  const manager = await createWorktreeManager(repository, probeRoot);
  try {
    const commit = await resolveCommit(repository, "HEAD");
    await manager.create("doctor-probe", commit);
    await manager.remove("doctor-probe");
  } catch (error: unknown) {
    return check("WORKTREE_STATE", "BLOCKED", "Worktree create/remove is not functional.", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
    await runGit(repository, ["worktree", "prune"], { allowFailure: true });
  }
  return check("WORKTREE_STATE", "PASS", "Worktree create and remove succeeded.", {
    leaked: [],
  });
}

export function evaluateExperimentConfig(
  frozen: FrozenExperiment | null,
  taskFile: string | null,
): DoctorCheck {
  if (frozen === null) {
    return check(
      "EXPERIMENT_CONFIG",
      "WARNING",
      "No experiment configuration was provided.",
      { config: null },
      "Pass --config experiments/real-scale-2.frozen.json for the frozen Codex study.",
    );
  }
  if (taskFile === null) {
    return check("EXPERIMENT_CONFIG", "BLOCKED", "Configured task file is missing.", {
      taskFile: frozen.configuration.taskFile,
    });
  }
  const mismatches = frozenSemanticMismatches(frozen);
  if (mismatches.length > 0) {
    return check(
      "EXPERIMENT_CONFIG",
      "BLOCKED",
      `Frozen experiment semantics drifted: ${mismatches.join(", ")}.`,
      {
        experiment: frozen.experimentName,
        mismatches: [...mismatches],
        workerCounts: [...frozen.configuration.workerCounts],
        repetitions: frozen.configuration.repetitions,
        seed: frozen.configuration.seed,
        agent: frozen.configuration.agent,
      },
      "Restore experiments/real-scale-2.frozen.json to the frozen 1-vs-2 × 3 Codex configuration.",
    );
  }
  return check("EXPERIMENT_CONFIG", "PASS", "Experiment configuration is valid.", {
    experiment: frozen.experimentName,
    agent: frozen.configuration.agent,
    workerCounts: [...frozen.configuration.workerCounts],
    repetitions: frozen.configuration.repetitions,
    seed: frozen.configuration.seed,
    taskFile: frozen.configuration.taskFile,
    integration: frozen.configuration.integration,
  });
}

export async function checkTaskIntegrity(
  taskFile: string | null,
  expectedTaskIds: readonly string[] | null,
): Promise<DoctorCheck> {
  if (taskFile === null) {
    return check("TASK_INTEGRITY", "WARNING", "No task file was provided.", { taskFile: null });
  }
  try {
    await access(taskFile);
  } catch {
    return check("TASK_INTEGRITY", "BLOCKED", "Task file does not exist.", { taskFile });
  }
  try {
    const tasks = await loadTasks(taskFile);
    const ids = tasks.map((task) => task.id);
    const missingExpected =
      expectedTaskIds === null ? [] : expectedTaskIds.filter((id) => !ids.includes(id));
    const dependent = tasks.filter((task) => !task.independent || task.dependsOn.length > 0);
    if (missingExpected.length > 0) {
      return check(
        "TASK_INTEGRITY",
        "BLOCKED",
        "Configured task IDs are missing from the task file.",
        { missingExpected: [...missingExpected], ids },
      );
    }
    if (dependent.length > 0) {
      return check(
        "TASK_INTEGRITY",
        "BLOCKED",
        "V0 requires independent tasks; dependency assumptions are violated.",
        { dependent: dependent.map((task) => task.id) },
      );
    }
    const missingValidators: string[] = [];
    for (const task of tasks) {
      for (const command of task.validation) {
        const tokens = command
          .split(/\s+/u)
          .filter((token) => token.includes("/") || token.endsWith(".ts"));
        for (const token of tokens) {
          if (token.startsWith("-")) continue;
          try {
            await access(token);
          } catch {
            missingValidators.push(token);
          }
        }
      }
    }
    if (missingValidators.length > 0) {
      return check(
        "TASK_INTEGRITY",
        "BLOCKED",
        "One or more deterministic validators are missing.",
        {
          missingValidators,
        },
      );
    }
    return check("TASK_INTEGRITY", "PASS", `${tasks.length} task definition(s) validated.`, {
      ids,
      taskFile,
    });
  } catch (error: unknown) {
    return check("TASK_INTEGRITY", "BLOCKED", "Task definitions failed validation.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createLedgerKitCopy(
  workspaceRoot: string,
  destination: string,
): Promise<DoctorCheck | null> {
  const generator = join(workspaceRoot, "fixtures/ledger-kit/create.mjs");
  try {
    await access(generator);
  } catch {
    return check("FIXTURE_INTEGRITY", "BLOCKED", "ledger-kit fixture generator is missing.", {
      generator,
    });
  }
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  const created = await runProcess(process.execPath, [generator, destination], {
    cwd: workspaceRoot,
    timeoutMs: 30_000,
  });
  if (created.exitCode !== 0) {
    return check("FIXTURE_INTEGRITY", "BLOCKED", "ledger-kit fixture could not be created.", {
      generator,
      stderr: created.stderr.trim(),
    });
  }
  return null;
}

export async function checkFixtureIntegrity(
  workspaceRoot: string,
  repository: string,
): Promise<DoctorCheck> {
  const generator = join(workspaceRoot, "fixtures/ledger-kit/create.mjs");
  try {
    const taskFile = join(workspaceRoot, "fixtures/ledger-kit/tasks.json");
    const tasks = await loadTasks(taskFile);
    const rejected: string[] = [];
    const unexpectedPass: string[] = [];
    for (const task of tasks) {
      const outcome = await validateCommands(task.validation, repository, 20_000);
      if (outcome.passed) unexpectedPass.push(task.id);
      else rejected.push(task.id);
    }
    if (unexpectedPass.length > 0) {
      return check(
        "FIXTURE_INTEGRITY",
        "BLOCKED",
        "Baseline validators accepted the incomplete ledger-kit fixture.",
        { unexpectedPass },
      );
    }
    const commit = await currentCommit(repository);
    const fingerprint = commit === null ? null : await repositoryFingerprint(repository, commit);
    return check(
      "FIXTURE_INTEGRITY",
      "PASS",
      "ledger-kit baseline is rejected by all validators.",
      {
        generator,
        rejected,
        repositoryFingerprint: fingerprint,
        baseCommit: commit,
      },
    );
  } catch (error: unknown) {
    return check("FIXTURE_INTEGRITY", "BLOCKED", "Fixture integrity probe failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkAgentBinary(adapter: AgentAdapter | null): Promise<DoctorCheck> {
  if (adapter === null) {
    return check("AGENT_BINARY", "WARNING", "No coding-agent adapter was selected.", {
      agent: null,
    });
  }
  const availability = await adapter.isAvailable();
  const version = await adapter.version();
  if (!availability.available) {
    return check(
      "AGENT_BINARY",
      "BLOCKED",
      `Configured coding-agent binary is not available (${adapter.name()}).`,
      { binary: adapter.name(), detail: availability.detail, version },
      adapter.name() === "codex"
        ? "Install the pinned Codex CLI (@openai/codex@0.147.0) on PATH."
        : adapter.name() === "opencode"
          ? "Install OpenCode (e.g. `curl -fsSL https://opencode.ai/install | bash` or `npm i -g opencode-ai`) and put `opencode` on PATH."
          : "Install the configured agent binary.",
    );
  }
  return check("AGENT_BINARY", "PASS", `${adapter.name()} is available.`, {
    binary: adapter.name(),
    version,
    detail: availability.detail,
  });
}

export async function checkAgentAuth(
  adapter: AgentAdapter | null,
  env: Readonly<Record<string, string | undefined>>,
): Promise<DoctorCheck> {
  if (adapter === null) {
    return check("AGENT_AUTH", "WARNING", "No coding-agent adapter was selected.", { agent: null });
  }
  const probe = await adapter.probeCredentials(env);
  if (!probe.required) {
    return check("AGENT_AUTH", "PASS", `${adapter.name()} does not require provider credentials.`, {
      agent: adapter.name(),
      required: false,
      present: true,
      supportedEnvVars: [...probe.supportedEnvVars],
    });
  }
  if (!probe.present) {
    return check(
      "AGENT_AUTH",
      "BLOCKED",
      "No supported Codex/OpenAI credential is available.",
      {
        code: REAL_SCALE_2_CREDENTIALS_MISSING,
        agent: adapter.name(),
        required: true,
        present: false,
        envVar: null,
        method: null,
        supportedEnvVars: [...probe.supportedEnvVars],
      },
      "Run `codex login` and complete ChatGPT sign-in, or configure OPENAI_API_KEY, CODEX_API_KEY, or CODEX_ACCESS_TOKEN.",
    );
  }
  return check("AGENT_AUTH", "PASS", "A supported credential mechanism is present.", {
    agent: adapter.name(),
    required: true,
    present: true,
    envVar: probe.envVar,
    method: probe.method,
    supportedEnvVars: [...probe.supportedEnvVars],
  });
}

export function checkModelConfig(
  agent: "fake" | "codex" | "opencode" | null,
  model: string | null,
): DoctorCheck {
  if (agent === null) {
    return check("MODEL_CONFIG", "WARNING", "No agent was selected; model is not pinned.", {
      model: null,
      reasoning: null,
    });
  }
  if (agent === "fake") {
    return check("MODEL_CONFIG", "PASS", "Fake adapter does not use a provider model.", {
      agent,
      modelPinned: false,
      model: null,
      reasoningPinned: false,
      reasoning: null,
      usesProviderDefault: false,
    });
  }
  if (model !== null && model.trim() !== "") {
    return check("MODEL_CONFIG", "PASS", `Model is pinned to ${model}.`, {
      agent,
      modelPinned: true,
      model,
      reasoningPinned: false,
      reasoning: null,
      usesProviderDefault: false,
    });
  }
  return check(
    "MODEL_CONFIG",
    "WARNING",
    "Model is not pinned; the agent adapter will use the provider default. Reasoning is also not pinned.",
    {
      agent,
      modelPinned: false,
      model: null,
      reasoningPinned: false,
      reasoning: null,
      usesProviderDefault: true,
    },
  );
}

const prohibitedOutputPrefixes = ["/etc", "/usr", "/bin", "/sbin"];

export async function checkOutputPath(outputDirectory: string | null): Promise<DoctorCheck> {
  if (outputDirectory === null) {
    return check("OUTPUT_PATH", "WARNING", "No experiment output directory was provided.", {
      outputDirectory: null,
    });
  }
  const resolved = resolve(outputDirectory);
  const codexHome = resolve(homedir(), ".codex");
  if (resolved === parse(resolved).root) {
    return check("OUTPUT_PATH", "BLOCKED", "Output path must not be the filesystem root.", {
      outputDirectory: resolved,
    });
  }
  if (resolved === codexHome || resolved.startsWith(`${codexHome}${sep}`)) {
    return check(
      "OUTPUT_PATH",
      "BLOCKED",
      "Output path must not overlap the Codex home directory.",
      { outputDirectory: resolved },
    );
  }
  for (const prefix of prohibitedOutputPrefixes) {
    if (resolved === prefix || resolved.startsWith(`${prefix}${sep}`)) {
      return check("OUTPUT_PATH", "BLOCKED", "Output path is not a safe artifact location.", {
        outputDirectory: resolved,
        prefix,
      });
    }
  }
  try {
    await mkdir(resolved, { recursive: true });
    await access(resolved);
  } catch (error: unknown) {
    return check("OUTPUT_PATH", "BLOCKED", "Experiment output directory cannot be created.", {
      outputDirectory: resolved,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return check("OUTPUT_PATH", "PASS", "Experiment output directory is writable.", {
    outputDirectory: resolved,
  });
}

export async function checkFrozenIntegrity(
  workspaceRoot: string,
  experimentName = "real-scale-2",
): Promise<DoctorCheck> {
  const actual = await computeFrozenIntegrity(workspaceRoot, experimentName);
  const expected = await loadExpectedIntegrity(workspaceRoot, experimentName);
  if (expected === null) {
    return check(
      "EXPERIMENT_CONFIG",
      "WARNING",
      `Frozen integrity sidecar is missing (${frozenIntegrityPath(experimentName)}).`,
      { actual: actual.aggregateSha256 },
    );
  }
  const drifted = integrityDrift(expected, actual);
  if (drifted.length > 0 || expected.aggregateSha256 !== actual.aggregateSha256) {
    return check(
      "EXPERIMENT_CONFIG",
      "BLOCKED",
      "Frozen experiment inputs have drifted from the recorded integrity hashes.",
      {
        expectedAggregate: expected.aggregateSha256,
        actualAggregate: actual.aggregateSha256,
        drifted: [...drifted],
      },
      "Restore the frozen config, ledger-kit tasks, validators, and baseline sources, or update the integrity sidecar only after an intentional freeze.",
    );
  }
  return check("EXPERIMENT_CONFIG", "PASS", "Frozen experiment inputs match recorded hashes.", {
    aggregateSha256: actual.aggregateSha256,
    fileCount: Object.keys(actual.files).length,
  });
}
