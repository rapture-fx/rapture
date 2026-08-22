import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { sha256 } from "./artifacts.js";
import { ConfigurationError } from "./config.js";
import { resolveCommit, runGit, treeHash } from "./git.js";
import type { ProcessResult, TaskDefinition } from "./models.js";
import { runProcess } from "./process.js";

export const benchmarkTaskClasses = [
  "bug_fix",
  "small_feature",
  "refactor",
  "test_repair",
  "repository_exploration",
  "build_or_typecheck_heavy",
  "config_change",
  "api_change",
] as const;

/**
 * Pre-registered structural characteristics of a task.
 *
 * Recorded in the manifest before any agent runs, so a delegation analysis cannot invent
 * an explanatory label after seeing which tasks succeeded. Optional at the schema level so
 * that suites frozen before this existed keep parsing, and keep their fingerprints.
 */
const delegationFeaturesSchema = z
  .object({
    acceptanceCriteriaType: z.enum([
      "unit_test",
      "integration_test",
      "type_contract",
      "static_analysis",
      "behavioral_contract",
    ]),
    editableFileCount: z.number().int().positive(),
    expectedChangeBreadth: z.enum(["single_file", "multi_file_single_module", "cross_module"]),
    specificationClarity: z.enum(["explicit", "moderate", "underspecified"]),
    verificationCostClass: z.enum(["cheap", "moderate", "expensive"]),
    reversibility: z.enum(["fully_reversible", "reversible_with_review", "high_consequence"]),
  })
  .strict();

export const delegationFeatureNames = [
  "taskClass",
  "acceptanceCriteriaType",
  "expectedChangeBreadth",
  "specificationClarity",
  "verificationCostClass",
  "reversibility",
] as const;

const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !isAbsolute(value), "path must be relative")
  .refine(
    (value) => !value.split(/[\\/]/u).some((part) => part === ".." || part === ""),
    "path must not escape its root",
  );
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);

/**
 * A fixture authored inside this repository and pinned by its own revision. Suite 0.1.1
 * fixtures use this shape and must keep parsing byte-identically.
 */
const vendoredSourceSchema = z
  .object({
    type: z.literal("vendored"),
    upstreamUrl: z.string().url(),
    upstreamRevision: z.string().trim().min(1),
    fixturePath: relativePathSchema,
  })
  .strict();

/**
 * A fixture acquired from a third-party upstream repository. It carries the provenance a
 * vendored fixture does not need: what was acquired, when, whether the snapshot is exact,
 * and a fingerprint of the retained upstream bytes taken before any Rapture transformation.
 * The transformation log itself lives in the protected `provenance.json` sidecar.
 */
const upstreamDerivedSourceSchema = z
  .object({
    type: z.literal("upstream_derived"),
    upstreamUrl: z.string().url(),
    upstreamRevision: revisionSchema,
    upstreamRef: z.string().trim().min(1),
    acquiredAt: z.string().datetime({ offset: true }),
    snapshot: z.enum(["exact_vendored_snapshot", "minimized_derived_snapshot"]),
    upstreamSourceSha256: sha256Schema,
    provenancePath: relativePathSchema,
    fixturePath: relativePathSchema,
  })
  .strict();

