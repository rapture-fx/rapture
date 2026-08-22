import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  applyKnownGoodPatch,
  BenchmarkIntegrityError,
  benchmarkTasksForRepository,
  loadBenchmarkSuite,
  materializeBenchmarkRepository,
  runBenchmarkDoctor,
  runBenchmarkValidator,
  verifyBenchmarkAssets,
} from "../src/benchmark.js";
import { runExperiment } from "../src/experiment.js";
import { runGit } from "../src/git.js";
import type { ExperimentConfig } from "../src/models.js";
import { inspectExperiment } from "../src/report.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const suiteRoot = join(workspaceRoot, "benchmarks/real-work-v1");
const manifestPath = join(suiteRoot, "manifest.json");
const execFileAsync = promisify(execFile);

const taskIds = [
  "semver-diff-release-type",
  "semver-coerce-options",
  "semver-lru-cache-eviction",
  "semver-range-test-repair",
] as const;

async function materialize(prefix: string): Promise<{ root: string; repository: string }> {
  const suite = await loadBenchmarkSuite(manifestPath);
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repository = join(root, "semver-core");
  await materializeBenchmarkRepository({
    manifestPath,
    suite,
    repositoryId: "semver-core",
    destination: repository,
  });
  return { root, repository };
}

async function filesBelow(root: string, current = root): Promise<readonly string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(root, path)));
    else files.push(path);
  }
  return files;
}

