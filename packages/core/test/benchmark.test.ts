import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyKnownGoodPatch,
  BenchmarkIntegrityError,
  benchmarkFingerprint,
  benchmarkSuiteSchema,
  benchmarkTasksForRepository,
  loadBenchmarkSuite,
  materializeBenchmarkRepository,
  runBenchmarkDoctor,
  runBenchmarkValidator,
  verifyBenchmarkAssets,
} from "../src/benchmark.js";
import { parseTaskFile } from "../src/config.js";
import { runExperiment } from "../src/experiment.js";
import type { BenchmarkTaskProvenance, ExperimentConfig } from "../src/models.js";
import { inspectExperiment } from "../src/report.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = join(workspaceRoot, "benchmarks/real-work-v0/manifest.json");

async function rawSuite(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
}

describe("real-work benchmark manifest", () => {
  it("parses the frozen suite and serializes every task class", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    expect(suite.repositories).toHaveLength(2);
    expect(suite.tasks).toHaveLength(8);
    expect(new Set(suite.tasks.map((task) => task.class))).toEqual(
      new Set<BenchmarkTaskProvenance["taskClass"]>([
        "bug_fix",
        "small_feature",
        "refactor",
        "test_repair",
        "repository_exploration",
        "build_or_typecheck_heavy",
      ]),
    );
  });

  it("rejects duplicate IDs, unknown repositories, and invalid known-good metadata", async () => {
    const raw = await rawSuite();
    const repositories = raw.repositories as Record<string, unknown>[];
    const tasks = raw.tasks as Record<string, unknown>[];
    const duplicate = structuredClone(raw);
    (duplicate.tasks as Record<string, unknown>[])[1] = {
      ...((duplicate.tasks as Record<string, unknown>[])[1] ?? {}),
      id: tasks[0]?.id,
    };
    expect(benchmarkSuiteSchema.safeParse(duplicate).success).toBe(false);

    const unknown = structuredClone(raw);
    (unknown.tasks as Record<string, unknown>[])[0] = {
      ...((unknown.tasks as Record<string, unknown>[])[0] ?? {}),
      repositoryId: "missing",
    };
    expect(benchmarkSuiteSchema.safeParse(unknown).success).toBe(false);

    const invalidPatch = structuredClone(raw);
    const first = (invalidPatch.tasks as Record<string, unknown>[])[0];
    if (first === undefined) throw new Error("fixture task missing");
    first.knownGoodPatch = { path: "known-good/example.json", sha256: "not-a-hash" };
    expect(benchmarkSuiteSchema.safeParse(invalidPatch).success).toBe(false);
    expect(repositories).toHaveLength(2);
  });

  it("fingerprints deterministically and changes on semantic mutation", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    expect(benchmarkFingerprint(suite)).toBe(suite.integrity.suiteSha256);
    expect(benchmarkFingerprint(structuredClone(suite))).toBe(suite.integrity.suiteSha256);
    const changed = structuredClone(suite);
    const task = changed.tasks[0];
    if (task === undefined) throw new Error("fixture task missing");
    task.prompt = `${task.prompt} changed`;
    expect(benchmarkFingerprint(changed)).not.toBe(suite.integrity.suiteSha256);
  });

  it("keeps legacy ledger task definitions compatible", () => {
    const tasks = parseTaskFile({
      tasks: [
        {
          id: "legacy",
          description: "legacy task",
          baseCommit: "HEAD",
          validation: ["node --version"],
          timeoutSeconds: 5,
          independent: true,
          dependsOn: [],
        },
      ],
    });
    expect(tasks[0]?.benchmark).toBeUndefined();
  });
});

describe("real-work benchmark proofs", () => {
  it("materializes pinned bases and proves deterministic baseline rejection and known-good acceptance", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const root = await mkdtemp(join(tmpdir(), "rapture-benchmark-test-"));
    for (const repository of suite.repositories) {
      const destination = join(root, repository.id);
      await materializeBenchmarkRepository({
        manifestPath,
        suite,
        repositoryId: repository.id,
        destination,
      });
      for (const task of suite.tasks.filter((item) => item.repositoryId === repository.id)) {
        const baselineOne = await runBenchmarkValidator({
          manifestPath,
          task,
          repository: destination,
        });
        const baselineTwo = await runBenchmarkValidator({
          manifestPath,
          task,
          repository: destination,
        });
        expect([baselineOne.classification, baselineTwo.classification], task.id).toEqual([
          "rejected",
          "rejected",
        ]);
        await applyKnownGoodPatch({ manifestPath, task, repository: destination });
        const acceptedOne = await runBenchmarkValidator({
          manifestPath,
          task,
          repository: destination,
        });
        const acceptedTwo = await runBenchmarkValidator({
          manifestPath,
          task,
          repository: destination,
        });
        expect([acceptedOne.classification, acceptedTwo.classification], task.id).toEqual([
          "accepted",
          "accepted",
        ]);
        const { runGit } = await import("../src/git.js");
        await runGit(destination, ["reset", "--hard", repository.baseRevision]);
      }
    }
  }, 120_000);

  it("classifies validator infrastructure failures separately", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const task = suite.tasks[0];
    if (task === undefined) throw new Error("fixture task missing");
    const result = await runBenchmarkValidator({
      manifestPath,
      task: { ...task, validator: { ...task.validator, path: "validators/missing.mjs" } },
      repository: workspaceRoot,
    });
    expect(result.classification).toBe("infrastructure_failure");
  });

  it("fails closed on fixture drift and keeps validators outside editable repositories", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const root = await mkdtemp(join(tmpdir(), "rapture-benchmark-drift-"));
    const copiedSuite = join(root, "real-work-v0");
    await cp(dirname(manifestPath), copiedSuite, { recursive: true });
    await writeFile(
      join(copiedSuite, "fixtures/commerce-service/src/money.mjs"),
      "drift\n",
      "utf8",
    );
    await expect(
      verifyBenchmarkAssets(join(copiedSuite, "manifest.json"), suite),
    ).rejects.toBeInstanceOf(BenchmarkIntegrityError);

    const materialized = join(root, "materialized");
    await materializeBenchmarkRepository({
      manifestPath,
      suite,
      repositoryId: "commerce-service",
      destination: materialized,
    });
    for (const task of suite.tasks) {
      expect(
        resolve(dirname(manifestPath), task.validator.path).startsWith(`${materialized}/`),
      ).toBe(false);
      expect(task.editableScope).not.toContain(task.validator.path);
    }
  });

  it("reports benchmark readiness from complete proofs", async () => {
    const result = await runBenchmarkDoctor({
      manifestPath,
      requireCleanSource: false,
      repetitions: 1,
    });
    expect(result.status).toBe("PASS");
    expect(result.checks.filter((check) => check.id.startsWith("PROOF_"))).toHaveLength(8);
  }, 90_000);
});

