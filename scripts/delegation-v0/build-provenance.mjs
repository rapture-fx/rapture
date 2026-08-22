#!/usr/bin/env node
/**
 * Build benchmarks/delegation-v0/provenance.json from pristine upstream checkouts.
 *
 * `upstreamSourceSha256` fingerprints the retained upstream bytes as they exist upstream,
 * *before* any Rapture transformation, so it pins what was taken independently of what was
 * later changed. Fixture paths that were renamed during identity scrubbing are hashed under
 * their original upstream path.
 *
 * Usage: build-provenance.mjs <semver-checkout> <picomatch-checkout> <commander-checkout>
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suiteRoot = join(root, "benchmarks/delegation-v0");
const [semverRoot, picomatchRoot, commanderRoot] = process.argv.slice(2);
if (!semverRoot || !picomatchRoot || !commanderRoot) {
  process.stderr.write("usage: build-provenance.mjs <semver> <picomatch> <commander>\n");
  process.exit(2);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;

/** Fingerprint retained upstream paths from the pristine checkout, before transformation. */
function upstreamFingerprint(checkout, retainedUpstreamPaths) {
  const entries = retainedUpstreamPaths
    .slice()
    .sort()
    .map((path) => ({ path, sha256: sha256(readFileSync(join(checkout, path))) }));
  return sha256(canonical(entries));
}

const semverRetained = [
  "LICENSE",
  "index.js",
  "range.bnf",
  ...["comparator", "index", "range", "semver"].map((n) => `classes/${n}.js`),
  ...[
    "clean",
    "cmp",
    "coerce",
    "compare-build",
    "compare-loose",
    "compare",
    "diff",
    "eq",
    "gt",
    "gte",
    "inc",
    "lt",
    "lte",
    "major",
    "minor",
    "neq",
    "parse",
    "patch",
    "prerelease",
    "rcompare",
    "rsort",
    "satisfies",
    "sort",
    "truncate",
    "valid",
  ].map((n) => `functions/${n}.js`),
  ...["constants", "debug", "identifiers", "lrucache", "parse-options", "re"].map(
    (n) => `internal/${n}.js`,
  ),
  ...[
    "gtr",
    "intersects",
    "ltr",
    "max-satisfying",
    "min-satisfying",
    "min-version",
    "outside",
    "simplify",
    "subset",
    "to-comparators",
    "valid",
  ].map((n) => `ranges/${n}.js`),
];

const picomatchRetained = [
  "LICENSE",
  "index.js",
  "lib/constants.js",
  "lib/parse.js",
  "lib/picomatch.js",
  "lib/scan.js",
  "lib/utils.js",
];

const commanderRetained = [
  "LICENSE",
  "index.js",
  "lib/argument.js",
  "lib/command.js",
  "lib/error.js",
  "lib/help.js",
  "lib/option.js",
  "lib/suggestSimilar.js",
];

const scrubbing = (extra) => [
  {
    kind: "identity_scrub",
    detail:
      "Removed README.md and all upstream project documentation, badges, changelog, contributor and CI metadata. Replaced package.json with a neutral manifest: renamed package, and removed repository, homepage, bugs, author, funding, keywords, scripts and devDependencies.",
    rationale:
      "Reduces the chance that repository recognition, rather than engineering, explains an outcome. Removing README also removes a documentation advantage; it was removed from all three repositories so the condition is uniform.",
  },
  ...extra,
  {
    kind: "residual_identity_cue",
    detail:
      "LICENSE is retained verbatim, including its copyright holder, because the licence requires it. This is an unavoidable remaining identity cue and identity reduction is therefore incomplete.",
    rationale: "Licence compliance outranks confound reduction.",
  },
];

