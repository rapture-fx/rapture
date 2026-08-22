import { mkdir, writeFile } from "node:fs/promises";
import { cpus, type as osType, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { credentialValuesForLeakCheck } from "./adapters/auth.js";
import { codexAgentAdapter } from "./adapters/codex.js";
import { fakeAgentAdapter } from "./adapters/fake.js";
import { opencodeAgentAdapter } from "./adapters/opencode.js";
import type { AgentAdapter } from "./adapters/types.js";
import { sha256 } from "./artifacts.js";
import {
  checkAgentAuth,
  checkAgentBinary,
  checkFixtureIntegrity,
  checkFrozenIntegrity,
  checkGitRuntime,
  checkModelConfig,
  checkNodeRuntime,
  checkOutputPath,
  checkPnpmRuntime,
  checkPricingConfig,
  checkRepositoryState,
  checkTaskIntegrity,
  checkWorktreeState,
  createLedgerKitCopy,
  evaluateExperimentConfig,
} from "./doctor-checks.js";
import { loadPricingContext } from "./economics.js";
import {
  type FrozenExperiment,
  isLedgerKitExperiment,
  loadFrozenExperiment,
  REAL_SCALE_2_EXPECTED,
} from "./frozen.js";
import { runGit } from "./git.js";
import { computeFrozenIntegrity } from "./integrity.js";
import type { JsonValue } from "./models.js";
import { runProcess } from "./process.js";

export const doctorCheckIds = [
  "NODE_RUNTIME",
  "PNPM_RUNTIME",
  "GIT_RUNTIME",
  "REPOSITORY_STATE",
  "WORKTREE_STATE",
  "EXPERIMENT_CONFIG",
  "TASK_INTEGRITY",
  "FIXTURE_INTEGRITY",
  "AGENT_BINARY",
  "AGENT_AUTH",
  "MODEL_CONFIG",
  "PRICING_CONFIG",
  "OUTPUT_PATH",
] as const;

export type DoctorCheckId = (typeof doctorCheckIds)[number];
export type DoctorCheckStatus = "PASS" | "BLOCKED" | "WARNING";
export type DoctorStatus = "READY" | "BLOCKED" | "WARNING";
export type JsonDetails = { readonly [key: string]: JsonValue };

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly details: JsonDetails;
  readonly remediation?: string;
}

export interface RunnerFingerprint {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly runnerOs: string;
  readonly runnerArchitecture: string;
  readonly cpuCount: number;
  readonly cpuModel: string | null;
  readonly memoryBytes: number | null;
  readonly kernel: string;
  readonly nodeVersion: string;
  readonly pnpmVersion: string | null;
  readonly gitVersion: string | null;
  readonly raptureCommit: string | null;
  readonly codexBinaryVersion: string | null;
  readonly modelConfiguration: string | null;
  readonly reasoningConfiguration: string | null;
  readonly githubRunId: string | null;
  readonly githubRunnerImage: string | null;
  readonly githubImageVersion: string | null;
}

export interface DoctorResult {
  readonly schemaVersion: 1;
  readonly status: DoctorStatus;
  readonly experiment: string | null;
  readonly agent: "fake" | "codex" | "opencode" | null;
  readonly checks: readonly DoctorCheck[];
  readonly integrity: Awaited<ReturnType<typeof computeFrozenIntegrity>> | null;
  readonly runnerFingerprint: RunnerFingerprint;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly scalingConclusion: null;
}