it("propagates suite, repository, and task-class provenance through a fake-agent experiment", async () => {
  const suite = await loadBenchmarkSuite(manifestPath);
  const root = await mkdtemp(join(tmpdir(), "rapture-benchmark-provenance-"));
  const repository = join(root, "repository");
  await materializeBenchmarkRepository({
    manifestPath,
    suite,
    repositoryId: "commerce-service",
    destination: repository,
  });
  const task = benchmarkTasksForRepository({
    manifestPath,
    suite,
    repositoryId: "commerce-service",
  })[0];
  if (task === undefined) throw new Error("fixture task missing");
  const overlay = JSON.parse(
    await readFile(join(dirname(manifestPath), "known-good/commerce-money.json"), "utf8"),
  ) as { files: Record<string, string> };
  const config: ExperimentConfig = {
    repository,
    taskFile: manifestPath,
    tasks: [
      {
        ...task,
        fake: {
          files: overlay.files,
          exitCode: 0,
          delayMs: 1,
          stdout: "known-good fake",
          stderr: "",
        },
      },
    ],
    workerCounts: [1],
    repetitions: 1,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "runs"),
    budget: {},
    seed: 1,
    integration: false,
    integrationValidation: [],
  };
  const execution = await runExperiment(config);
  const inspection = await inspectExperiment(execution.directory);
  const runPath = inspection.runResults[0];
  if (runPath === undefined) throw new Error("run result missing");
  const run = JSON.parse(await readFile(runPath, "utf8")) as Record<string, unknown>;
  expect(run).toMatchObject({
    accepted: true,
    repositoryId: "commerce-service",
    benchmarkSuiteId: "rapture-real-work-v0",
    benchmarkSuiteVersion: suite.version,
    benchmarkTaskClass: "bug_fix",
  });
  const manifest = JSON.parse(
    await readFile(join(execution.directory, "manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  expect(manifest.benchmark).toEqual({
    suiteIds: ["rapture-real-work-v0"],
    suiteVersions: [suite.version],
    repositoryIds: ["commerce-service"],
    taskClasses: ["bug_fix"],
  });
}, 60_000);

it("enforces benchmark editable scope and validator infrastructure classification", async () => {
  const suite = await loadBenchmarkSuite(manifestPath);
  const root = await mkdtemp(join(tmpdir(), "rapture-benchmark-boundary-"));
  const repository = join(root, "repository");
  await materializeBenchmarkRepository({
    manifestPath,
    suite,
    repositoryId: "commerce-service",
    destination: repository,
  });
  const task = benchmarkTasksForRepository({
    manifestPath,
    suite,
    repositoryId: "commerce-service",
  })[0];
  if (task?.benchmark === undefined) throw new Error("benchmark task missing");
  const overlay = JSON.parse(
    await readFile(join(dirname(manifestPath), "known-good/commerce-money.json"), "utf8"),
  ) as { files: Record<string, string> };
  const tasks = [
    {
      ...task,
      fake: {
        files: { ...overlay.files, "README.md": "out of scope\n" },
        exitCode: 0,
        delayMs: 1,
        stdout: "scope probe",
        stderr: "",
      },
    },
    {
      ...task,
      id: `${task.id}-validator-infrastructure`,
      validation: [`${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.exit(2)")}`],
      fake: {
        files: {},
        exitCode: 0,
        delayMs: 1,
        stdout: "validator probe",
        stderr: "",
      },
    },
  ];
  const config: ExperimentConfig = {
    repository,
    taskFile: manifestPath,
    tasks,
    workerCounts: [1],
    repetitions: 1,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "runs"),
    budget: {},
    seed: 2,
    integration: false,
    integrationValidation: [],
  };
  const execution = await runExperiment(config);
  const inspection = await inspectExperiment(execution.directory);
  const results = await Promise.all(
    inspection.runResults.map(
      async (path) =>
        JSON.parse(await readFile(path, "utf8")) as {
          taskId: string;
          runState: string;
          accepted: boolean;
          failureClassification: string | null;
        },
    ),
  );
  expect(results.find((result) => result.taskId === task.id)).toMatchObject({
    runState: "rejected",
    accepted: false,
    failureClassification: "editable_scope_violation:README.md",
  });
  expect(
    results.find((result) => result.taskId.endsWith("validator-infrastructure")),
  ).toMatchObject({
    runState: "infrastructure_failed",
    accepted: false,
    failureClassification: "validator_infrastructure_failure",
  });
}, 60_000);
