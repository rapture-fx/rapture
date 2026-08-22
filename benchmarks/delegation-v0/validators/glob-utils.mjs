import { assert, candidateRequire, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const utils = load("lib/utils.js");
  const api = load("index.js");

  for (const name of [
    "isObject",
    "hasRegexChars",
    "isRegexChar",
    "escapeRegex",
    "toPosixSlashes",
    "isWindows",
    "removeBackslashes",
    "escapeLast",
    "removePrefix",
    "wrapOutput",
    "basename",
  ]) {
    assert.equal(typeof utils[name], "function", `lib/utils.js must still export ${name}`);
  }

  // --- basename: separator awareness and trailing separators -------------------------
  assert.equal(utils.basename("a/b/c.js"), "c.js");
  assert.equal(utils.basename("c.js"), "c.js");
  // A trailing separator must yield the last real segment, not an empty string.
  assert.equal(utils.basename("a/b/"), "b");
  assert.equal(utils.basename("a/b/c/"), "c");
  // Backslashes are separators only when the windows option says so.
  assert.equal(utils.basename("a\\b\\c.js", { windows: true }), "c.js");
  assert.equal(utils.basename("a/b\\c.js", { windows: true }), "c.js");
  assert.equal(utils.basename("a\\b\\c.js"), "a\\b\\c.js");
  assert.equal(utils.basename("a\\b\\", { windows: true }), "b");

  // --- escapeLast: must not escape an already-escaped occurrence ----------------------
  assert.equal(utils.escapeLast("a.b.c", "."), "a.b\\.c");
  assert.equal(utils.escapeLast("abc", "."), "abc");
  assert.equal(utils.escapeLast("a.b.c", ".", 2), "a\\.b.c");
  // The last '.' is already escaped, so the search must continue leftwards.
  assert.equal(utils.escapeLast("a.b\\.c", "."), "a\\.b\\.c");

  // --- removePrefix: must record what it stripped -------------------------------------
  const stripped = {};
  assert.equal(utils.removePrefix("./a/b", stripped), "a/b");
  assert.deepEqual(stripped, { prefix: "./" }, "removePrefix must record the prefix it removed");
  const untouched = {};
  assert.equal(utils.removePrefix("a/b", untouched), "a/b");
  assert.deepEqual(untouched, {}, "removePrefix must not record a prefix it did not remove");
  const once = {};
  assert.equal(utils.removePrefix("././a", once), "./a", "only one leading './' is removed");
  assert.deepEqual(once, { prefix: "./" });
  assert.equal(utils.removePrefix("./a/b"), "a/b", "the state argument must stay optional");

  // --- untouched helpers must keep behaving -------------------------------------------
  assert.equal(utils.escapeRegex("a+b*c"), "a\\+b\\*c");
  assert.equal(utils.removeBackslashes("a\\\\b"), "ab");
  assert.equal(utils.toPosixSlashes("a\\\\b"), "a//b");
  assert.equal(utils.isObject({}), true);
  assert.equal(utils.isObject([]), false);
  assert.equal(utils.isObject(null), false);
  assert.equal(utils.hasRegexChars("a+b"), true);
  assert.equal(utils.hasRegexChars("abc"), false);
  assert.equal(utils.isRegexChar("+"), true);
  assert.equal(utils.isRegexChar("++"), false);
  assert.equal(utils.wrapOutput("x", {}, {}), "^(?:x)$");
  assert.equal(utils.wrapOutput("x", { negated: true }, {}), "(?:^(?!^(?:x)$).*$)");
  assert.equal(utils.wrapOutput("x", {}, { contains: true }), "(?:x)");
  assert.equal(typeof utils.isWindows(), "boolean");

  // --- the wider library must be unaffected --------------------------------------------
  assert.equal(api.isMatch("a/b", "a/*"), true);
  assert.equal(api.isMatch("a/b/c", "a/*"), false);
  assert.equal(api.isMatch("a/b/c.js", "**/*.js"), true);
  // matchBase routes through basename, so a broken basename shows up here too.
  assert.equal(api.matchBase("a/b/c.js", "*.js"), true);
  assert.equal(api.matchBase("a/b/c.md", "*.js"), false);
});
