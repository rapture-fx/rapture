import { assert, candidateImport, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const load = candidateImport(repository);
  const { suggestSimilar } = await load("lib/suggestSimilar.js");
  assert.equal(typeof suggestSimilar, "function", "lib/suggestSimilar.js must export suggestSimilar");

  const one = (candidate) => `\n(Did you mean ${candidate}?)`;
  const many = (candidates) => `\n(Did you mean one of ${candidates}?)`;

  // --- nothing to suggest ---------------------------------------------------------------
  assert.equal(suggestSimilar("help", []), "");
  assert.equal(suggestSimilar("help", null), "");
  assert.equal(suggestSimilar("help", undefined), "");
  // Too dissimilar: below the similarity floor, so no guess is offered.
  assert.equal(suggestSimilar("cheese", ["cheddar", "brie"]), "");
  assert.equal(suggestSimilar("x", ["help"]), "");
  assert.equal(suggestSimilar("", ["help"]), "");
  // Single-character candidates are never guessed.
  assert.equal(suggestSimilar("a", ["a"]), "");

  // --- a single close match ----------------------------------------------------------------
  assert.equal(suggestSimilar("hepl", ["help", "start", "stop"]), one("help"));
  assert.equal(suggestSimilar("versio", ["version", "versions"]), one("version"));
  assert.equal(suggestSimilar("help", ["help"]), one("help"));
  assert.equal(suggestSimilar("aa", ["a", "ab"]), one("ab"));

  // --- ties are all reported, sorted -----------------------------------------------------
  assert.equal(suggestSimilar("stat", ["start", "stats"]), many("start, stats"));
  assert.equal(suggestSimilar("stat", ["stats", "start"]), many("start, stats"));

  // --- long-flag handling -------------------------------------------------------------------
  assert.equal(suggestSimilar("--hepl", ["--help", "--start"]), one("--help"));
  assert.equal(suggestSimilar("--versio", ["--version", "--verbose"]), one("--version"));

  // --- duplicates must not produce duplicate suggestions ---------------------------------
  assert.equal(suggestSimilar("hepl", ["help", "help"]), one("help"));

  // --- a closer match wins outright rather than tying ---------------------------------------
  assert.equal(suggestSimilar("strt", ["start", "stop"]), one("start"));

  // --- the unknown-command path reports the suggestion ----------------------------------------
  const { createCommand } = await load("index.js");
  const command = createCommand("demo").exitOverride();
  command.command("start").action(() => {});
  command.command("stop").action(() => {});
  let message = "";
  try {
    command.parse(["node", "demo", "strt"]);
  } catch (error) {
    message = error.message;
  }
  assert.ok(
    message.includes("Did you mean start?"),
    `an unknown command must suggest a close match, got ${JSON.stringify(message)}`,
  );
});
