import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { parseConfig } = await candidateModule(repository, "src/parser.mjs");
  assert.deepEqual(parseConfig('URL="https://example.test/#fragment" # trailing\nMODE=prod\n'), {
    URL: "https://example.test/#fragment",
    MODE: "prod",
  });
  assert.deepEqual(parseConfig("TOKEN='abc#123'\n"), { TOKEN: "abc#123" });
  assert.throws(() => parseConfig("broken\n"), SyntaxError);
});
