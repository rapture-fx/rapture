import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { loadConfiguration } = await candidateModule(repository, "src/load.mjs");
  const result = loadConfiguration({
    defaults: { host: "default", port: 3000, log: "info" },
    file: { host: "file", port: 4000 },
    environment: { host: "env" },
    cli: { port: 5000 },
  });
  assert.deepEqual(result, { host: "env", port: 5000, log: "info" });
});
