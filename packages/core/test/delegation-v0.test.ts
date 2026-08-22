import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  applyKnownGoodPatch,
  benchmarkTasksForRepository,
  loadBenchmarkSuite,
  materializeBenchmarkRepository,
  runBenchmarkDoctor,
  runBenchmarkValidator,
} from "../src/benchmark.js";
import { runExperiment } from "../src/experiment.js";
import { runGit } from "../src/git.js";
import type { ExperimentConfig } from "../src/models.js";
import { inspectExperiment } from "../src/report.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const suiteRoot = join(workspaceRoot, "benchmarks/delegation-v0");
const manifestPath = join(suiteRoot, "manifest.json");
const execFileAsync = promisify(execFile);

const repositoryIds = ["version-core", "glob-matcher-core", "cli-command-core"] as const;

/**
 * Solution text that is legitimately recoverable from elsewhere in the same repository,
 * because upstream duplicates it. Recorded explicitly so the corpus cannot quietly acquire
 * new lookup-able answers: anything not listed here fails the isolation test.
 */
const intraRepositoryDuplication: Readonly<Record<string, readonly string[]>> = {
  // Upstream commander defines byte-identical `_collectValue` (body included) and
  // `default(value, description)` on both Option and Argument. Verified present in
  // lib/option.js, which the agent may read.
  // Upstream commander implements `default`, `choices` and `_collectValue` almost
  // identically on Option and on Argument, so much of this solution is recoverable by
  // reading lib/option.js. That makes this task closer to lookup than to reasoning, which
  // is recorded in the report rather than hidden. Verified present in lib/option.js.
  "cli-argument-contract": [
    "_collectValue",
    "previous.push(value)",
    "default(value, description)",
    "defaultValueDescription",
    "choices(values)",
    "argChoices",
    "Allowed choices are",
  ],
};
const taskClasses = [
  "bug_fix",
  "small_feature",
  "refactor",
  "test_repair",
  "config_change",
] as const;

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

