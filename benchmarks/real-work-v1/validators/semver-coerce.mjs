import { assert, candidateRequire, runValidator } from "./lib.mjs";

const str = (value) => (value === null ? null : String(value));

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const coerce = load("functions/coerce.js");
  const SemVer = load("classes/semver.js");
  const semver = load("index.js");

  assert.equal(typeof coerce, "function", "functions/coerce.js must export a function");
  assert.equal(semver.coerce, coerce, "index.js must re-export the same coerce implementation");

  // --- behaviour that must be preserved (no options) -------------------------------
  assert.equal(str(coerce("42.6.7.9.3-alpha")), "42.6.7");
  assert.equal(str(coerce("v2")), "2.0.0");
  assert.equal(str(coerce("1.2.3.4")), "1.2.3");
  assert.equal(str(coerce("10")), "10.0.0");
  assert.equal(str(coerce("=v1.2.3")), "1.2.3");
  assert.equal(str(coerce(42)), "42.0.0");
  assert.equal(coerce("not a version"), null);
  assert.equal(coerce(null), null);
  assert.equal(coerce(undefined), null);
  assert.equal(coerce({}), null);

  // A SemVer instance is returned untouched.
  const instance = new SemVer("1.2.3");
  assert.equal(coerce(instance), instance);

  // --- right-to-left coercion (`rtl`) ----------------------------------------------
  // '1.2.3.4' must coerce to the right-most coercible triple that does not share a
  // terminus with a more left-ward one.
  assert.equal(str(coerce("1.2.3.4", { rtl: true })), "2.3.4");
  assert.equal(str(coerce("1.2.3.4.5", { rtl: true })), "3.4.5");
  assert.equal(str(coerce("v1.2.3", { rtl: true })), "1.2.3");
  assert.equal(str(coerce("version 1.2.3 of thing", { rtl: true })), "1.2.3");
  assert.equal(coerce("not a version", { rtl: true }), null);

  // --- prerelease and build coercion (`includePrerelease`) --------------------------
  assert.equal(str(coerce("v1.2.3-alpha.1", { includePrerelease: true })), "1.2.3-alpha.1");
  assert.equal(str(coerce("1.2.3-alpha.1+build.2", { includePrerelease: true })), "1.2.3-alpha.1");
  assert.deepEqual(
    coerce("1.2.3-alpha.1+build.2", { includePrerelease: true }).build,
    ["build", "2"],
    "build metadata must be carried through when includePrerelease is set",
  );
  // Without the option, prerelease and build metadata are dropped.
  assert.equal(str(coerce("v1.2.3-alpha.1")), "1.2.3");
  assert.deepEqual(coerce("1.2.3-alpha.1+build.2").build, []);
  // Left-most full coercion of '1.2.3.4-rc' still lands on '1.2.3'; the '-rc' belongs to '4'.
  assert.equal(str(coerce("1.2.3.4-rc", { includePrerelease: true })), "1.2.3");

  // --- both options together ---------------------------------------------------------
  assert.equal(str(coerce("1.2.3.4-rc", { rtl: true, includePrerelease: true })), "2.3.4-rc");
  assert.equal(str(coerce("1.2.3.4-rc", { rtl: true })), "2.3.4");

  // Repeated calls must be stable (a stateful /g regex must be reset between calls).
  for (let index = 0; index < 3; index += 1) {
    assert.equal(str(coerce("1.2.3.4", { rtl: true })), "2.3.4", `rtl call ${index}`);
    assert.equal(str(coerce("1.2.3.4-rc", { rtl: true, includePrerelease: true })), "2.3.4-rc");
  }
});
