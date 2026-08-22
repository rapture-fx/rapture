import { assert, candidateImport, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateImport(repository);
  const { Argument, InvalidArgumentError, createCommand } = await load("index.js");
  const { humanReadableArgName } = await load("lib/argument.js");

  const shape = (spec) => {
    const argument = new Argument(spec);
    return [argument.name(), argument.required, argument.variadic];
  };

  // --- name syntax ---------------------------------------------------------------------
  assert.deepEqual(shape("<name>"), ["name", true, false]);
  assert.deepEqual(shape("[name]"), ["name", false, false]);
  assert.deepEqual(shape("plain"), ["plain", true, false]);
  assert.deepEqual(shape("<items...>"), ["items", true, true]);
  assert.deepEqual(shape("[items...]"), ["items", false, true]);

  // --- setters stay chainable ------------------------------------------------------------
  const chained = new Argument("[x]").default(5, "five").argParser(Number);
  assert.ok(chained instanceof Argument, "default() and argParser() must return the argument");
  assert.equal(chained.defaultValue, 5);
  assert.equal(chained.defaultValueDescription, "five");
  assert.equal(chained.parseArg("42", undefined), 42);
  assert.ok(new Argument("[x]").choices(["a"]) instanceof Argument, "choices() must be chainable");
  assert.ok(new Argument("[x]").argRequired() instanceof Argument);
  assert.ok(new Argument("<x>").argOptional() instanceof Argument);
  assert.equal(new Argument("[x]").argRequired().required, true);
  assert.equal(new Argument("<x>").argOptional().required, false);

  // --- choices validate, and copy the caller's array ---------------------------------------
  const choices = new Argument("<c>").choices(["a", "b"]);
  assert.deepEqual(choices.argChoices, ["a", "b"]);
  assert.equal(choices.parseArg("a", undefined), "a");
  assert.throws(
    () => choices.parseArg("z", undefined),
    (error) =>
      error instanceof InvalidArgumentError &&
      error.message === "Allowed choices are a, b.",
    "an out-of-range choice must raise InvalidArgumentError",
  );
  const source = ["a", "b"];
  const copied = new Argument("<c>").choices(source);
  source.push("c");
  assert.deepEqual(copied.argChoices, ["a", "b"], "choices must copy, not alias, the caller array");

  // --- variadic collection --------------------------------------------------------------------
  const variadic = new Argument("[x...]");
  assert.deepEqual(variadic._collectValue("a", undefined), ["a"]);
  assert.deepEqual(variadic._collectValue("b", ["a"]), ["a", "b"]);
  const variadicChoices = new Argument("[x...]").choices(["a", "b"]);
  assert.deepEqual(variadicChoices.parseArg("a", undefined), ["a"]);
  assert.deepEqual(variadicChoices.parseArg("b", ["a"]), ["a", "b"]);

  // --- help rendering -----------------------------------------------------------------------
  assert.equal(humanReadableArgName(new Argument("<name>")), "<name>");
  assert.equal(humanReadableArgName(new Argument("[name]")), "[name]");
  assert.equal(humanReadableArgName(new Argument("<items...>")), "<items...>");
  assert.equal(humanReadableArgName(new Argument("[items...]")), "[items...]");

  // --- end to end through a command ------------------------------------------------------------
  let captured = null;
  const command = createCommand("demo").exitOverride();
  command
    .argument("<first>")
    .argument("[rest...]")
    .action((first, rest) => {
      captured = [first, rest];
    });
  command.parse(["node", "demo", "one", "two", "three"]);
  assert.deepEqual(captured, ["one", ["two", "three"]], "a variadic argument collects the rest");
});
