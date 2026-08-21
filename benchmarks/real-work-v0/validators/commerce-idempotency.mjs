import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { IdempotencyRegistry } = await candidateModule(repository, "src/idempotency.mjs");
  const registry = new IdempotencyRegistry();
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { receipt: "r-1" };
  };
  const results = await Promise.all([
    registry.executeOnce("order-1", operation),
    registry.executeOnce("order-1", operation),
    registry.executeOnce("order-1", operation),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ receipt: "r-1" }, { receipt: "r-1" }, { receipt: "r-1" }]);
});