export class DoctorError extends Error {
  public override readonly name = "DoctorError";
  public readonly exitCode: 2 | 3 | 4;
  public constructor(exitCode: 2 | 3 | 4, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

export const doctorCheckSchema = z.object({
  id: z.enum(doctorCheckIds),
  status: z.enum(["PASS", "BLOCKED", "WARNING"]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
  remediation: z.string().optional(),
});

export const doctorResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["READY", "BLOCKED", "WARNING"]),
  experiment: z.string().nullable(),
  agent: z.enum(["fake", "codex", "opencode"]).nullable(),
  checks: z.array(doctorCheckSchema),
  integrity: z.unknown().nullable(),
  runnerFingerprint: z.object({
    schemaVersion: z.literal(1),
    timestamp: z.string(),
    runnerOs: z.string(),
    runnerArchitecture: z.string(),
    cpuCount: z.number(),
    cpuModel: z.string().nullable(),
    memoryBytes: z.number().nullable(),
    kernel: z.string(),
    nodeVersion: z.string(),
    pnpmVersion: z.string().nullable(),
    gitVersion: z.string().nullable(),
    raptureCommit: z.string().nullable(),
    codexBinaryVersion: z.string().nullable(),
    modelConfiguration: z.string().nullable(),
    reasoningConfiguration: z.string().nullable(),
    githubRunId: z.string().nullable(),
    githubRunnerImage: z.string().nullable(),
    githubImageVersion: z.string().nullable(),
  }),
  startedAt: z.string(),
  finishedAt: z.string(),
  scalingConclusion: z.null(),
});

export function aggregateDoctorStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((item) => item.status === "BLOCKED")) return "BLOCKED";
  if (checks.some((item) => item.status === "WARNING")) return "WARNING";
  return "READY";
}

export function doctorExitCode(status: DoctorStatus): 0 | 2 {
  return status === "BLOCKED" ? 2 : 0;
}

export function preflightOnlyAllowsSuccess(result: DoctorResult): boolean {
  const blocked = result.checks.filter((item) => item.status === "BLOCKED").map((item) => item.id);
  if (blocked.length === 0) return true;
  return blocked.every((id) => id === "AGENT_AUTH");
}

export type AgentName = "fake" | "codex" | "opencode";

export function adapterFor(agent: AgentName): AgentAdapter {
  if (agent === "fake") return fakeAgentAdapter;
  if (agent === "opencode") return opencodeAgentAdapter;
  return codexAgentAdapter;
}

export interface DoctorOptions {
  readonly workspaceRoot: string;
  readonly repository?: string;
  readonly taskFile?: string;
  readonly outputDirectory?: string;
  readonly agent?: AgentName;
  readonly agentModel?: string | null;
  readonly configPath?: string;
  readonly pricingPath?: string;
  readonly pricing?: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly adapter?: AgentAdapter;
  readonly requireCleanRepository?: boolean;
}

