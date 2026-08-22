import { assert, candidateRequire, runValidator } from "./lib.mjs";

const fields = [
  "prefix",
  "start",
  "base",
  "glob",
  "isGlob",
  "isBrace",
  "isBracket",
  "isExtglob",
  "isGlobstar",
  "negated",
  "negatedExtglob",
];

const pick = (result) => Object.fromEntries(fields.map((field) => [field, result[field]]));
const row = (prefix, start, base, glob, flags = {}) => ({
  prefix,
  start,
  base,
  glob,
  isGlob: false,
  isBrace: false,
  isBracket: false,
  isExtglob: false,
  isGlobstar: false,
  negated: false,
  negatedExtglob: false,
  ...flags,
});

// A leading `!` negates a pattern, but `!(` opens a negated extglob and must not be
// consumed as a negation prefix. Every field of the scan result is asserted so a fix
// cannot restore one flag while corrupting the base/glob split.
const cases = [
  ["a/b/*.js", row("", 0, "a/b", "*.js", { isGlob: true })],
  ["!a/b/*.js", row("!", 1, "a/b", "*.js", { isGlob: true, negated: true })],
  ["!*.js", row("!", 1, "", "*.js", { isGlob: true, negated: true })],
  ["!!a.js", row("!!", 2, "a.js", "", { negated: true })],
  ["!(a|b)", row("", 0, "", "!(a|b)", { isGlob: true, isExtglob: true, negatedExtglob: true })],
  ["a/!(b|c)/d", row("", 0, "a", "!(b|c)/d", { isGlob: true, isExtglob: true })],
  ["@(a|b)/c", row("", 0, "", "@(a|b)/c", { isGlob: true, isExtglob: true })],
  ["*(a|b)", row("", 0, "", "*(a|b)", { isGlob: true, isExtglob: true })],
  ["+(a|b)/c", row("", 0, "", "+(a|b)/c", { isGlob: true, isExtglob: true })],
  ["?(a)/b", row("", 0, "", "?(a)/b", { isGlob: true, isExtglob: true })],
  ["**/*.js", row("", 0, "", "**/*.js", { isGlob: true })],
  ["a/**", row("", 0, "a", "**", { isGlob: true })],
  ["a/b/**/c/*.md", row("", 0, "a/b", "**/c/*.md", { isGlob: true })],
  ["{a,b}/c", row("", 0, "", "{a,b}/c", { isGlob: true, isBrace: true })],
  ["[a-c]/d", row("", 0, "", "[a-c]/d", { isGlob: true, isBracket: true })],
  ["./a/b/*.js", row("./", 2, "a/b", "*.js", { isGlob: true })],
  ["a/b/c", row("", 0, "a/b/c", "")],
  ["a\\!b/*.js", row("", 0, "a\\!b", "*.js", { isGlob: true })],
];

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const scan = load("lib/scan.js");
  const api = load("index.js");
  assert.equal(typeof scan, "function", "lib/scan.js must export a function");
  assert.equal(typeof api.scan, "function", "index.js must expose scan");

  for (const [pattern, expected] of cases) {
    assert.deepEqual(pick(scan(pattern)), expected, `scan(${JSON.stringify(pattern)})`);
    assert.deepEqual(
      pick(api.scan(pattern)),
      expected,
      `public scan(${JSON.stringify(pattern)}) must agree with lib/scan.js`,
    );
  }

  // The nonegate option must still suppress negation without disturbing extglobs.
  assert.equal(scan("!a/b/*.js", { nonegate: true }).negated, false);
  assert.equal(scan("!(a|b)", { nonegate: true }).negatedExtglob, true);

  // Matching behaviour must be unaffected by any change made here.
  assert.equal(api.isMatch("a", "!(a|b)"), false);
  assert.equal(api.isMatch("c", "!(a|b)"), true);
  assert.equal(api.isMatch("a/b", "a/*"), true);
  assert.equal(api.isMatch("a/b/c", "a/*"), false);
});