describe("real-work v1 upstream-derived suite", () => {
  it("records upstream provenance and an integrity-protected transformation log", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    expect(suite.id).toBe("rapture-real-work-v1");
    expect(suite.repositories).toHaveLength(1);
    expect(suite.tasks.map((task) => task.id)).toEqual([...taskIds]);
    expect(new Set(suite.tasks.map((task) => task.class))).toEqual(
      new Set(["bug_fix", "small_feature", "refactor", "test_repair"]),
    );

    const [repository] = suite.repositories;
    if (repository === undefined) throw new Error("repository missing");
    const source = repository.source;
    if (source.type !== "upstream_derived") throw new Error("expected an upstream-derived source");
    expect(source.upstreamUrl).toBe("https://github.com/npm/node-semver");
    expect(source.upstreamRevision).toBe("6e05b7637396ac66522cff8731f07cfe0ef49a29");
    expect(source.upstreamRef).toBe("v7.8.5");
    // A reduced snapshot must never be advertised as an exact copy of upstream.
    expect(source.snapshot).toBe("minimized_derived_snapshot");
    expect(repository.license.spdx).toBe("ISC");
    expect(repository.installCommand).toEqual([]);

    // The provenance sidecar is hashed by the manifest, so the transformation log cannot
    // drift away from the fixture it describes.
    expect(suite.integrity.protectedAssets[source.provenancePath]).toMatch(/^[a-f0-9]{64}$/u);
    const provenance = JSON.parse(
      await readFile(join(suiteRoot, source.provenancePath), "utf8"),
    ) as {
      snapshot: { upstreamSourceSha256: string };
      transformations: readonly { kind: string; taskId?: string }[];
    };
    expect(provenance.snapshot.upstreamSourceSha256).toBe(source.upstreamSourceSha256);
    const injected = provenance.transformations
      .filter((item) => item.kind === "baseline_defect_injection" || item.kind === "test_addition")
      .map((item) => item.taskId);
    expect(new Set(injected)).toEqual(new Set(taskIds));
  });

  it("fails closed when the provenance sidecar is not integrity-protected", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const [repository] = suite.repositories;
    if (repository === undefined) throw new Error("repository missing");
    const source = repository.source;
    if (source.type !== "upstream_derived") throw new Error("expected an upstream-derived source");
    const unprotected = Object.fromEntries(
      Object.entries(suite.integrity.protectedAssets).filter(
        ([path]) => path !== source.provenancePath,
      ),
    );
    await expect(
      verifyBenchmarkAssets(manifestPath, {
        ...suite,
        integrity: { ...suite.integrity, protectedAssets: unprotected },
      }),
    ).rejects.toBeInstanceOf(BenchmarkIntegrityError);
  });

  it("proves baseline rejection and known-good acceptance twice for every task", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const { root, repository } = await materialize("rapture-v1-proof-");
    try {
      for (const task of suite.tasks) {
        const baseline = [
          await runBenchmarkValidator({ manifestPath, task, repository }),
          await runBenchmarkValidator({ manifestPath, task, repository }),
        ];
        expect(
          baseline.map((item) => item.classification),
          `${task.id} baseline`,
        ).toEqual(["rejected", "rejected"]);

        await applyKnownGoodPatch({ manifestPath, task, repository });
        const knownGood = [
          await runBenchmarkValidator({ manifestPath, task, repository }),
          await runBenchmarkValidator({ manifestPath, task, repository }),
        ];
        expect(
          knownGood.map((item) => item.classification),
          `${task.id} known-good`,
        ).toEqual(["accepted", "accepted"]);

        await runGit(repository, ["reset", "--hard", suite.repositories[0]?.baseRevision ?? ""]);
        await runGit(repository, ["clean", "-fd"]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);

  it("keeps known-good solutions unreadable from the agent execution worktree", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const { root, repository } = await materialize("rapture-v1-isolation-");
    try {
      const overlays = await Promise.all(
        suite.tasks.map(async (task) => {
          const overlay = JSON.parse(
            await readFile(join(suiteRoot, task.knownGoodPatch.path), "utf8"),
          ) as { files: Record<string, string> };
          return { taskId: task.id, files: overlay.files };
        }),
      );

      const worktreeFiles = await filesBelow(repository);
      const nonGit = worktreeFiles.filter((path) => !relative(repository, path).startsWith(".git"));

      // 1. Nothing inside the worktree escapes it, so no path can reach the suite directory.
      for (const path of nonGit) {
        const stats = await lstat(path);
        expect(stats.isSymbolicLink(), `${path} must not be a symlink`).toBe(false);
        expect(resolve(path).startsWith(`${resolve(repository)}/`)).toBe(true);
      }

      // 2. Known-good assets, validators, and the manifest live outside the worktree.
      for (const asset of [
        manifestPath,
        join(suiteRoot, "provenance.json"),
        ...suite.tasks.map((task) => join(suiteRoot, task.knownGoodPatch.path)),
        ...suite.tasks.map((task) => join(suiteRoot, task.validator.path)),
      ]) {
        expect(resolve(asset).startsWith(`${resolve(repository)}/`)).toBe(false);
      }

      // 3. No solution text is present anywhere in the worktree, including .git objects.
      const contents = await Promise.all(
        worktreeFiles.map(async (path) => (await readFile(path)).toString("utf8")),
      );
      for (const overlay of overlays) {
        for (const [path, solution] of Object.entries(overlay.files)) {
          // Only lines that distinguish the solution from the frozen baseline matter; lines
          // the two share are, by construction, already visible to the agent.
          const baseline = await readFile(join(repository, path), "utf8");
          const needles = solution
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length >= 20 && !baseline.includes(line));
          expect(
            needles.length,
            `${overlay.taskId} needs solution lines absent from the baseline`,
          ).toBeGreaterThan(0);
          const leaked = needles.filter((needle) =>
            contents.some((content) => content.includes(needle)),
          );
          expect(leaked, `${overlay.taskId} solution for ${path} leaked into the worktree`).toEqual(
            [],
          );
        }
      }

      // 4. A process confined to the worktree cannot resolve the suite directory.
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "-e",
          "process.stdout.write(require('node:fs').existsSync('known-good') + ',' + require('node:fs').existsSync('validators'))",
        ],
        { cwd: repository },
      );
      expect(stdout).toBe("false,false");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects edits outside a task's editable scope", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const { root, repository } = await materialize("rapture-v1-scope-");
    try {
      const tasks = benchmarkTasksForRepository({
        manifestPath,
        suite,
        repositoryId: "semver-core",
      });
      const task = tasks.find((item) => item.id === "semver-lru-cache-eviction");
      if (task === undefined) throw new Error("task missing");
      const overlay = JSON.parse(
        await readFile(join(suiteRoot, "known-good/semver-lru-cache.json"), "utf8"),
      ) as { files: Record<string, string> };

      const config: ExperimentConfig = {
        repository,
        taskFile: manifestPath,
        tasks: [
          {
            ...task,
            id: "in-scope",
            fake: { files: overlay.files, exitCode: 0, delayMs: 1, stdout: "", stderr: "" },
          },
          {
            ...task,
            id: "out-of-scope",
            fake: {
              files: { ...overlay.files, "README.md": "scope probe\n" },
              exitCode: 0,
              delayMs: 1,
              stdout: "",
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
      const runs = await Promise.all(
        inspection.runResults.map(
          async (path) =>
            JSON.parse(await readFile(path, "utf8")) as {
              taskId: string;
              runState: string;
              failureClassification: string | null;
            },
        ),
      );
      const inScope = runs.find((run) => run.taskId === "in-scope");
      const outOfScope = runs.find((run) => run.taskId === "out-of-scope");
      expect(inScope?.runState).toBe("accepted");
      expect(outOfScope?.runState).toBe("rejected");
      expect(outOfScope?.failureClassification).toBe("editable_scope_violation:README.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("reports benchmark readiness from complete proofs", async () => {
    const result = await runBenchmarkDoctor({
      manifestPath,
      requireCleanSource: false,
      repetitions: 1,
    });
    expect(result.checks.filter((check) => check.status === "BLOCKED")).toEqual([]);
    expect(result.status).toBe("PASS");
    expect(result.checks.filter((check) => check.id.startsWith("PROOF_"))).toHaveLength(4);
  }, 300_000);

  it("regenerates a byte-identical manifest from the fixture on disk", async () => {
    const before = await readFile(manifestPath, "utf8");
    const workspace = await mkdtemp(join(tmpdir(), "rapture-v1-regen-"));
    try {
      await execFileAsync(process.execPath, ["scripts/real-work-v1/build-manifest.mjs"], {
        cwd: workspaceRoot,
      });
      const after = await readFile(manifestPath, "utf8");
      if (after !== before) await writeFile(manifestPath, before, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120_000);
});
