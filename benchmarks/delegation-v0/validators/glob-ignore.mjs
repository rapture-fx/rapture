import { assert, candidateRequire, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateRequire(repository);
  const api = load("index.js");

  // --- existing behaviour must be preserved ------------------------------------------
  assert.equal(api.isMatch("a.js", "*.js"), true);
  assert.equal(api.isMatch("a.md", "*.js"), false);
  assert.equal(api.isMatch("a/b", "a/*"), true);
  assert.equal(api("*.js")("a.js"), true);
  assert.equal(api(["*.js", "*.md"])("a.md"), true);

  // --- ignore ---------------------------------------------------------------------------
  const ignoreOne = api("*.js", { ignore: "b.js" });
  assert.equal(ignoreOne("a.js"), true, "non-ignored matches still match");
  assert.equal(ignoreOne("b.js"), false, "an ignored input must not match");
  const ignoreMany = api("**/*.js", { ignore: ["**/node_modules/**", "*.min.js"] });
  assert.equal(ignoreMany("src/a.js"), true);
  assert.equal(ignoreMany("node_modules/x/a.js"), false);
  assert.equal(ignoreMany("a.min.js"), false);
  // A glob that never matched is rejected for not matching, never reported as ignored.
  assert.equal(api("*.js", { ignore: "*.js" })("a.md"), false);

  // --- onResult / onMatch / onIgnore -----------------------------------------------------
  const results = [];
  const matched = [];
  const ignored = [];
  const observed = api("*.js", {
    ignore: "b.js",
    onResult: (result) => results.push(result.input),
    onMatch: (result) => matched.push(result.input),
    onIgnore: (result) => ignored.push(result.input),
  });
  assert.equal(observed("a.js"), true);
  assert.equal(observed("b.js"), false);
  assert.equal(observed("c.md"), false);

  // onResult fires for every input, whatever the outcome.
  assert.deepEqual(results, ["a.js", "b.js", "c.md"], "onResult must fire for every input");
  assert.deepEqual(matched, ["a.js"], "onMatch must fire only for accepted matches");
  assert.deepEqual(ignored, ["b.js"], "onIgnore must fire only for ignored inputs");

  // The object handed to the callbacks describes the decision.
  const shapes = [];
  const shaped = api("*.js", { ignore: "b.js", onResult: (result) => shapes.push(result) });
  shaped("a.js");
  shaped("b.js");
  shaped("c.md");
  for (const shape of shapes) {
    for (const key of ["glob", "regex", "input", "output", "isMatch"]) {
      assert.ok(key in shape, `the callback result must carry ${key}`);
    }
  }
  assert.equal(shapes[2].isMatch, false, "a non-matching input reports isMatch false");

  // returnObject form must report the ignore decision too.
  const asObject = api("*.js", { ignore: "b.js" });
  assert.equal(asObject("b.js", true).isMatch, false, "an ignored input reports isMatch false");
  assert.equal(asObject("a.js", true).isMatch, true);

  // Ignore patterns must not inherit the caller's callbacks.
  let leaked = 0;
  const noLeak = api("*.js", { ignore: "b.js", onMatch: () => (leaked += 1) });
  noLeak("b.js");
  assert.equal(leaked, 0, "onMatch must not fire while evaluating the ignore pattern");
});
