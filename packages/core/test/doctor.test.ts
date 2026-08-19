import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectCodexCredentialPresence } from "../src/adapters/auth.js";
import { fakeAgentAdapter } from "../src/adapters/fake.js";
import type { AgentAdapter } from "../src/adapters/types.js";
import {
  aggregateDoctorStatus,
  collectRunnerFingerprint,
  doctorExitCode,
  doctorResultSchema,
  persistDoctorArtifacts,
  preflightOnlyAllowsSuccess,
  runDoctor,
} from "../src/doctor.js";
import { evaluateNodeRuntime } from "../src/doctor-checks.js";
import {
  frozenSemanticMismatches,
  loadFrozenExperiment,
  REAL_SCALE_4_EXPECTED,
} from "../src/frozen.js";
import { computeFrozenIntegrity } from "../src/integrity.js";
import { createGitRepository, fakeTask, writeTaskFile } from "./helpers.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function check(
  id: "NODE_RUNTIME" | "AGENT_AUTH" | "MODEL_CONFIG",
  status: "PASS" | "BLOCKED" | "WARNING",
) {
  return { id, status, message: id, details: {} };
}

describe("doctor status aggregation", () => {
  it("is READY only when every check passes", () => {
    expect(aggregateDoctorStatus([check("NODE_RUNTIME", "PASS")])).toBe("READY");
    expect(
      aggregateDoctorStatus([check("NODE_RUNTIME", "PASS"), check("MODEL_CONFIG", "WARNING")]),
    ).toBe("WARNING");
    expect(
      aggregateDoctorStatus([
        check("NODE_RUNTIME", "PASS"),
        check("AGENT_AUTH", "BLOCKED"),
        check("MODEL_CONFIG", "WARNING"),
      ]),
    ).toBe("BLOCKED");
  });

  it("maps overall status to doctor exit codes", () => {
    expect(doctorExitCode("READY")).toBe(0);
    expect(doctorExitCode("WARNING")).toBe(0);
    expect(doctorExitCode("BLOCKED")).toBe(2);
  });
});

describe("runtime detection", () => {
  it("accepts Node versions that satisfy the project requirement", () => {
    expect(evaluateNodeRuntime("v22.14.0", 22, "22.14.0").status).toBe("PASS");
    expect(evaluateNodeRuntime("v20.10.0", 22).status).toBe("BLOCKED");
    expect(evaluateNodeRuntime("v22.20.0", 22, "22.14.0").status).toBe("WARNING");
  });
});

describe("credential probing", () => {
  it("detects missing Codex auth without retaining secret values", () => {
    const missing = detectCodexCredentialPresence({ OPENAI_API_KEY: "" });
    expect(missing.present).toBe(false);
    expect(JSON.stringify(missing)).not.toContain("sk-");
    const present = detectCodexCredentialPresence({ OPENAI_API_KEY: "sk-live-secret-value" });
    expect(present.present).toBe(true);
    expect(present.envVar).toBe("OPENAI_API_KEY");
    expect(JSON.stringify(present)).not.toContain("sk-live-secret-value");
  });
});

