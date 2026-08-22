#!/usr/bin/env node

/**
 * Regenerate benchmarks/real-work-v1/manifest.json from the fixture, validators, and
 * known-good overlays on disk.
 *
 * Every hash in the manifest is derived here, including the base revision, which is the
 * commit produced by materializing the fixture with the framework's fixed identity and
 * timestamp. Running this script on an unchanged tree must be a no-op; that property is
 * what makes `git status` clean after regeneration a usable integrity gate.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { benchmarkFingerprint, directoryFingerprint } from "../../packages/core/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suiteRoot = join(root, "benchmarks/real-work-v1");
const fixturePath = "fixtures/semver-core";
const commitTimestamp = "2026-08-22T00:00:00Z";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashAsset = (relativePath) => sha256(readFileSync(join(suiteRoot, relativePath)));

/** Reproduce `materializeBenchmarkRepository`'s commit exactly to derive the base revision. */
function deriveBaseRevision(repositoryId) {
  const workspace = mkdtempSync(join(tmpdir(), "rapture-real-work-v1-base-"));
  const checkout = join(workspace, repositoryId);
  try {
    cpSync(join(suiteRoot, fixturePath), checkout, { recursive: true });
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
        `benchmark base: ${repositoryId}`,
      ],
      { GIT_AUTHOR_DATE: commitTimestamp, GIT_COMMITTER_DATE: commitTimestamp },
    );
    return git(["rev-parse", "HEAD"]).trim();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const tasks = [
  {
    id: "semver-diff-release-type",
    class: "bug_fix",
    title: "Restore prerelease-aware release-type diffing",
    prompt: [
      "`semver.diff(a, b)` reports which release type separates two versions. Transitions out of a",
      "prerelease are currently reported incorrectly: for example `diff('1.0.0-1', '1.0.0')` returns",
      "'prerelease' when it must return 'major', and `diff('1.1.0-1', '1.1.0')` must return 'minor'.",
      "",
      "Fix `functions/diff.js` so that:",
      "- identical versions, and versions differing only in build metadata, return null;",
      "- ordinary release steps return 'major' / 'minor' / 'patch';",
      "- a step *into* a prerelease keeps the 'pre' prefix ('premajor' / 'preminor' / 'prepatch');",
      "- two prereleases of the same main version return 'prerelease';",
      "- a step *out of* a prerelease is classified by how much of the main version is actually",
      "  being left behind: leaving a prerelease whose minor and patch are both zero is always a",
      "  'major' step, and when the main version is otherwise unchanged the answer is 'minor' if the",
      "  minor is non-zero and the patch is zero, otherwise 'patch';",
      "- the result does not depend on argument order;",
      "- invalid version strings still raise a TypeError.",
      "",
      "Read `classes/semver.js` for `compare` and `compareMain` before changing anything.",
    ].join("\n"),
    editableScope: ["functions/diff.js"],
    validator: "validators/semver-diff.mjs",
    knownGood: "known-good/semver-diff.json",
    validatorTimeoutMs: 60_000,
    timeoutHintSeconds: 900,
    metadata: {
      representativeReason:
        "Release-type classification across prerelease boundaries is real upstream logic that has been the subject of multiple upstream bug reports; it requires reasoning about SemVer.compare and compareMain rather than editing one expression.",
      expectedAreas: ["functions/diff.js"],
      validatorEstablishes:
        "A 22-pair release-type table covering equality, build metadata, ordinary steps, pre-prefixed steps, prerelease-to-prerelease, and every prerelease-to-release shape, asserted in both argument orders, plus TypeError on invalid input.",
      limitations:
        "Does not cover loose parsing, the includePrerelease option, or versions outside the safe integer range.",
      baselineValidatorRuntimeMs: 200,
      cachePolicy: "disabled",
    },
  },
  {
    id: "semver-coerce-options",
    class: "small_feature",
    title: "Add rtl and includePrerelease coercion options",
    prompt: [
      "`semver.coerce(version, options)` currently supports only plain left-to-right coercion of the",
      "major/minor/patch triple. The documented `rtl` and `includePrerelease` options are missing.",
      "",
      "Extend `functions/coerce.js` so that:",
      "- `{ rtl: true }` coerces the right-most coercible triple that does not share a terminus with a",
      "  more left-ward one, so '1.2.3.4' coerces to '2.3.4' and '1.2.3.4.5' to '3.4.5';",
      "- `{ includePrerelease: true }` carries prerelease identifiers and build metadata through, so",
      "  '1.2.3-alpha.1+build.2' coerces to a version with prerelease alpha.1 and build ['build','2'];",
      "- the two options compose: coerce('1.2.3.4-rc', { rtl: true, includePrerelease: true }) is",
      "  '2.3.4-rc';",
      "- existing no-option behaviour is unchanged, including SemVer passthrough, numeric input, and",
      "  null for uncoercible or non-string input;",
      "- repeated calls return the same answer (a global regular expression must not leak lastIndex).",
      "",
      "`internal/re.js` already defines the tokens you need; find them before writing code.",
    ].join("\n"),
    editableScope: ["functions/coerce.js"],
    validator: "validators/semver-coerce.mjs",
    knownGood: "known-good/semver-coerce.json",
    validatorTimeoutMs: 60_000,
    timeoutHintSeconds: 900,
    metadata: {
      representativeReason:
        "Adding documented option handling to an existing public function is ordinary library feature work, and the right-to-left variant cannot be written without reading the shared regular-expression table in another file.",
      expectedAreas: ["functions/coerce.js"],
      validatorEstablishes:
        "Preserved no-option coercion, right-to-left coercion, prerelease and build capture, both options combined, and call-to-call stability of the stateful regular expression.",
      limitations:
        "Does not cover the loose option, coercion of ranges, or upstream's full COERCE token surface beyond the asserted cases.",
      baselineValidatorRuntimeMs: 200,
      cachePolicy: "disabled",
    },
  },
  {
    id: "semver-lru-cache-eviction",
    class: "refactor",
    title: "Make the internal parse cache a bounded LRU",
    prompt: [
      "`internal/lrucache.js` is currently an unbounded Map wrapper: it declares a `max` of 1000 but",
      "never evicts, and reads do not affect retention. It backs range and version parsing (see",
      "`classes/range.js` and `internal/parse-options.js`), so on a long-lived process it grows without",
      "bound.",
      "",
      "Refactor it into a real bounded LRU cache, preserving its current interface:",
      "- `max` stays 1000 by default;",
      "- `get(key)` returns the value or undefined, and marks the key as most recently used;",
      "- `set(key, value)` returns the cache itself, and never stores an entry when value is undefined;",
      "- `delete(key)` returns whether the key was present;",
      "- once `max` entries are held, inserting a new key evicts the least recently used key, so the",
      "  cache never retains more than `max` entries no matter how much churn it sees.",
      "",
      "Library behaviour must not change: parsing many more distinct ranges than the cache can hold",
      "must still produce identical answers.",
    ].join("\n"),
    editableScope: ["internal/lrucache.js"],
    validator: "validators/semver-lru-cache.mjs",
    knownGood: "known-good/semver-lru-cache.json",
    validatorTimeoutMs: 60_000,
    timeoutHintSeconds: 900,
    metadata: {
      representativeReason:
        "Replacing a degenerate data structure with a correct one while holding an existing interface fixed, and proving the wider library still behaves, is a common maintenance refactor.",
      expectedAreas: ["internal/lrucache.js"],
      validatorEstablishes:
        "Interface preservation, undefined-value handling, eviction at capacity, recency promotion on read, a hard retention bound under 3x churn, and unchanged satisfies/validRange answers across 1500 distinct ranges.",
      limitations:
        "Does not assert re-setting an existing key, where upstream behaviour is idiosyncratic, and does not measure memory directly.",
      baselineValidatorRuntimeMs: 900,
      cachePolicy: "disabled",
    },
  },
  {
    id: "semver-range-test-repair",
    class: "test_repair",
    title: "Repair the stale range test suite",
    prompt: [
      "`test/range.test.js` is a node:test suite covering range behaviour. It was written against older",
      "expectations and now fails: run `node --test test/range.test.js` to see it.",
      "",
      "Repair the suite so that it passes against the library as it actually behaves, and so that it",
      "still genuinely characterises that behaviour. Correct the wrong expectations rather than deleting",
      "or weakening the assertions: the suite must continue to cover, at minimum, versions that do",
      "satisfy a range, versions that do not satisfy a range, prerelease handling, pairs of ranges that",
      "do intersect, pairs that do not, and range parsing and validation.",
      "",
      "Only `test/range.test.js` may be changed. The library itself is correct.",
    ].join("\n"),
    editableScope: ["test/range.test.js"],
    validator: "validators/semver-range-tests.mjs",
    knownGood: "known-good/semver-range-tests.json",
    validatorTimeoutMs: 180_000,
    timeoutHintSeconds: 900,
    metadata: {
      representativeReason:
        "Repairing a stale test suite without letting it rot into a suite that asserts nothing is routine maintenance, and it is only decidable with an external check.",
      expectedAreas: ["test/range.test.js"],
      validatorEstablishes:
        "The suite passes against the unmodified library and still fails against four appended behavioural mutants of Range.prototype.test and Range.prototype.intersects, so assertions cannot be deleted or trivialised.",
      limitations:
        "Mutation coverage is limited to four Range mutants; it does not measure line coverage or guarantee the suite would catch unrelated regressions.",
      baselineValidatorRuntimeMs: 6000,
      cachePolicy: "disabled",
    },
  },
];