const repositorySchema = z
  .object({
    id: z.string().trim().min(1),
    source: z.discriminatedUnion("type", [vendoredSourceSchema, upstreamDerivedSourceSchema]),
    license: z
      .object({
        spdx: z.string().trim().min(1),
        path: relativePathSchema,
      })
      .strict(),
    baseRevision: revisionSchema,
    materialization: z
      .object({
        type: z.literal("deterministic_git_fixture"),
        fixtureSha256: sha256Schema,
        commitTimestamp: z.string().datetime({ offset: true }),
      })
      .strict(),
    installCommand: z.array(z.string().min(1)),
    baselineChecks: z.array(z.array(z.string().min(1)).min(1)).min(1),
    size: z
      .object({
        fileCount: z.number().int().nonnegative(),
        checkoutBytes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const taskSchema = z
  .object({
    id: z.string().trim().min(1),
    repositoryId: z.string().trim().min(1),
    class: z.enum(benchmarkTaskClasses),
    title: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    baseRevision: revisionSchema,
    editableScope: z.array(relativePathSchema).min(1),
    validator: z
      .object({
        path: relativePathSchema,
        sha256: sha256Schema,
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    timeoutHintSeconds: z.number().int().positive(),
    knownGoodPatch: z.object({ path: relativePathSchema, sha256: sha256Schema }).strict(),
    delegationFeatures: delegationFeaturesSchema.optional(),
    metadata: z
      .object({
        representativeReason: z.string().trim().min(1),
        expectedAreas: z.array(relativePathSchema).min(1),
        validatorEstablishes: z.string().trim().min(1),
        limitations: z.string().trim().min(1),
        baselineValidatorRuntimeMs: z.number().int().nonnegative(),
        cachePolicy: z.enum(["disabled", "reset", "retained"]),
      })
      .strict(),
  })
  .strict();

export const benchmarkSuiteSchema = z
  .object({
    id: z.string().trim().min(1),
    version: z.string().trim().min(1),
    description: z.string().trim().min(1),
    repositories: z.array(repositorySchema).min(1),
    tasks: z.array(taskSchema).min(1),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        protectedAssets: z.record(relativePathSchema, sha256Schema),
        suiteSha256: sha256Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((suite, context) => {
    const repositoryIds = new Set<string>();
    suite.repositories.forEach((repository, index) => {
      if (repositoryIds.has(repository.id)) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index, "id"],
          message: `duplicate repository ID: ${repository.id}`,
        });
      }
      repositoryIds.add(repository.id);
    });
    const taskIds = new Set<string>();
    suite.tasks.forEach((task, index) => {
      if (taskIds.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `duplicate task ID: ${task.id}`,
        });
      }
      taskIds.add(task.id);
      if (!repositoryIds.has(task.repositoryId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "repositoryId"],
          message: `unknown repository ID: ${task.repositoryId}`,
        });
      }
      const repository = suite.repositories.find((item) => item.id === task.repositoryId);
      if (repository !== undefined && repository.baseRevision !== task.baseRevision) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "baseRevision"],
          message: "task baseRevision must equal its repository baseRevision",
        });
      }
      if (
        task.delegationFeatures !== undefined &&
        task.delegationFeatures.editableFileCount !== task.editableScope.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "delegationFeatures", "editableFileCount"],
          message: `editableFileCount ${task.delegationFeatures.editableFileCount} must equal the editable scope size ${task.editableScope.length}`,
        });
      }
    });
  });

export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;
export type BenchmarkRepository = BenchmarkSuite["repositories"][number];
export type BenchmarkTask = BenchmarkSuite["tasks"][number];
export type BenchmarkTaskClass = BenchmarkTask["class"];