describe("frozen config and integrity", () => {
  it("validates the frozen real-scale-2 semantics", async () => {
    const frozen = await loadFrozenExperiment(
      join(workspaceRoot, "experiments/real-scale-2.frozen.json"),
    );
    expect(frozenSemanticMismatches(frozen)).toEqual([]);
    expect(frozen.configuration.workerCounts).toEqual([1, 2]);
    expect(frozen.configuration.repetitions).toBe(3);
    expect(frozen.configuration.seed).toBe(20260817);
  });

  it("fingerprints frozen inputs deterministically", async () => {
    const first = await computeFrozenIntegrity(workspaceRoot);
    const second = await computeFrozenIntegrity(workspaceRoot);
    expect(first.aggregateSha256).toBe(second.aggregateSha256);
    expect(first.files["experiments/real-scale-2.frozen.json"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.files["fixtures/ledger-kit/tasks.json"]).toBeDefined();
    expect(first.files["fixtures/ledger-kit/validation/money.ts"]).toBeDefined();
    expect(first.files["fixtures/ledger-kit/src/money.ts"]).toBeDefined();
  });

  it("accepts the frozen real-scale-4 semantics", async () => {
    const frozen = {
      experimentName: "real-scale-4",
      configuration: {
        agent: REAL_SCALE_4_EXPECTED.agent,
        workerCounts: [1, 2, 4],
        repetitions: 3,
        seed: 20260817,
        taskFile: "fixtures/ledger-kit/tasks.json",
        taskCount: 6,
        taskIds: [...REAL_SCALE_4_EXPECTED.taskIds],
        timeoutSecondsPerTask: 180,
        integration: false,
      },
    };
    expect(frozenSemanticMismatches(frozen)).toEqual([]);
    expect(
      frozenSemanticMismatches({
        ...frozen,
        configuration: { ...frozen.configuration, workerCounts: [1, 2] },
      }),
    ).toContain("workerCounts");
  });

  it("detects frozen input drift", async () => {
    const actual = await computeFrozenIntegrity(workspaceRoot);
    const drifted = {
      ...actual,
      files: { ...actual.files, "fixtures/ledger-kit/tasks.json": "0".repeat(64) },
      aggregateSha256: "0".repeat(64),
    };
    expect(actual.files["fixtures/ledger-kit/tasks.json"]).not.toBe(
      drifted.files["fixtures/ledger-kit/tasks.json"],
    );
    expect(
      frozenSemanticMismatches({
        ...JSON.parse(
          await readFile(join(workspaceRoot, "experiments/real-scale-2.frozen.json"), "utf8"),
        ),
        configuration: {
          ...(
            await loadFrozenExperiment(join(workspaceRoot, "experiments/real-scale-2.frozen.json"))
          ).configuration,
          workerCounts: [1, 2, 4],
        },
      }),
    ).toContain("workerCounts");
  });
});

describe("doctor integration", () => {
  it("returns READY for a valid fake fixture environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-doctor-ready-"));
    const repository = await createGitRepository(root);
    const taskFile = await writeTaskFile(root, [
      fakeTask("one", "one.txt", "one\n", "node -e \"require('node:fs').accessSync('one.txt')\""),
    ]);
    const output = join(root, "out");
    const configPath = join(root, "experiment.json");
    await writeFile(
      configPath,
      JSON.stringify({
        experimentName: "local-fake",
        configuration: {
          agent: "fake",
          agentModel: null,
          workerCounts: [1],
          repetitions: 1,
          seed: 0,
          taskFile,
          taskCount: 1,
          integration: false,
        },
      }),
      "utf8",
    );
    const result = await runDoctor({
      workspaceRoot,
      repository,
      taskFile,
      outputDirectory: output,
      agent: "fake",
      configPath,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(result.checks.find((item) => item.id === "AGENT_AUTH")?.status).toBe("PASS");
    expect(result.checks.find((item) => item.id === "AGENT_BINARY")?.status).toBe("PASS");
    expect(result.checks.find((item) => item.id === "REPOSITORY_STATE")?.status).toBe("PASS");
    expect(result.status).toBe("READY");
    expect(result.scalingConclusion).toBeNull();
    expect(doctorResultSchema.parse(result).status).toBe("READY");
  });

  it("blocks on a missing Codex binary", async () => {
    const adapter: AgentAdapter = {
      ...fakeAgentAdapter,
      name: () => "codex",
      isAvailable: async () => ({ available: false, detail: "codex: not found" }),
      version: async () => null,
      probeCredentials: fakeAgentAdapter.probeCredentials,
    };
    const result = await runDoctor({
      workspaceRoot,
      agent: "codex",
      adapter,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(result.checks.find((item) => item.id === "AGENT_BINARY")?.status).toBe("BLOCKED");
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks on missing Codex auth without leaking secrets", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "rapture-codex-home-"));
    const result = await runDoctor({
      workspaceRoot,
      agent: "codex",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: "",
        CODEX_API_KEY: "",
        CODEX_ACCESS_TOKEN: "",
      },
    });
    const auth = result.checks.find((item) => item.id === "AGENT_AUTH");
    expect(auth?.status).toBe("BLOCKED");
    expect(auth?.details.code).toBe("REAL_SCALE_2_CREDENTIALS_MISSING");
    expect(JSON.stringify(result)).not.toMatch(/sk-|tok-/u);
    expect(result.status).toBe("BLOCKED");
    expect(preflightOnlyAllowsSuccess(result)).toBe(
      result.checks
        .filter((item) => item.status === "BLOCKED")
        .every((item) => item.id === "AGENT_AUTH"),
    );
  });

  it("blocks on a dirty target repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-doctor-dirty-"));
    const repository = await createGitRepository(root);
    await writeFile(join(repository, "dirty.txt"), "dirty\n", "utf8");
    const result = await runDoctor({
      workspaceRoot,
      repository,
      agent: "fake",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(result.checks.find((item) => item.id === "REPOSITORY_STATE")?.status).toBe("BLOCKED");
    expect(result.status).toBe("BLOCKED");
  });

  it("reports unpinned Codex model configuration as a warning", async () => {
    const result = await runDoctor({
      workspaceRoot,
      agent: "codex",
      agentModel: null,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    const model = result.checks.find((item) => item.id === "MODEL_CONFIG");
    expect(model?.status).toBe("WARNING");
    expect(model?.details.usesProviderDefault).toBe(true);
  });

  it("rejects unsafe output paths", async () => {
    const result = await runDoctor({
      workspaceRoot,
      agent: "fake",
      outputDirectory: "/etc/rapture-doctor",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(result.checks.find((item) => item.id === "OUTPUT_PATH")?.status).toBe("BLOCKED");
  });

  it("persists doctor JSON and runner fingerprints without secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rapture-doctor-write-"));
    await mkdir(directory, { recursive: true });
    const env = { OPENAI_API_KEY: "sk-live-secret-value", PATH: process.env.PATH };
    const fingerprint = await collectRunnerFingerprint({
      workspaceRoot,
      env,
      model: null,
      adapter: fakeAgentAdapter,
    });
    expect(fingerprint.nodeVersion).toMatch(/^v22/u);
    expect(fingerprint.cpuCount).toBeGreaterThan(0);
    expect(fingerprint.memoryBytes).toBeGreaterThan(0);
    expect(fingerprint.kernel.length).toBeGreaterThan(0);
    const result = await runDoctor({
      workspaceRoot,
      agent: "fake",
      outputDirectory: directory,
      env,
    });
    const paths = await persistDoctorArtifacts(directory, result, env);
    const doctorJson = await readFile(paths.doctorPath, "utf8");
    const fingerprintJson = await readFile(paths.fingerprintPath, "utf8");
    expect(doctorJson).not.toContain("sk-live-secret-value");
    expect(fingerprintJson).not.toContain("sk-live-secret-value");
    expect(doctorResultSchema.parse(JSON.parse(doctorJson)).scalingConclusion).toBeNull();
  });

  it("diagnoses the frozen Codex experiment without running inference", async () => {
    const output = join(await mkdtemp(join(tmpdir(), "rapture-doctor-frozen-")), "out");
    const codexHome = await mkdtemp(join(tmpdir(), "rapture-codex-home-"));
    const result = await runDoctor({
      workspaceRoot,
      configPath: join(workspaceRoot, "experiments/real-scale-2.frozen.json"),
      outputDirectory: output,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: "",
        CODEX_API_KEY: "",
        CODEX_ACCESS_TOKEN: "",
      },
    });
    expect(result.experiment).toBe("real-scale-2");
    expect(result.agent).toBe("codex");
    expect(result.checks.find((item) => item.id === "EXPERIMENT_CONFIG")?.status).toBe("PASS");
    expect(result.checks.find((item) => item.id === "TASK_INTEGRITY")?.status).toBe("PASS");
    expect(result.checks.find((item) => item.id === "FIXTURE_INTEGRITY")?.status).toBe("PASS");
    expect(result.checks.find((item) => item.id === "AGENT_AUTH")?.status).toBe("BLOCKED");
    expect(result.checks.find((item) => item.id === "AGENT_AUTH")?.details.code).toBe(
      "REAL_SCALE_2_CREDENTIALS_MISSING",
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.scalingConclusion).toBeNull();
    expect(result.integrity?.aggregateSha256).toHaveLength(64);
  });
});
