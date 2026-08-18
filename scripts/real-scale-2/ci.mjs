#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FROZEN_PATH = join(REPO_ROOT, "experiments/real-scale-2.frozen.json");
export const TASK_FILE = "fixtures/ledger-kit/tasks.json";
export const OUTPUT_DIRECTORY = "experiments/real-scale-2";
export const FINGERPRINT_NAME = "runner-fingerprint.json";

export const PINNED = Object.freeze({
  runnerImage: "ubuntu-24.04",
  node: "22.14.0",
  pnpm: "10.12.1",
  codexPackage: "@openai/codex@0.147.0",
});

export const EXPECTED_FROZEN_CONFIGURATION = Object.freeze({
  agent: "codex",
  workerCounts: [1, 2],
  repetitions: 3,
  seed: 20260817,
  taskFile: TASK_FILE,
  taskCount: 6,
  timeoutSecondsPerTask: 180,
  integration: false,
});

const SANITIZED_CHILD_ENV_KEYS = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_RESULTS_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
]);

export function nonemptySecret(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function resolveCredentials(env) {
  const openai = nonemptySecret(env.OPENAI_API_KEY);
  if (openai !== null) {
    return { present: true, method: "api-key", envVar: "OPENAI_API_KEY", value: openai };
  }
  const codexKey = nonemptySecret(env.CODEX_API_KEY);
  if (codexKey !== null) {
    return { present: true, method: "api-key", envVar: "CODEX_API_KEY", value: codexKey };
  }
  const accessToken = nonemptySecret(env.CODEX_ACCESS_TOKEN);
  if (accessToken !== null) {
    return {
      present: true,
      method: "access-token",
      envVar: "CODEX_ACCESS_TOKEN",
      value: accessToken,
    };
  }
  return { present: false, method: null, envVar: null, value: null };
}

export function missingCredentialMessage() {
  return [
    "REAL_SCALE_2_CREDENTIALS_MISSING",
    "The frozen Codex 1-vs-2 experiment requires an authenticated Codex CLI.",
    "Set a repository or GitHub Environment secret on `real-scale-2` before running this workflow:",
    "  OPENAI_API_KEY or CODEX_API_KEY (API key), or CODEX_ACCESS_TOKEN (ChatGPT access token).",
    "Refusing to execute. This path never falls back to --agent fake.",
  ].join("\n");
}

export function fakeAgentRefusalMessage() {
  return [
    "REAL_SCALE_2_FAKE_AGENT_REFUSED",
    "The frozen experiment agent must be Codex.",
    "Refusing to execute fake workers as a substitute for missing credentials.",
  ].join("\n");
}

export class CiError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "CiError";
    this.code = code;
  }
}

export function assertCodexCredentials(env) {
  const credentials = resolveCredentials(env);
  if (!credentials.present) {
    throw new CiError("REAL_SCALE_2_CREDENTIALS_MISSING", missingCredentialMessage());
  }
  return credentials;
}

/**
 * @param {unknown} frozen
 * @returns {asserts frozen is {
 *   configuration: {
 *     agent: string,
 *     workerCounts: number[],
 *     repetitions: number,
 *     seed: number,
 *     taskFile: string,
 *     taskCount: number,
 *     timeoutSecondsPerTask: number,
 *     integration: boolean,
 *   }
 * }}
 */