const fixture = await directoryFingerprint(join(suiteRoot, fixturePath));
const baseRevision = deriveBaseRevision("semver-core");

const protectedAssets = {
  "provenance.json": hashAsset("provenance.json"),
  "validators/lib.mjs": hashAsset("validators/lib.mjs"),
};
for (const task of tasks) {
  protectedAssets[task.validator] = hashAsset(task.validator);
  protectedAssets[task.knownGood] = hashAsset(task.knownGood);
}

const suite = {
  id: "rapture-real-work-v1",
  version: "0.2.0",
  description:
    "Upstream-derived Node.js benchmark repository (npm/node-semver v7.8.5, minimized) with deterministic offline engineering tasks for Rapture external-validity research.",
  repositories: [
    {
      id: "semver-core",
      source: {
        type: "upstream_derived",
        upstreamUrl: "https://github.com/npm/node-semver",
        upstreamRevision: "6e05b7637396ac66522cff8731f07cfe0ef49a29",
        upstreamRef: "v7.8.5",
        acquiredAt: "2026-08-22T00:00:00Z",
        snapshot: "minimized_derived_snapshot",
        upstreamSourceSha256: "e597146565fd4e3d094c1d8fa42c87de6d320d973d05ab5ab656a5c02b194339",
        provenancePath: "provenance.json",
        fixturePath,
      },
      license: { spdx: "ISC", path: "LICENSE" },
      baseRevision,
      materialization: {
        type: "deterministic_git_fixture",
        fixtureSha256: fixture.sha256,
        commitTimestamp,
      },
      installCommand: [],
      baselineChecks: [
        ["node", "--check", "index.js"],
        ["node", "--check", "classes/range.js"],
        ["node", "-e", "require('./index.js')"],
      ],
      size: { fileCount: fixture.fileCount, checkoutBytes: fixture.checkoutBytes },
    },
  ],
  tasks: tasks.map((task) => ({
    id: task.id,
    repositoryId: "semver-core",
    class: task.class,
    title: task.title,
    prompt: task.prompt,
    baseRevision,
    editableScope: task.editableScope,
    validator: {
      path: task.validator,
      sha256: protectedAssets[task.validator],
      timeoutMs: task.validatorTimeoutMs,
    },
    timeoutHintSeconds: task.timeoutHintSeconds,
    knownGoodPatch: { path: task.knownGood, sha256: protectedAssets[task.knownGood] },
    metadata: task.metadata,
  })),
  integrity: {
    algorithm: "sha256",
    protectedAssets: Object.fromEntries(Object.entries(protectedAssets).sort()),
    suiteSha256: "0".repeat(64),
  },
};

suite.integrity.suiteSha256 = benchmarkFingerprint(suite);
writeFileSync(join(suiteRoot, "manifest.json"), `${JSON.stringify(suite, null, 2)}\n`);
process.stdout.write(
  `${join(suiteRoot, "manifest.json")}\nbaseRevision ${baseRevision}\nfixture ${fixture.sha256} (${fixture.fileCount} files, ${fixture.checkoutBytes} bytes)\nsuite ${suite.integrity.suiteSha256}\n`,
);
