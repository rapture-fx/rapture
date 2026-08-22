import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assertCodexCredentials,
  assertFrozenCodexExperiment,
  assertNoSecretMaterial,
  authenticateCodex,
  buildRaptureArgv,
  CiError,
  doctorArgv,
  EXPECTED_FROZEN_CONFIGURATION,
  fakeAgentRefusalMessage,
  loadFrozen,
  loginArgs,
  missingCredentialMessage,
  PINNED,
  preflightOnlyAllowsSuccess,
  publicCredentialRecord,
  raptureChildEnv,
  resolveCredentials,
  writeFingerprint,
} from "./ci.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("credential preflight", () => {
  it("treats missing and blank secrets as absent", () => {
    assert.equal(resolveCredentials({}).present, false);
    assert.equal(resolveCredentials({ OPENAI_API_KEY: "" }).present, false);
    assert.equal(resolveCredentials({ CODEX_API_KEY: "   " }).present, false);
    assert.equal(resolveCredentials({ CODEX_ACCESS_TOKEN: "\n" }).present, false);
  });

  it("prefers OPENAI_API_KEY, then CODEX_API_KEY, then CODEX_ACCESS_TOKEN", () => {
    assert.deepEqual(publicCredentialRecord(resolveCredentials({ OPENAI_API_KEY: "sk-test" })), {
      present: true,
      method: "api-key",
      envVar: "OPENAI_API_KEY",
    });
    assert.equal(resolveCredentials({ CODEX_API_KEY: "sk-codex" }).envVar, "CODEX_API_KEY");
    assert.equal(resolveCredentials({ CODEX_ACCESS_TOKEN: "tok" }).method, "access-token");
  });

  it("fails closed with a named error before any experiment execution", () => {
    assert.throws(
      () => assertCodexCredentials({}),
      (error) => {
        assert.equal(error instanceof CiError, true);
        assert.equal(error.code, "REAL_SCALE_2_CREDENTIALS_MISSING");
        assert.match(error.message, /never falls back to --agent fake/u);
        return true;
      },
    );
    assert.match(missingCredentialMessage(), /REAL_SCALE_2_CREDENTIALS_MISSING/u);
  });

  it("fails the CLI preflight before rapture when secrets are empty", async () => {
    const exec = promisify(execFile);
    await assert.rejects(
      () =>
        exec(process.execPath, [join(repoRoot, "scripts/real-scale-2/ci.mjs"), "preflight"], {
          cwd: repoRoot,
          env: {
            PATH: process.env.PATH ?? "/usr/bin",
            HOME: process.env.HOME ?? tmpdir(),
            OPENAI_API_KEY: "",
            CODEX_API_KEY: "",
            CODEX_ACCESS_TOKEN: "",
          },
        }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(String(error.stderr), /REAL_SCALE_2_CREDENTIALS_MISSING/u);
        assert.doesNotMatch(String(error.stderr), /fake agent completed/u);
        return true;
      },
    );
  });
});

describe("frozen Codex command", () => {
  it("loads the frozen 1/2-worker × 3-trial semantics", async () => {
    const frozen = await loadFrozen();
    assert.equal(frozen.configuration.agent, "codex");
    assert.deepEqual(frozen.configuration.workerCounts, [1, 2]);
    assert.equal(frozen.configuration.repetitions, 3);
    assert.equal(frozen.configuration.seed, 20260817);
    assert.equal(frozen.configuration.integration, false);
    assert.deepEqual(
      {
        agent: frozen.configuration.agent,
        workerCounts: frozen.configuration.workerCounts,
        repetitions: frozen.configuration.repetitions,
        seed: frozen.configuration.seed,
        taskFile: frozen.configuration.taskFile,
        taskCount: frozen.configuration.taskCount,
        timeoutSecondsPerTask: frozen.configuration.timeoutSecondsPerTask,
        integration: frozen.configuration.integration,
      },
      EXPECTED_FROZEN_CONFIGURATION,
    );
  });

  it("builds the frozen rapture argv without a fake-agent fallback", async () => {
    const argv = buildRaptureArgv(
      await loadFrozen(),
      "/tmp/ledger-kit",
      "experiments/real-scale-2",
    );
    assert.deepEqual(argv, [
      "run",
      "--repo",
      "/tmp/ledger-kit",
      "--tasks",
      "fixtures/ledger-kit/tasks.json",
      "--workers",
      "1,2",
      "--repetitions",
      "3",
      "--seed",
      "20260817",
      "--agent",
      "codex",
      "--output",
      "experiments/real-scale-2",
    ]);
    assert.equal(argv.includes("fake"), false);
  });

  it("refuses a frozen file that names the fake adapter", () => {
    assert.throws(
      () => assertFrozenCodexExperiment({ configuration: { agent: "fake" } }),
      (error) => {
        assert.equal(error.code, "REAL_SCALE_2_FAKE_AGENT_REFUSED");
        assert.equal(error.message, fakeAgentRefusalMessage());
        return true;
      },
    );
  });
});