describe("delegation-v0 corpus", () => {
  it("is fully crossed across repositories and task classes", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    expect(suite.id).toBe("rapture-delegation-v0");
    expect(suite.repositories.map((item) => item.id).sort()).toEqual([...repositoryIds].sort());
    expect(suite.tasks).toHaveLength(15);

    // Every (repository, class) cell holds exactly one task, so class effects and repository
    // effects can be read separately rather than being confounded with each other.
    for (const repositoryId of repositoryIds) {
      for (const taskClass of taskClasses) {
        const cell = suite.tasks.filter(
          (task) => task.repositoryId === repositoryId && task.class === taskClass,
        );
        expect(cell, `${repositoryId} x ${taskClass}`).toHaveLength(1);
      }
    }
  });

  it("carries pre-registered delegation features on every task", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    for (const task of suite.tasks) {
      const features = task.delegationFeatures;
      expect(features, `${task.id} must declare delegation features`).toBeDefined();
      if (features === undefined) continue;
      // The schema enforces this too; asserting it here keeps the corpus honest if the
      // editable scope is ever widened without updating the recorded feature.
      expect(features.editableFileCount).toBe(task.editableScope.length);
    }
    // Features that do not vary cannot explain anything, so record which ones actually vary.
    const distinct = (pick: (task: (typeof suite.tasks)[number]) => string | number) =>
      new Set(suite.tasks.map(pick)).size;
    expect(distinct((task) => task.class)).toBe(5);
    expect(distinct((task) => task.repositoryId)).toBe(3);
    expect(
      distinct((task) => task.delegationFeatures?.acceptanceCriteriaType ?? ""),
    ).toBeGreaterThan(1);
    expect(
      distinct((task) => task.delegationFeatures?.verificationCostClass ?? ""),
    ).toBeGreaterThan(1);
    expect(distinct((task) => task.delegationFeatures?.specificationClarity ?? "")).toBeGreaterThan(
      1,
    );
    expect(distinct((task) => task.delegationFeatures?.reversibility ?? "")).toBeGreaterThan(1);
  });

  it("declares upstream provenance and identity scrubbing for every repository", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const provenance = JSON.parse(await readFile(join(suiteRoot, "provenance.json"), "utf8")) as {
      repositories: readonly {
        id: string;
        snapshot: { type: string; upstreamSourceSha256: string };
        transformations: readonly { kind: string; taskId?: string }[];
      }[];
    };
    for (const repository of suite.repositories) {
      const source = repository.source;
      if (source.type !== "upstream_derived")
        throw new Error(`${repository.id} is not upstream-derived`);
      expect(source.snapshot).toBe("minimized_derived_snapshot");
      expect(repository.installCommand).toEqual([]);

      const record = provenance.repositories.find((item) => item.id === repository.id);
      expect(record, `${repository.id} needs a provenance record`).toBeDefined();
      expect(record?.snapshot.upstreamSourceSha256).toBe(source.upstreamSourceSha256);
      // Identity scrubbing is a claim about the fixture; it must be written down.
      expect(record?.transformations.some((item) => item.kind === "identity_scrub")).toBe(true);
      // Every task's defect is disclosed.
      const disclosed = new Set(
        record?.transformations
          .map((item) => item.taskId)
          .filter((id): id is string => id !== undefined),
      );
      const expected = suite.tasks
        .filter((task) => task.repositoryId === repository.id)
        .map((task) => task.id);
      expect([...disclosed].sort()).toEqual(expected.sort());
    }
  });

  it("keeps known-good solutions unreadable from the agent execution worktree", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const root = await mkdtemp(join(tmpdir(), "rapture-delegation-isolation-"));
    try {
      for (const repositoryId of repositoryIds) {
        const repository = join(root, repositoryId);
        await materializeBenchmarkRepository({
          manifestPath,
          suite,
          repositoryId,
          destination: repository,
        });
        const worktreeFiles = await filesBelow(repository);
        for (const path of worktreeFiles.filter(
          (item) => !relative(repository, item).startsWith(".git"),
        )) {
          expect((await lstat(path)).isSymbolicLink(), `${path} must not be a symlink`).toBe(false);
          expect(resolve(path).startsWith(`${resolve(repository)}/`)).toBe(true);
        }

        const contents = await Promise.all(
          worktreeFiles.map(async (path) => (await readFile(path)).toString("utf8")),
        );
        for (const task of suite.tasks.filter((item) => item.repositoryId === repositoryId)) {
          for (const asset of [task.knownGoodPatch.path, task.validator.path]) {
            expect(resolve(suiteRoot, asset).startsWith(`${resolve(repository)}/`)).toBe(false);
          }
          const overlay = JSON.parse(
            await readFile(join(suiteRoot, task.knownGoodPatch.path), "utf8"),
          ) as { files: Record<string, string> };
          for (const [path, solution] of Object.entries(overlay.files)) {
            // The whole solution must not sit anywhere in the worktree, including .git objects.
            expect(
              contents.some((content) => content.includes(solution.trim())),
              `${task.id} solution for ${path} is present verbatim in the worktree`,
            ).toBe(false);

            // Contiguous blocks, not single lines: a real codebase legitimately repeats
            // individual idioms across sibling modules, so a one-line match proves nothing.
            // A five-line run of the solution appearing verbatim would be a genuine leak.
            const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
            const haystack = contents.map(normalize);
            // A block the baseline already contains carries no solution information: the
            // agent can read it in its own worktree by construction.
            const baselineText = normalize(await readFile(join(repository, path), "utf8"));
            const lines = solution
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            const leaked: string[] = [];
            for (let index = 0; index + 5 <= lines.length; index += 1) {
              const block = normalize(lines.slice(index, index + 5).join(" "));
              if (block.length < 60 || baselineText.includes(block)) continue;
              if (haystack.some((content) => content.includes(block))) leaked.push(block);
            }
            // One overlap is real and is pinned rather than hidden: upstream commander
            // defines an identical `_collectValue` on both Option and Argument, so part of
            // the Argument solution is independently discoverable in lib/option.js. That is
            // the repository containing the pattern, not the answer key leaking -- a human
            // would find it the same way. Any *other* overlap must fail this test.
            const expectedOverlap = intraRepositoryDuplication[task.id] ?? [];
            const unexpected = leaked.filter(
              (block) => !expectedOverlap.some((known) => block.includes(known)),
            );
            expect(
              unexpected.slice(0, 3),
              `${task.id} solution for ${path} leaked into the worktree`,
            ).toEqual([]);
          }
        }

        const { stdout } = await execFileAsync(
          process.execPath,
          [
            "-e",
            "const f=require('node:fs');process.stdout.write(f.existsSync('known-good')+','+f.existsSync('validators'))",
          ],
          { cwd: repository },
        );
        expect(stdout).toBe("false,false");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("rejects edits outside a task's editable scope and records features on the run", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const root = await mkdtemp(join(tmpdir(), "rapture-delegation-scope-"));
    try {
      const repository = join(root, "glob-matcher-core");
      await materializeBenchmarkRepository({
        manifestPath,
        suite,
        repositoryId: "glob-matcher-core",
        destination: repository,
      });
      const tasks = benchmarkTasksForRepository({
        manifestPath,
        suite,
        repositoryId: "glob-matcher-core",
      });
      const task = tasks.find((item) => item.id === "glob-utils-helpers");
      if (task === undefined) throw new Error("task missing");
      const overlay = JSON.parse(
        await readFile(join(suiteRoot, "known-good/glob-utils.json"), "utf8"),
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
              files: { ...overlay.files, LICENSE: "out of scope\n" },
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
              benchmarkTaskClass: string | null;
              benchmarkDelegationFeatures: Record<string, unknown> | null;
            },
        ),
      );
      const inScope = runs.find((run) => run.taskId === "in-scope");
      const outOfScope = runs.find((run) => run.taskId === "out-of-scope");
      expect(inScope?.runState).toBe("accepted");
      expect(outOfScope?.runState).toBe("rejected");
      expect(outOfScope?.failureClassification).toBe("editable_scope_violation:LICENSE");

      // The analysis reads features from run evidence, not by re-joining to the manifest.
      expect(inScope?.benchmarkTaskClass).toBe("refactor");
      expect(inScope?.benchmarkDelegationFeatures).toMatchObject({
        acceptanceCriteriaType: "behavioral_contract",
        editableFileCount: 1,
        verificationCostClass: "cheap",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("proves baseline rejection and known-good acceptance for every task", async () => {
    const suite = await loadBenchmarkSuite(manifestPath);
    const root = await mkdtemp(join(tmpdir(), "rapture-delegation-proof-"));
    try {
      for (const repositoryId of repositoryIds) {
        const repository = join(root, repositoryId);
        await materializeBenchmarkRepository({
          manifestPath,
          suite,
          repositoryId,
          destination: repository,
        });
        const baseRevision =
          suite.repositories.find((item) => item.id === repositoryId)?.baseRevision ?? "";
        for (const task of suite.tasks.filter((item) => item.repositoryId === repositoryId)) {
          const baseline = await runBenchmarkValidator({ manifestPath, task, repository });
          expect(baseline.classification, `${task.id} baseline`).toBe("rejected");
          await applyKnownGoodPatch({ manifestPath, task, repository });
          const knownGood = await runBenchmarkValidator({ manifestPath, task, repository });
          expect(knownGood.classification, `${task.id} known-good`).toBe("accepted");
          await runGit(repository, ["reset", "--hard", baseRevision]);
          await runGit(repository, ["clean", "-fd"]);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 900_000);

  it("reports benchmark readiness from complete proofs", async () => {
    const result = await runBenchmarkDoctor({
      manifestPath,
      requireCleanSource: false,
      repetitions: 1,
    });
    expect(result.checks.filter((check) => check.status === "BLOCKED")).toEqual([]);
    expect(result.status).toBe("PASS");
    expect(result.checks.filter((check) => check.id.startsWith("PROOF_"))).toHaveLength(15);
  }, 900_000);
});