export function assertFrozenCodexExperiment(frozen) {
  if (typeof frozen !== "object" || frozen === null || !("configuration" in frozen)) {
    throw new CiError(
      "REAL_SCALE_2_FROZEN_INVALID",
      "frozen experiment JSON is missing configuration",
    );
  }
  const configuration = frozen.configuration;
  if (typeof configuration !== "object" || configuration === null) {
    throw new CiError("REAL_SCALE_2_FROZEN_INVALID", "frozen experiment configuration is invalid");
  }
  if (configuration.agent !== "codex") {
    throw new CiError("REAL_SCALE_2_FAKE_AGENT_REFUSED", fakeAgentRefusalMessage());
  }
  const expected = EXPECTED_FROZEN_CONFIGURATION;
  const mismatches = [];
  if (JSON.stringify(configuration.workerCounts) !== JSON.stringify(expected.workerCounts)) {
    mismatches.push("workerCounts");
  }
  if (configuration.repetitions !== expected.repetitions) mismatches.push("repetitions");
  if (configuration.seed !== expected.seed) mismatches.push("seed");
  if (configuration.taskFile !== expected.taskFile) mismatches.push("taskFile");
  if (configuration.taskCount !== expected.taskCount) mismatches.push("taskCount");
  if (configuration.timeoutSecondsPerTask !== expected.timeoutSecondsPerTask) {
    mismatches.push("timeoutSecondsPerTask");
  }
  if (configuration.integration !== expected.integration) mismatches.push("integration");
  if (mismatches.length > 0) {
    throw new CiError(
      "REAL_SCALE_2_FROZEN_DRIFT",
      `frozen experiment semantics drifted: ${mismatches.join(", ")}`,
    );
  }
}

export function buildRaptureArgv(frozen, repo, output) {
  assertFrozenCodexExperiment(frozen);
  if (repo.trim() === "" || output.trim() === "") {
    throw new CiError("REAL_SCALE_2_PATHS", "repository and output paths are required");
  }
  const argv = [
    "run",
    "--repo",
    repo,
    "--tasks",
    frozen.configuration.taskFile,
    "--workers",
    frozen.configuration.workerCounts.join(","),
    "--repetitions",
    String(frozen.configuration.repetitions),
    "--seed",
    String(frozen.configuration.seed),
    "--agent",
    "codex",
  ];
  const model = frozen.configuration.agentModel;
  if (typeof model === "string" && model.trim() !== "") {
    argv.push("--agent-model", model);
  }
  argv.push("--output", output);
  if (argv.includes("fake") || argv.includes("--agent-fake")) {
    throw new CiError("REAL_SCALE_2_FAKE_AGENT_REFUSED", fakeAgentRefusalMessage());
  }
  return argv;
}

export function loginArgs(method) {
  if (method === "access-token") return ["login", "--with-access-token"];
  if (method === "api-key") return ["login", "--with-api-key"];
  throw new CiError("REAL_SCALE_2_CREDENTIALS_MISSING", missingCredentialMessage());
}

export function raptureChildEnv(env) {
  /** @type {Record<string, string | undefined>} */
  const child = { ...env };
  for (const key of SANITIZED_CHILD_ENV_KEYS) {
    delete child[key];
  }
  if (
    nonemptySecret(child.OPENAI_API_KEY) === null &&
    nonemptySecret(child.CODEX_API_KEY) !== null
  ) {
    child.OPENAI_API_KEY = child.CODEX_API_KEY;
  }
  return child;
}

export function publicCredentialRecord(credentials) {
  return {
    present: credentials.present,
    method: credentials.method,
    envVar: credentials.envVar,
  };
}

