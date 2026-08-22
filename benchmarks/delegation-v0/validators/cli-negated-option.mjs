import { assert, candidateImport, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateImport(repository);
  const { Option, createCommand } = await load("index.js");

  const run = (configure, argv) => {
    const command = createCommand("demo").exitOverride();
    configure(command);
    command.parse(["node", "demo", ...argv]);
    return command.opts();
  };

  // --- a negated option is stored under the positive attribute name -------------------
  assert.equal(new Option("--no-color").attributeName(), "color");
  assert.equal(new Option("--no-check-updates").attributeName(), "checkUpdates");
  assert.equal(new Option("--no-sourcemap").attributeName(), "sourcemap");
  assert.equal(new Option("--no-color").negate, true);
  // Positive options are unaffected.
  assert.equal(new Option("--color").attributeName(), "color");
  assert.equal(new Option("--check-updates").attributeName(), "checkUpdates");
  assert.equal(new Option("-v, --verbose").attributeName(), "verbose");
  assert.equal(new Option("--color").negate, false);
  // A long flag that merely contains "no" is not negated.
  assert.equal(new Option("--nozzle").negate, false);
  assert.equal(new Option("--nozzle").attributeName(), "nozzle");

  // --- parsing stores the value under the positive name --------------------------------
  assert.deepEqual(run((c) => c.option("--no-color", "disable colour"), []), { color: true });
  assert.deepEqual(run((c) => c.option("--no-color", "disable colour"), ["--no-color"]), {
    color: false,
  });
  assert.deepEqual(
    run((c) => c.option("--no-check-updates", "skip"), ["--no-check-updates"]),
    { checkUpdates: false },
  );

  // --- a positive/negative pair shares one attribute ------------------------------------
  const pair = (argv) =>
    run((c) => c.option("--color", "enable").option("--no-color", "disable"), argv);
  assert.deepEqual(pair(["--no-color"]), { color: false });
  assert.deepEqual(pair(["--color"]), { color: true });
  assert.deepEqual(pair([]), {}, "with an explicit pair, neither flag implies a default");

  // --- unrelated option handling must be preserved ---------------------------------------
  assert.deepEqual(run((c) => c.option("-v, --verbose", "loud"), ["-v"]), { verbose: true });
  assert.deepEqual(run((c) => c.option("-n, --number <n>", "a number"), ["-n", "42"]), {
    number: "42",
  });
  assert.deepEqual(
    run((c) => c.option("--no-color", "disable").option("-v, --verbose", "loud"), ["-v"]),
    { color: true, verbose: true },
  );
});