async function commandVersion(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string | null> {
  try {
    const result = await runProcess(command, args, { cwd, timeoutMs: 10_000 });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim() || result.stderr.trim() || null;
  } catch {
    return null;
  }
}

export async function collectRunnerFingerprint(input: {
  readonly workspaceRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly model: string | null;
  readonly adapter: AgentAdapter | null;
}): Promise<RunnerFingerprint> {
  const cpuModel = cpus()[0]?.model ?? null;
  const git = await commandVersion("git", ["--version"], input.workspaceRoot);
  const pnpm = await commandVersion("pnpm", ["--version"], input.workspaceRoot);
  const commit = await runGit(input.workspaceRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const image =
    input.env.ImageOS !== undefined && input.env.ImageVersion !== undefined
      ? `${input.env.ImageOS}-${input.env.ImageVersion}`
      : (input.env.ImageOS ?? null);
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runnerOs: input.env.RUNNER_OS ?? platform(),
    runnerArchitecture: input.env.RUNNER_ARCH ?? process.arch,
    cpuCount: cpus().length,
    cpuModel,
    memoryBytes: totalmem(),
    kernel: `${osType()} ${release()}`,
    nodeVersion: process.version,
    pnpmVersion: pnpm,
    gitVersion: git,
    raptureCommit: commit.exitCode === 0 ? commit.stdout.trim() : null,
    codexBinaryVersion: input.adapter === null ? null : await input.adapter.version(),
    modelConfiguration: input.model,
    reasoningConfiguration: null,
    githubRunId: input.env.GITHUB_RUN_ID ?? null,
    githubRunnerImage: image,
    githubImageVersion: input.env.ImageVersion ?? null,
  };
}

function assertNoSecrets(
  serialized: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  for (const value of credentialValuesForLeakCheck(env)) {
    if (serialized.includes(value)) {
      throw new DoctorError(4, "doctor output contained a credential value and was discarded");
    }
  }
}

export async function persistDoctorArtifacts(
  directory: string,
  result: DoctorResult,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly doctorPath: string; readonly fingerprintPath: string }> {
  const resolved = resolve(directory);
  await mkdir(resolved, { recursive: true });
  const doctorPath = join(resolved, "doctor.json");
  const fingerprintPath = join(resolved, "runner-fingerprint.json");
  const doctorJson = `${JSON.stringify(result, null, 2)}\n`;
  const fingerprintJson = `${JSON.stringify(result.runnerFingerprint, null, 2)}\n`;
  assertNoSecrets(doctorJson, env);
  assertNoSecrets(fingerprintJson, env);
  await writeFile(doctorPath, doctorJson, "utf8");
  await writeFile(fingerprintPath, fingerprintJson, "utf8");
  return { doctorPath, fingerprintPath };
}

export function formatDoctor(result: DoctorResult): string {
  const lines = [
    `Rapture doctor ${result.status}${result.experiment === null ? "" : ` (${result.experiment})`}`,
    "This is an environment diagnostic. It is not a coding-agent scaling result.",
  ];
  for (const item of result.checks) {
    lines.push(`${item.id.padEnd(20)} ${item.status.padEnd(8)} ${item.message}`);
    if (item.remediation !== undefined) {
      lines.push(`  remediation: ${item.remediation}`);
    }
  }
  return lines.join("\n");
}

export function formatDoctorGitHubSummary(result: DoctorResult): string {
  const lines = [
    `## Rapture doctor: ${result.status}`,
    "",
    result.experiment === null ? "" : `Experiment: \`${result.experiment}\``,
    "",
    "This output is infrastructure preflight. It is not throughput, speedup, or efficiency evidence.",
    "",
    "| Check | Status | Message |",
    "| --- | --- | --- |",
  ];
  for (const item of result.checks) {
    lines.push(`| ${item.id} | ${item.status} | ${item.message.replaceAll("|", "\\|")} |`);
  }
  const auth = result.checks.find((item) => item.id === "AGENT_AUTH");
  if (auth?.details.code === "REAL_SCALE_2_CREDENTIALS_MISSING") {
    lines.push("", `\`${String(auth.details.code)}\``);
  }
  return lines.filter((line) => line !== undefined).join("\n");
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const startedAt = new Date().toISOString();
  const env = options.env ?? process.env;
  const workspaceRoot = resolve(options.workspaceRoot);
  let frozen: FrozenExperiment | null = null;
  if (options.configPath !== undefined) {
    frozen = await loadFrozenExperiment(options.configPath);
  }
  const agent = options.agent ?? frozen?.configuration.agent ?? null;
  const agentModel =
    options.agentModel === undefined
      ? (frozen?.configuration.agentModel ?? null)
      : options.agentModel;
  const adapter = options.adapter ?? (agent === null ? null : adapterFor(agent));
  const taskFile = resolve(workspaceRoot, options.taskFile ?? frozen?.configuration.taskFile ?? "");
  const hasTaskFile =
    options.taskFile !== undefined || frozen?.configuration.taskFile !== undefined;
  const outputDirectory = options.outputDirectory === undefined ? null : options.outputDirectory;
  const userRepository = options.repository === undefined ? null : resolve(options.repository);
  const requireClean = options.requireCleanRepository ?? true;
  const fixtureDestination = join(
    tmpdir(),
    `rapture-doctor-ledger-${sha256(`${process.pid}:${startedAt}`).slice(0, 12)}`,
  );
  const checks: DoctorCheck[] = [];
  let repository = userRepository;
  let createdFixture = false;
  try {
    checks.push(await checkNodeRuntime("22.14.0"));
    checks.push(await checkPnpmRuntime(workspaceRoot));
    checks.push(await checkGitRuntime(workspaceRoot));

    let configCheck = evaluateExperimentConfig(frozen, hasTaskFile ? taskFile : null);
    if (
      configCheck.status === "PASS" &&
      frozen !== null &&
      isLedgerKitExperiment(frozen.experimentName)
    ) {
      const integrityCheck = await checkFrozenIntegrity(workspaceRoot, frozen.experimentName);
      if (integrityCheck.status !== "PASS") configCheck = integrityCheck;
      else {
        configCheck = {
          ...configCheck,
          details: { ...configCheck.details, ...integrityCheck.details },
        };
      }
    }
    checks.push(configCheck);

    checks.push(
      await checkTaskIntegrity(
        hasTaskFile ? taskFile : null,
        frozen?.configuration.taskIds ??
          (frozen !== null && isLedgerKitExperiment(frozen.experimentName)
            ? REAL_SCALE_2_EXPECTED.taskIds
            : null),
      ),
    );

    const needsFixture =
      (frozen !== null && isLedgerKitExperiment(frozen.experimentName)) ||
      (hasTaskFile && taskFile.endsWith("fixtures/ledger-kit/tasks.json"));
    if (needsFixture) {
      const createError = await createLedgerKitCopy(workspaceRoot, fixtureDestination);
      if (createError !== null) checks.push(createError);
      else {
        createdFixture = true;
        checks.push(await checkFixtureIntegrity(workspaceRoot, fixtureDestination));
        if (repository === null) repository = fixtureDestination;
      }
    } else {
      checks.push({
        id: "FIXTURE_INTEGRITY",
        status: "PASS",
        message: "ledger-kit fixture probe is not required for this experiment.",
        details: { skipped: true },
      });
    }

    checks.push(await checkRepositoryState(repository, requireClean));
    checks.push(await checkWorktreeState(repository));
    checks.push(await checkAgentBinary(adapter));
    checks.push(await checkAgentAuth(adapter, env));
    checks.push(checkModelConfig(agent, agentModel));
    let pricing: unknown = options.pricing ?? null;
    if (pricing === null && options.pricingPath !== undefined) {
      pricing = await loadPricingContext(options.pricingPath);
    }
    checks.push(checkPricingConfig(pricing, { agentProvider: agent, agentModel }));
    checks.push(await checkOutputPath(outputDirectory));
  } catch (error: unknown) {
    throw new DoctorError(
      4,
      `doctor internal failure: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (createdFixture) {
      const { rm } = await import("node:fs/promises");
      await rm(fixtureDestination, { recursive: true, force: true });
    }
  }

  const integrity =
    frozen !== null && isLedgerKitExperiment(frozen.experimentName)
      ? await computeFrozenIntegrity(workspaceRoot, frozen.experimentName)
      : null;
  const runnerFingerprint = await collectRunnerFingerprint({
    workspaceRoot,
    env,
    model: agentModel,
    adapter,
  });
  const result: DoctorResult = {
    schemaVersion: 1,
    status: aggregateDoctorStatus(checks),
    experiment: frozen?.experimentName ?? null,
    agent,
    checks,
    integrity,
    runnerFingerprint,
    startedAt,
    finishedAt: new Date().toISOString(),
    scalingConclusion: null,
  };
  assertNoSecrets(JSON.stringify(result), env);
  return result;
}

export { REAL_SCALE_2_CREDENTIALS_MISSING } from "./adapters/auth.js";
export { evaluateNodeRuntime, nodeMajor } from "./doctor-checks.js";