const provenance = {
  schemaVersion: 1,
  suiteId: "rapture-delegation-v0",
  statement:
    "None of these fixtures is an unmodified upstream repository. Each is a minimized, identity-reduced derivative with deliberate baseline defects introduced so that benchmark tasks have something to repair. None behaves like any released version of its upstream package and none may be used as a dependency.",
  repositories: [
    {
      id: "version-core",
      upstream: {
        url: "https://github.com/npm/node-semver",
        ref: "v7.8.5",
        revision: "6e05b7637396ac66522cff8731f07cfe0ef49a29",
        license: { spdx: "ISC", retainedAt: "LICENSE", modified: false },
        acquiredAt: "2026-08-22T00:00:00Z",
      },
      snapshot: { type: "minimized_derived_snapshot", upstreamSourceSha256: "" },
      retainedUpstreamPaths: semverRetained,
      derivedFrom:
        "benchmarks/real-work-v1/fixtures/semver-core, itself a minimized snapshot of the upstream revision above. That fixture and its frozen experiment are unchanged; this is a separate identity-reduced copy.",
      transformations: scrubbing([
        {
          kind: "path_reduction",
          detail:
            "Retained only the upstream runtime surface (index.js, classes/, functions/, internal/, ranges/, range.bnf) plus LICENSE. The tap-based upstream test suite, bin/ and preload.js were already absent from the source fixture.",
          rationale:
            "The upstream suite needs a network install, which offline determinism forbids.",
        },
        {
          kind: "baseline_defect_injection",
          detail: "functions/diff.js drops prerelease-to-release special casing.",
          taskId: "version-diff-release-type",
        },
        {
          kind: "baseline_defect_injection",
          detail: "functions/coerce.js drops rtl and includePrerelease support.",
          taskId: "version-coerce-options",
        },
        {
          kind: "baseline_defect_injection",
          detail: "internal/lrucache.js reduced to an unbounded Map wrapper.",
          taskId: "version-lru-cache-eviction",
        },
        {
          kind: "test_addition",
          detail:
            "test/range.test.js is a Rapture-authored node:test suite, not upstream, whose baseline asserts stale expectations.",
          taskId: "version-range-test-repair",
        },
        {
          kind: "baseline_defect_injection",
          detail: "package.json declares no exports map or files array.",
          taskId: "version-subpath-exports",
        },
      ]),
    },
    {
      id: "glob-matcher-core",
      upstream: {
        url: "https://github.com/micromatch/picomatch",
        ref: "4.0.5",
        revision: "4f41a8edade7a5ab19832f7b40ecce46b288767f",
        license: { spdx: "MIT", retainedAt: "LICENSE", modified: false },
        acquiredAt: "2026-08-22T00:00:00Z",
      },
      snapshot: { type: "minimized_derived_snapshot", upstreamSourceSha256: "" },
      retainedUpstreamPaths: picomatchRetained,
      transformations: scrubbing([
        {
          kind: "path_reduction",
          detail:
            "Retained index.js, lib/ and LICENSE. Removed the mocha-based upstream test suite, bench/, examples/, posix.js and all tooling configuration.",
          rationale:
            "The upstream suite needs a network install, which offline determinism forbids.",
        },
        {
          kind: "identity_scrub",
          detail:
            "Renamed lib/picomatch.js to lib/glob-match.js and its exported binding to globMatch, updating requires. The local `matcher` identifier inside that module is untouched.",
          rationale: "The filename and binding named the upstream project directly.",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/scan.js checks for a leading '!' before extglob detection, so a negated extglob is mis-scanned as a negated pattern.",
          taskId: "glob-scan-negation",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/glob-match.js drops ignore handling and the onResult/onMatch/onIgnore callbacks.",
          taskId: "glob-ignore-callbacks",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/utils.js reduces basename, escapeLast and removePrefix to naive implementations.",
          taskId: "glob-utils-helpers",
        },
        {
          kind: "test_addition",
          detail:
            "test/match.test.js is a Rapture-authored node:test suite, not upstream, whose baseline asserts stale expectations.",
          taskId: "glob-match-test-repair",
        },
        {
          kind: "baseline_defect_injection",
          detail: "package.json declares no exports map or files array.",
          taskId: "glob-subpath-exports",
        },
      ]),
    },
    {
      id: "cli-command-core",
      upstream: {
        url: "https://github.com/tj/commander.js",
        ref: "v15.0.0",
        revision: "ba6d13ddb4243e5913367734f8c159089ffe7834",
        license: { spdx: "MIT", retainedAt: "LICENSE", modified: false },
        acquiredAt: "2026-08-22T00:00:00Z",
      },
      snapshot: { type: "minimized_derived_snapshot", upstreamSourceSha256: "" },
      retainedUpstreamPaths: commanderRetained,
      transformations: scrubbing([
        {
          kind: "path_reduction",
          detail:
            "Retained index.js, lib/ and LICENSE. Removed the jest-based upstream test suite, typings/, examples/ and all tooling configuration.",
          rationale:
            "The upstream suite needs a network install, which offline determinism forbids.",
        },
        {
          kind: "identity_scrub",
          detail:
            "Renamed the exported CommanderError class to CliError and rewrote occurrences of the project name in identifiers and comments. This is a mechanical rename with no behavioural effect; no task depends on the error class name.",
          rationale: "A public class name carried the upstream project identity.",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/option.js attributeName no longer strips the 'no-' prefix for negated options.",
          taskId: "cli-negated-option-name",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/suggestSimilar.js reduced to exact-match only, with no edit-distance scoring.",
          taskId: "cli-suggest-similar",
        },
        {
          kind: "baseline_defect_injection",
          detail:
            "lib/argument.js reduced to a stub: no name-syntax parsing, non-chainable setters, unvalidated choices.",
          taskId: "cli-argument-contract",
        },
        {
          kind: "test_addition",
          detail:
            "test/option.test.js is a Rapture-authored node:test suite, not upstream, whose baseline asserts stale expectations.",
          taskId: "cli-option-test-repair",
        },
        {
          kind: "baseline_defect_injection",
          detail: "package.json declares no exports map or files array.",
          taskId: "cli-subpath-exports",
        },
      ]),
    },
  ],
  notIncluded: {
    upstreamTests:
      "removed from all three repositories; acceptance is decided only by external validators under benchmarks/delegation-v0/validators/",
    dependencies: "none; every retained surface has no external module requirements",
  },
};

const checkouts = {
  "version-core": semverRoot,
  "glob-matcher-core": picomatchRoot,
  "cli-command-core": commanderRoot,
};
for (const repository of provenance.repositories) {
  repository.snapshot.upstreamSourceSha256 = upstreamFingerprint(
    checkouts[repository.id],
    repository.retainedUpstreamPaths,
  );
}

writeFileSync(join(suiteRoot, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
for (const repository of provenance.repositories) {
  process.stdout.write(
    `${repository.id.padEnd(20)} ${repository.snapshot.upstreamSourceSha256} (${repository.retainedUpstreamPaths.length} retained upstream paths)\n`,
  );
}