export class BenchmarkIntegrityError extends Error {
  public override readonly name = "BenchmarkIntegrityError";
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function benchmarkFingerprint(suite: BenchmarkSuite): string {
  const { suiteSha256: _suiteSha256, ...integrity } = suite.integrity;
  return sha256(canonical({ ...suite, integrity }));
}

export function parseBenchmarkSuite(value: unknown): BenchmarkSuite {
  const parsed = benchmarkSuiteSchema.safeParse(value);
  if (!parsed.success) throw new ConfigurationError(z.prettifyError(parsed.error));
  const fingerprint = benchmarkFingerprint(parsed.data);
  if (fingerprint !== parsed.data.integrity.suiteSha256) {
    throw new BenchmarkIntegrityError(
      `benchmark manifest fingerprint mismatch: expected ${parsed.data.integrity.suiteSha256}, got ${fingerprint}`,
    );
  }
  return parsed.data;
}

export async function loadBenchmarkSuite(path: string): Promise<BenchmarkSuite> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  } catch (error: unknown) {
    throw new ConfigurationError(
      `unable to read benchmark manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseBenchmarkSuite(value);
}

function inside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function assetPath(manifestPath: string, path: string): string {
  const root = dirname(resolve(manifestPath));
  const candidate = resolve(root, path);
  if (!inside(root, candidate))
    throw new BenchmarkIntegrityError(`asset escaped suite root: ${path}`);
  return candidate;
}

async function filesBelow(root: string, current = root): Promise<readonly string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git") continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else throw new BenchmarkIntegrityError(`unsupported fixture entry: ${path}`);
  }
  return files;
}

export async function directoryFingerprint(root: string): Promise<{
  readonly sha256: string;
  readonly fileCount: number;
  readonly checkoutBytes: number;
}> {
  const files = await filesBelow(root);
  let checkoutBytes = 0;
  const entries = [];
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    checkoutBytes += bytes.byteLength;
    entries.push({ path, sha256: sha256(bytes) });
  }
  return { sha256: sha256(canonical(entries)), fileCount: files.length, checkoutBytes };
}

async function verifyFile(path: string, expected: string): Promise<void> {
  const actual = sha256(await readFile(path));
  if (actual !== expected) {
    throw new BenchmarkIntegrityError(
      `asset drift for ${path}: expected ${expected}, got ${actual}`,
    );
  }
}

export async function verifyBenchmarkAssets(
  manifestPath: string,
  suite: BenchmarkSuite,
): Promise<void> {
  for (const [path, expected] of Object.entries(suite.integrity.protectedAssets)) {
    await verifyFile(assetPath(manifestPath, path), expected);
  }
  for (const repository of suite.repositories) {
    const fixture = assetPath(manifestPath, repository.source.fixturePath);
    const actual = await directoryFingerprint(fixture);
    if (actual.sha256 !== repository.materialization.fixtureSha256) {
      throw new BenchmarkIntegrityError(`fixture drift for ${repository.id}`);
    }
    if (
      actual.fileCount !== repository.size.fileCount ||
      actual.checkoutBytes !== repository.size.checkoutBytes
    ) {
      throw new BenchmarkIntegrityError(`fixture size drift for ${repository.id}`);
    }
    await stat(
      assetPath(manifestPath, join(repository.source.fixturePath, repository.license.path)),
    );
    if (repository.source.type === "upstream_derived") {
      const provenancePath = repository.source.provenancePath;
      const expected = suite.integrity.protectedAssets[provenancePath];
      if (expected === undefined) {
        throw new BenchmarkIntegrityError(
          `upstream provenance is not integrity-protected: ${provenancePath}`,
        );
      }
      await verifyFile(assetPath(manifestPath, provenancePath), expected);
    }
  }
  for (const task of suite.tasks) {
    await verifyFile(assetPath(manifestPath, task.validator.path), task.validator.sha256);
    await verifyFile(assetPath(manifestPath, task.knownGoodPatch.path), task.knownGoodPatch.sha256);
    const fixtureRoot = assetPath(
      manifestPath,
      suite.repositories.find((item) => item.id === task.repositoryId)?.source.fixturePath ??
        "missing",
    );
    for (const path of task.editableScope) {
      const candidate = resolve(fixtureRoot, path);
      if (!inside(fixtureRoot, candidate))
        throw new BenchmarkIntegrityError(`unsafe editable scope: ${path}`);
    }
    if (inside(fixtureRoot, assetPath(manifestPath, task.validator.path))) {
      throw new BenchmarkIntegrityError(`validator is inside editable fixture: ${task.id}`);
    }
  }
}

export async function materializeBenchmarkRepository(input: {
  readonly manifestPath: string;
  readonly suite: BenchmarkSuite;
  readonly repositoryId: string;
  readonly destination: string;
}): Promise<string> {
  const repository = input.suite.repositories.find((item) => item.id === input.repositoryId);
  if (repository === undefined)
    throw new ConfigurationError(`unknown repository: ${input.repositoryId}`);
  await verifyBenchmarkAssets(input.manifestPath, input.suite);
  try {
    await stat(input.destination);
    throw new BenchmarkIntegrityError(
      `materialization destination already exists: ${input.destination}`,
    );
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await cp(assetPath(input.manifestPath, repository.source.fixturePath), input.destination, {
    recursive: true,
    errorOnExist: true,
  });
  await runProcess("git", ["init", "-q", "-b", "main"], {
    cwd: input.destination,
    timeoutMs: 30_000,
  });
  await runGit(input.destination, ["add", "--all"]);
  const committed = await runProcess(
    "git",
    [
      "-c",
      "user.name=Rapture Benchmark",
      "-c",
      "user.email=benchmark@invalid.example",
      "commit",
      "-q",
      "-m",
      `benchmark base: ${repository.id}`,
    ],
    {
      cwd: input.destination,
      timeoutMs: 30_000,
      env: {
        GIT_AUTHOR_DATE: repository.materialization.commitTimestamp,
        GIT_COMMITTER_DATE: repository.materialization.commitTimestamp,
      },
    },
  );
  if (committed.exitCode !== 0) throw new BenchmarkIntegrityError(committed.stderr.trim());
  const actual = await resolveCommit(input.destination, "HEAD");
  if (actual !== repository.baseRevision) {
    throw new BenchmarkIntegrityError(
      `base revision drift for ${repository.id}: expected ${repository.baseRevision}, got ${actual}`,
    );
  }
  return input.destination;
}

const overlaySchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z
      .record(relativePathSchema, z.string())
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();

export async function applyKnownGoodPatch(input: {
  readonly manifestPath: string;
  readonly task: BenchmarkTask;
  readonly repository: string;
}): Promise<void> {
  const path = assetPath(input.manifestPath, input.task.knownGoodPatch.path);
  await verifyFile(path, input.task.knownGoodPatch.sha256);
  const overlay = overlaySchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  for (const [relativePath, content] of Object.entries(overlay.files)) {
    if (!input.task.editableScope.includes(relativePath)) {
      throw new BenchmarkIntegrityError(`known-good patch escapes editable scope: ${relativePath}`);
    }
    const target = resolve(input.repository, relativePath);
    if (!inside(resolve(input.repository), target))
      throw new BenchmarkIntegrityError("patch escaped repository");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

export type BenchmarkValidatorClassification = "accepted" | "rejected" | "infrastructure_failure";
export interface BenchmarkValidatorResult {
  readonly classification: BenchmarkValidatorClassification;
  readonly process: ProcessResult | null;
  readonly detail: string;
}

export async function runBenchmarkValidator(input: {
  readonly manifestPath: string;
  readonly task: BenchmarkTask;
  readonly repository: string;
}): Promise<BenchmarkValidatorResult> {
  try {
    const validator = assetPath(input.manifestPath, input.task.validator.path);
    await verifyFile(validator, input.task.validator.sha256);
    if (inside(resolve(input.repository), validator)) {
      return {
        classification: "infrastructure_failure",
        process: null,
        detail: "validator entered candidate repository",
      };
    }
    const processResult = await runProcess(
      process.execPath,
      [validator, resolve(input.repository)],
      {
        cwd: dirname(resolve(input.manifestPath)),
        timeoutMs: input.task.validator.timeoutMs,
      },
    );
    if (processResult.timedOut) {
      return {
        classification: "infrastructure_failure",
        process: processResult,
        detail: "validator timed out",
      };
    }
    if (processResult.exitCode === 0) {
      return {
        classification: "accepted",
        process: processResult,
        detail: "validator accepted task",
      };
    }
    if (processResult.exitCode === 1) {
      return {
        classification: "rejected",
        process: processResult,
        detail: "validator rejected task",
      };
    }
    return {
      classification: "infrastructure_failure",
      process: processResult,
      detail: `validator exited ${processResult.exitCode ?? "without status"}`,
    };
  } catch (error: unknown) {
    return {
      classification: "infrastructure_failure",
      process: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function benchmarkTasksForRepository(input: {
  readonly manifestPath: string;
  readonly suite: BenchmarkSuite;
  readonly repositoryId: string;
}): readonly TaskDefinition[] {
  return input.suite.tasks
    .filter((task) => task.repositoryId === input.repositoryId)
    .map((task) => {
      const validator = assetPath(input.manifestPath, task.validator.path);
      return {
        id: task.id,
        description: task.prompt,
        baseCommit: task.baseRevision,
        validation: [`${JSON.stringify(process.execPath)} ${JSON.stringify(validator)} .`],
        timeoutSeconds: task.timeoutHintSeconds,
        independent: true,
        dependsOn: [],
        benchmark: {
          suiteId: input.suite.id,
          suiteVersion: input.suite.version,
          repositoryId: task.repositoryId,
          editableScope: task.editableScope,
          taskClass: task.class,
          ...(task.delegationFeatures === undefined
            ? {}
            : { delegationFeatures: task.delegationFeatures }),
        },
      };
    });
}

export type BenchmarkCheckStatus = "PASS" | "WARNING" | "BLOCKED";
export interface BenchmarkDoctorCheck {
  readonly id: string;
  readonly status: BenchmarkCheckStatus;
  readonly message: string;
}
export interface BenchmarkDoctorResult {
  readonly status: BenchmarkCheckStatus;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly checks: readonly BenchmarkDoctorCheck[];
}

export async function runBenchmarkDoctor(input: {
  readonly manifestPath: string;
  readonly requireCleanSource?: boolean;
  readonly repetitions?: number;
}): Promise<BenchmarkDoctorResult> {
  const suite = await loadBenchmarkSuite(input.manifestPath);
  const checks: BenchmarkDoctorCheck[] = [];
  try {
    await verifyBenchmarkAssets(input.manifestPath, suite);
    checks.push({
      id: "BENCHMARK_INTEGRITY",
      status: "PASS",
      message: "manifest and protected asset hashes match",
    });
  } catch (error: unknown) {
    checks.push({
      id: "BENCHMARK_INTEGRITY",
      status: "BLOCKED",
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: "BLOCKED", suiteId: suite.id, suiteVersion: suite.version, checks };
  }
  if (input.requireCleanSource ?? true) {
    const workspace = dirname(dirname(dirname(resolve(input.manifestPath))));
    const statusResult = await runGit(
      workspace,
      ["status", "--porcelain", "--", relative(workspace, dirname(resolve(input.manifestPath)))],
      { allowFailure: true },
    );
    checks.push(
      statusResult.exitCode === 0 && statusResult.stdout.trim() === ""
        ? { id: "SOURCE_TREE", status: "PASS", message: "benchmark source tree is clean" }
        : {
            id: "SOURCE_TREE",
            status: "BLOCKED",
            message: "benchmark source tree is dirty or unavailable",
          },
    );
  }
  const root = await mkdtemp(join(tmpdir(), "rapture-benchmark-doctor-"));
  const repetitions = input.repetitions ?? 2;
  try {
    for (const repository of suite.repositories) {
      try {
        const materialized = join(root, repository.id);
        await materializeBenchmarkRepository({
          manifestPath: input.manifestPath,
          suite,
          repositoryId: repository.id,
          destination: materialized,
        });
        const actualTree = await treeHash(materialized);
        checks.push({
          id: `MATERIALIZE_${repository.id}`,
          status: "PASS",
          message: `base ${repository.baseRevision} tree ${actualTree}`,
        });
        let baselineToolchainReady = true;
        for (const command of repository.baselineChecks) {
          const executable = command[0];
          if (executable === undefined) throw new BenchmarkIntegrityError("empty baseline check");
          const result = await runProcess(executable, command.slice(1), {
            cwd: materialized,
            timeoutMs: 30_000,
          });
          if (result.timedOut || result.exitCode !== 0) baselineToolchainReady = false;
        }
        checks.push({
          id: `TOOLCHAIN_${repository.id}`,
          status: baselineToolchainReady ? "PASS" : "BLOCKED",
          message: baselineToolchainReady
            ? "repository baseline checks are runnable"
            : "repository baseline checks failed or timed out",
        });
        if (!baselineToolchainReady) continue;
        for (const task of suite.tasks.filter((item) => item.repositoryId === repository.id)) {
          const baseline = [];
          for (let index = 0; index < repetitions; index += 1)
            baseline.push(
              (
                await runBenchmarkValidator({
                  manifestPath: input.manifestPath,
                  task,
                  repository: materialized,
                })
              ).classification,
            );
          if (baseline.some((item) => item !== "rejected")) {
            checks.push({
              id: `PROOF_${task.id}`,
              status: "BLOCKED",
              message: `baseline proof failed: ${baseline.join(",")}`,
            });
            continue;
          }
          await applyKnownGoodPatch({
            manifestPath: input.manifestPath,
            task,
            repository: materialized,
          });
          const knownGood = [];
          for (let index = 0; index < repetitions; index += 1)
            knownGood.push(
              (
                await runBenchmarkValidator({
                  manifestPath: input.manifestPath,
                  task,
                  repository: materialized,
                })
              ).classification,
            );
          checks.push(
            knownGood.every((item) => item === "accepted")
              ? {
                  id: `PROOF_${task.id}`,
                  status: "PASS",
                  message: `baseline rejected and known-good accepted ${repetitions}/${repetitions}`,
                }
              : {
                  id: `PROOF_${task.id}`,
                  status: "BLOCKED",
                  message: `known-good proof failed: ${knownGood.join(",")}`,
                },
          );
          await runGit(materialized, ["reset", "--hard", repository.baseRevision]);
          await runGit(materialized, ["clean", "-fd"]);
        }
      } catch (error: unknown) {
        checks.push({
          id: `RUNTIME_${repository.id}`,
          status: "BLOCKED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const status: BenchmarkCheckStatus = checks.some((item) => item.status === "BLOCKED")
    ? "BLOCKED"
    : checks.some((item) => item.status === "WARNING")
      ? "WARNING"
      : "PASS";
  return { status, suiteId: suite.id, suiteVersion: suite.version, checks };
}
