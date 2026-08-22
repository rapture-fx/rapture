import { assert, candidateRequire, runValidator } from "./lib.mjs";

// Expected release type for every ordered pair, per the documented `semver.diff` contract.
// Direction must not matter: diff(a, b) === diff(b, a).
const cases = [
  // identical, and build metadata is not a release difference
  ["1.2.3", "1.2.3", null],
  ["1.2.3", "1.2.3+build", null],
  ["1.2.3+a", "1.2.3+b", null],
  // ordinary releases
  ["1.2.3", "1.2.4", "patch"],
  ["1.2.3", "1.3.0", "minor"],
  ["1.2.3", "2.0.0", "major"],
  // release -> prerelease keeps the `pre` prefix
  ["1.2.3", "1.2.4-0", "prepatch"],
  ["1.2.3", "1.3.0-0", "preminor"],
  ["1.2.3", "2.0.0-0", "premajor"],
  ["1.2.3", "2.0.0-alpha.1", "premajor"],
  // both prereleases of the same main version
  ["1.2.3-1", "1.2.3-2", "prerelease"],
  ["1.2.3-alpha.1", "1.2.3-alpha.2", "prerelease"],
  // prerelease -> release: leaving a prerelease of 0.x/x.0.0 is always a major step
  ["1.0.0-1", "1.0.0", "major"],
  ["1.0.0-1", "1.1.1", "major"],
  ["1.0.0-1", "2.0.0", "major"],
  ["1.0.0-alpha.3", "1.0.0", "major"],
  // prerelease -> release where the main version is unchanged
  ["1.1.0-1", "1.1.0", "minor"],
  ["1.1.1-1", "1.1.1", "patch"],
  ["1.0.1-1", "1.0.1", "patch"],
  ["0.1.0-1", "0.1.0", "minor"],
  // prerelease -> release where the main version also moved
  ["1.1.0-1", "1.2.0", "minor"],
  ["1.1.1-1", "2.0.0", "major"],
];

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const diff = load("functions/diff.js");
  const semver = load("index.js");

  assert.equal(typeof diff, "function", "functions/diff.js must export a function");
  assert.equal(semver.diff, diff, "index.js must re-export the same diff implementation");

  for (const [left, right, expected] of cases) {
    assert.equal(diff(left, right), expected, `diff(${left}, ${right})`);
    assert.equal(diff(right, left), expected, `diff(${right}, ${left}) must be symmetric`);
  }

  // Invalid input must still surface as a TypeError from the parser, not a silent null.
  assert.throws(() => diff("not a version", "1.2.3"), TypeError);
  assert.throws(() => diff("1.2.3", "also not a version"), TypeError);
});
