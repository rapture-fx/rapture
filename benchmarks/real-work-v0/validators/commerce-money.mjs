import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { parseAmountToCents } = await candidateModule(repository, "src/money.mjs");
  assert.equal(parseAmountToCents("12.34"), 1234);
  assert.equal(parseAmountToCents("-0.01"), -1);
  assert.equal(parseAmountToCents("90071992547409.91"), 9007199254740991);
  assert.throws(() => parseAmountToCents("1.999"), TypeError);
  assert.throws(() => parseAmountToCents("1e2"), TypeError);
});