export async function loadFrozen(root = REPO_ROOT) {
  const frozen = JSON.parse(
    await readFile(join(root, "experiments/real-scale-2.frozen.json"), "utf8"),
  );
  assertFrozenCodexExperiment(frozen);
  return frozen;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function commandOutput(command, args) {
  return new Promise((resolveOutput) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolveOutput({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (exitCode) => {
      resolveOutput({ exitCode: exitCode ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function readDefaultModel(codexHome) {
  try {
    const contents = await readFile(join(codexHome, "config.toml"), "utf8");
    const match = contents.match(/^\s*model\s*=\s*"([^"]+)"/mu);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function collectFingerprint(env, frozen) {
  const credentials = publicCredentialRecord(resolveCredentials(env));
  const node = await commandOutput(process.execPath, ["--version"]);
  const git = await commandOutput("git", ["--version"]);
  const pnpm = await commandOutput("pnpm", ["--version"]);
  const npm = await commandOutput("npm", ["--version"]);
  const codex = await commandOutput("codex", ["--version"]);
  const frozenBytes = await readFile(FROZEN_PATH);
  const taskBytes = await readFile(join(REPO_ROOT, TASK_FILE));
  const workflowBytes = await readFile(join(REPO_ROOT, ".github/workflows/real-scale-2-codex.yml"));
  const codexHome = nonemptySecret(env.CODEX_HOME) ?? join(homedir(), ".codex");
  return {
    schemaVersion: 1,
    experimentName: "real-scale-2",
    recordedAt: new Date().toISOString(),
    pinned: PINNED,
    frozen: {
      path: "experiments/real-scale-2.frozen.json",
      sha256: sha256(frozenBytes),
      agent: frozen.configuration.agent,
      agentModel: frozen.configuration.agentModel ?? null,
      workerCounts: frozen.configuration.workerCounts,
      repetitions: frozen.configuration.repetitions,
      seed: frozen.configuration.seed,
      taskFile: frozen.configuration.taskFile,
      taskFileSha256: sha256(taskBytes),
      integration: frozen.configuration.integration,
    },
    runner: {
      image: PINNED.runnerImage,
      name: env.RUNNER_NAME ?? null,
      os: env.RUNNER_OS ?? platform(),
      arch: env.RUNNER_ARCH ?? process.arch,
      environment: env.RUNNER_ENVIRONMENT ?? null,
      imageOS: env.ImageOS ?? null,
      imageVersion: env.ImageVersion ?? null,
      operatingSystemRelease: release(),
      cpuCount: cpus().length,
    },
    github: {
      repository: env.GITHUB_REPOSITORY ?? null,
      ref: env.GITHUB_REF ?? null,
      sha: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      workflowFileSha256: sha256(workflowBytes),
      job: env.GITHUB_JOB ?? null,
    },
    toolchain: {
      node: node.stdout || node.stderr || null,
      pnpm: pnpm.stdout || null,
      npm: npm.stdout || null,
      git: git.stdout || git.stderr || null,
      codex: codex.stdout || codex.stderr || null,
      codexPackage: PINNED.codexPackage,
      raptureCli: "apps/cli/dist/index.js",
    },
    agent: {
      name: "codex",
      modelPinnedByRapture: frozen.configuration.agentModel ?? null,
      modelFromCodexConfig: await readDefaultModel(codexHome),
      credential: credentials,
    },
  };
}

export function assertNoSecretMaterial(serialized, env) {
  const secrets = [
    nonemptySecret(env.OPENAI_API_KEY),
    nonemptySecret(env.CODEX_API_KEY),
    nonemptySecret(env.CODEX_ACCESS_TOKEN),
  ].filter((value) => value !== null);
  for (const value of secrets) {
    if (serialized.includes(value)) {
      throw new CiError(
        "REAL_SCALE_2_SECRET_LEAK",
        "refusing to write fingerprint because it contains a credential value",
      );
    }
  }
}

export async function writeFingerprint(directory, fingerprint, env = process.env) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, FINGERPRINT_NAME);
  const serialized = `${JSON.stringify(fingerprint, null, 2)}\n`;
  if (fingerprint.agent.credential.value !== undefined) {
    throw new CiError("REAL_SCALE_2_SECRET_LEAK", "fingerprint must not contain credential values");
  }
  assertNoSecretMaterial(serialized, env);
  await writeFile(path, serialized, "utf8");
  return path;
}

export async function copyFingerprintIntoExperiments(outputDirectory, fingerprintPath) {
  const entries = await readdir(outputDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("exp-")) {
      await copyFile(fingerprintPath, join(outputDirectory, entry.name, FINGERPRINT_NAME));
    }
  }
}

function spawnProcess(command, args, options) {
  return new Promise((resolveExit, reject) => {
    const { input, ...rest } = options;
    const child = spawn(command, args, rest);
    child.on("error", reject);
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on("close", (exitCode, signal) => {
      resolveExit({ exitCode: exitCode ?? 1, signal });
    });
  });
}

export async function authenticateCodex(env, spawnImpl = spawnProcess) {
  const credentials = assertCodexCredentials(env);
  const result = await spawnImpl("codex", loginArgs(credentials.method), {
    cwd: REPO_ROOT,
    env: raptureChildEnv(env),
    stdio: ["pipe", "inherit", "inherit"],
    input: `${credentials.value}\n`,
  });
  if (result.exitCode !== 0) {
    throw new CiError(
      "REAL_SCALE_2_AUTH_FAILED",
      `codex login failed with exit ${result.exitCode}. Credentials were present but Codex did not authenticate.`,
    );
  }
}

export async function assertCodexLoginStatus() {
  const status = await commandOutput("codex", ["login", "status"]);
  if (status.exitCode !== 0) {
    throw new CiError(
      "REAL_SCALE_2_AUTH_FAILED",
      `codex login status failed: ${status.stdout || status.stderr || "not logged in"}`,
    );
  }
}

export async function runFrozenExperiment(env) {
  const frozen = await loadFrozen();
  assertCodexCredentials(env);
  const output = join(REPO_ROOT, OUTPUT_DIRECTORY);
  const repoParent = nonemptySecret(env.RUNNER_TEMP) ?? join(REPO_ROOT, ".tmp");
  const repo = join(repoParent, "ledger-kit");
  await mkdir(repoParent, { recursive: true });
  await rm(repo, { recursive: true, force: true });
  const create = await spawnProcess(
    process.execPath,
    [join(REPO_ROOT, "fixtures/ledger-kit/create.mjs"), repo],
    {
      cwd: REPO_ROOT,
      env: raptureChildEnv(env),
      stdio: "inherit",
    },
  );
  if (create.exitCode !== 0) {
    throw new CiError(
      "REAL_SCALE_2_FIXTURE",
      `ledger-kit create failed with exit ${create.exitCode}`,
    );
  }
  const fingerprint = await collectFingerprint(env, frozen);
  const fingerprintPath = await writeFingerprint(output, fingerprint);
  const argv = buildRaptureArgv(frozen, repo, output);
  const rapture = join(REPO_ROOT, "apps/cli/dist/index.js");
  const experiment = await spawnProcess(process.execPath, [rapture, ...argv], {
    cwd: REPO_ROOT,
    env: raptureChildEnv(env),
    stdio: "inherit",
  });
  await copyFingerprintIntoExperiments(output, fingerprintPath);
  if (experiment.exitCode !== 0) {
    throw new CiError(
      "REAL_SCALE_2_EXPERIMENT_FAILED",
      `rapture run failed with exit ${experiment.exitCode}`,
    );
  }
}

async function main(argv, env) {
  const command = argv[2];
  try {
    if (command === "preflight") {
      const frozen = await loadFrozen();
      assertFrozenCodexExperiment(frozen);
      assertCodexCredentials(env);
      process.stdout.write(
        "real-scale-2 preflight ok: Codex credentials present; fake-agent fallback disabled.\n",
      );
      return;
    }
    if (command === "authenticate") {
      await authenticateCodex(env);
      await assertCodexLoginStatus();
      process.stdout.write("real-scale-2 authenticate ok: Codex CLI is logged in.\n");
      return;
    }
    if (command === "fingerprint") {
      const frozen = await loadFrozen();
      const output = join(REPO_ROOT, OUTPUT_DIRECTORY);
      const path = await writeFingerprint(output, await collectFingerprint(env, frozen));
      process.stdout.write(`${path}\n`);
      return;
    }
    if (command === "run") {
      await runFrozenExperiment(env);
      return;
    }
    throw new CiError(
      "REAL_SCALE_2_USAGE",
      "usage: node scripts/real-scale-2/ci.mjs <preflight|authenticate|fingerprint|run>",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv, process.env);
}
