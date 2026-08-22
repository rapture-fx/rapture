#!/usr/bin/env node
/**
 * Regenerate benchmarks/delegation-v0/manifest.json from the fixtures, validators and
 * known-good overlays on disk.
 *
 * Every hash is derived here, including each repository's base revision, which is the
 * commit the framework's own materialization would produce. Running this on an unchanged
 * tree must be a byte-identical no-op, which is what makes a clean `git status` after
 * regeneration a usable integrity gate.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { benchmarkFingerprint, directoryFingerprint } from "../../packages/core/dist/index.js";
import { repositories, tasks } from "./tasks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suiteRoot = join(root, "benchmarks/delegation-v0");
const commitTimestamp = "2026-08-22T00:00:00Z";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashAsset = (relativePath) => sha256(readFileSync(join(suiteRoot, relativePath)));

/** Reproduce `materializeBenchmarkRepository`'s commit exactly to derive the base revision. */
function deriveBaseRevision(repository) {
  const workspace = mkdtempSync(join(tmpdir(), "rapture-delegation-base-"));
  const checkout = join(workspace, repository.id);
  try {
    cpSync(join(suiteRoot, repository.fixturePath), checkout, { recursive: true });
    const git = (args, env) =>
      execFileSync("git", args, {
        cwd: checkout,
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
    git(["init", "-q", "-b", "main"]);
    git(["add", "--all"]);
    git(
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
      { GIT_AUTHOR_DATE: commitTimestamp, GIT_COMMITTER_DATE: commitTimestamp },
    );
    return git(["rev-parse", "HEAD"]).trim();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const protectedAssets = { "provenance.json": hashAsset("provenance.json") };
for (const shared of [
  "validators/lib.mjs",
  "validators/exports-check.mjs",
  "validators/mutation-suite.mjs",
]) {
  protectedAssets[shared] = hashAsset(shared);
}
for (const task of tasks) {
  protectedAssets[task.validator] = hashAsset(task.validator);
  protectedAssets[task.knownGood] = hashAsset(task.knownGood);
}

// upstreamSourceSha256 lives in the provenance sidecar so there is one source of truth for
// what was taken from upstream; the manifest mirrors it and the sidecar is hash-protected.
const provenance = JSON.parse(readFileSync(join(suiteRoot, "provenance.json"), "utf8"));
const upstreamSourceSha256 = (repositoryId) => {
  const record = provenance.repositories.find((item) => item.id === repositoryId);
  if (record === undefined) throw new Error(`provenance.json has no record for ${repositoryId}`);
  return record.snapshot.upstreamSourceSha256;
};

const built = [];
for (const repository of repositories) {
  const fixture = await directoryFingerprint(join(suiteRoot, repository.fixturePath));
  built.push({
    id: repository.id,
    source: {
      type: "upstream_derived",
      upstreamUrl: repository.upstream.url,
      upstreamRevision: repository.upstream.revision,
      upstreamRef: repository.upstream.ref,
      acquiredAt: commitTimestamp,
      snapshot: "minimized_derived_snapshot",
      upstreamSourceSha256: upstreamSourceSha256(repository.id),
      provenancePath: "provenance.json",
      fixturePath: repository.fixturePath,
    },
    license: { spdx: repository.upstream.licenseSpdx, path: "LICENSE" },
    baseRevision: deriveBaseRevision(repository),
    materialization: {
      type: "deterministic_git_fixture",
      fixtureSha256: fixture.sha256,
      commitTimestamp,
    },
    installCommand: [],
    baselineChecks: repository.baselineChecks,
    size: { fileCount: fixture.fileCount, checkoutBytes: fixture.checkoutBytes },
  });
}

const baseRevisionOf = (repositoryId) =>
  built.find((item) => item.id === repositoryId)?.baseRevision ?? "";

const suite = {
  id: "rapture-delegation-v0",
  version: "0.1.0",
  description:
    "Three upstream-derived, identity-reduced Node.js repositories with a fully crossed corpus of five engineering task classes each, for testing whether task structure explains variation in independently verified autonomous-agent outcomes.",
  repositories: built,
  tasks: tasks.map((task) => ({
    id: task.id,
    repositoryId: task.repositoryId,
    class: task.class,
    title: task.title,
    prompt: task.prompt.join("\n"),
    baseRevision: baseRevisionOf(task.repositoryId),
    editableScope: task.editableScope,
    validator: {
      path: task.validator,
      sha256: protectedAssets[task.validator],
      timeoutMs: task.validatorTimeoutMs,
    },
    timeoutHintSeconds: 900,
    knownGoodPatch: { path: task.knownGood, sha256: protectedAssets[task.knownGood] },
    delegationFeatures: task.features,
    metadata: {
      representativeReason: task.metadata.representativeReason,
      expectedAreas: task.editableScope,
      validatorEstablishes: task.metadata.validatorEstablishes,
      limitations: task.metadata.limitations,
      baselineValidatorRuntimeMs: 0,
      cachePolicy: "disabled",
    },
  })),
  integrity: {
    algorithm: "sha256",
    protectedAssets: Object.fromEntries(Object.entries(protectedAssets).sort()),
    suiteSha256: "0".repeat(64),
  },
};

suite.integrity.suiteSha256 = benchmarkFingerprint(suite);
writeFileSync(join(suiteRoot, "manifest.json"), `${JSON.stringify(suite, null, 2)}\n`);
process.stdout.write(`${join(suiteRoot, "manifest.json")}\n`);
for (const repository of built) {
  process.stdout.write(
    `  ${repository.id.padEnd(20)} base ${repository.baseRevision} fixture ${repository.materialization.fixtureSha256.slice(0, 16)} (${repository.size.fileCount} files, ${repository.size.checkoutBytes} bytes)\n`,
  );
}
process.stdout.write(`suite ${suite.integrity.suiteSha256}\n`);
