import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { mergeConfig } = await candidateModule(repository, "src/merge.mjs");
  const base = { server: { host: "localhost", ports: [3000], tls: false }, tags: ["base"] };
  const override = { server: { tls: true }, tags: ["prod"] };
  const result = mergeConfig(base, override);
  assert.deepEqual(result, {
    server: { host: "localhost", ports: [3000], tls: true },
    tags: ["prod"],
  });
  result.server.ports.push(4000);
  result.tags.push("mutated");
  assert.deepEqual(base, {
    server: { host: "localhost", ports: [3000], tls: false },
    tags: ["base"],
  });
  assert.deepEqual(override, { server: { tls: true }, tags: ["prod"] });
});