describe("auth and child environment", () => {
  it("pipes API keys and access tokens on stdin, never argv", async () => {
    assert.deepEqual(loginArgs("api-key"), ["login", "--with-api-key"]);
    assert.deepEqual(loginArgs("access-token"), ["login", "--with-access-token"]);
    const calls = [];
    await authenticateCodex({ OPENAI_API_KEY: "sk-secret" }, async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0 };
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "codex");
    assert.deepEqual(calls[0]?.args, ["login", "--with-api-key"]);
    assert.equal(calls[0]?.args.includes("sk-secret"), false);
    assert.equal(calls[0]?.options.input, "sk-secret\n");
  });

  it("copies CODEX_API_KEY to OPENAI_API_KEY and drops GitHub tokens", () => {
    const child = raptureChildEnv({
      CODEX_API_KEY: "sk-codex",
      GITHUB_TOKEN: "ghs_should_not_reach_codex",
      GH_TOKEN: "also-no",
      ACTIONS_RUNTIME_TOKEN: "runtime",
      PATH: "/usr/bin",
    });
    assert.equal(child.OPENAI_API_KEY, "sk-codex");
    assert.equal(child.GITHUB_TOKEN, undefined);
    assert.equal(child.GH_TOKEN, undefined);
    assert.equal(child.ACTIONS_RUNTIME_TOKEN, undefined);
    assert.equal(child.PATH, "/usr/bin");
  });
});

describe("fingerprint", () => {
  it("refuses to serialize credential values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rapture-fingerprint-"));
    const env = { OPENAI_API_KEY: "sk-live-secret-value" };
    const fingerprint = {
      agent: {
        credential: {
          present: true,
          method: "api-key",
          envVar: "OPENAI_API_KEY",
          value: "sk-live-secret-value",
        },
      },
    };
    await assert.rejects(
      () => writeFingerprint(directory, fingerprint, env),
      (error) => {
        assert.equal(error.code, "REAL_SCALE_2_SECRET_LEAK");
        return true;
      },
    );
    assert.throws(() => assertNoSecretMaterial('{"key":"sk-live-secret-value"}', env));
    const path = await writeFingerprint(
      directory,
      { agent: { credential: publicCredentialRecord(resolveCredentials(env)) } },
      env,
    );
    const written = await readFile(path, "utf8");
    assert.equal(written.includes("sk-live-secret-value"), false);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("workflow pins", () => {
  it("pins one ubuntu-24.04 runner and the frozen toolchain", async () => {
    const workflow = await readFile(
      join(repoRoot, ".github/workflows/real-scale-2-codex.yml"),
      "utf8",
    );
    assert.match(workflow, /^name: /mu);
    assert.match(workflow, /runs-on: ubuntu-24\.04/u);
    assert.equal((workflow.match(/runs-on:/gu) ?? []).length, 1);
    assert.doesNotMatch(workflow, /ubuntu-latest/u);
    assert.doesNotMatch(workflow, /--agent fake/u);
    assert.match(workflow, new RegExp(`node-version: "${PINNED.node}"`, "u"));
    assert.match(workflow, /@openai\/codex@0\.147\.0/u);
    assert.match(workflow, /environment: real-scale-2/u);
    assert.match(workflow, /secrets\.OPENAI_API_KEY/u);
    assert.match(workflow, /secrets\.CODEX_API_KEY/u);
    assert.match(workflow, /secrets\.CODEX_ACCESS_TOKEN/u);
    assert.match(workflow, /scripts\/real-scale-2\/ci\.mjs doctor/u);
    assert.match(workflow, /scripts\/real-scale-2\/ci\.mjs run/u);
    assert.match(workflow, /preflight_only/u);
    assert.match(workflow, /experiments\/real-scale-2/u);
    assert.match(workflow, /persist-credentials: false/u);
  });

  it("builds a doctor argv that never starts inference or fake workers", () => {
    const argv = doctorArgv();
    assert.equal(argv[0], "doctor");
    assert.equal(argv.includes("run"), false);
    assert.equal(argv.includes("fake"), false);
    assert.equal(argv.includes("codex"), true);
  });

  it("treats missing auth as an allowed preflight-only blocker", () => {
    assert.equal(
      preflightOnlyAllowsSuccess({
        checks: [
          { id: "NODE_RUNTIME", status: "PASS" },
          { id: "AGENT_AUTH", status: "BLOCKED" },
        ],
      }),
      true,
    );
    assert.equal(
      preflightOnlyAllowsSuccess({
        checks: [
          { id: "GIT_RUNTIME", status: "BLOCKED" },
          { id: "AGENT_AUTH", status: "BLOCKED" },
        ],
      }),
      false,
    );
  });
});
