import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { priceAfterDiscount } = await candidateModule(repository, "src/discount.mjs");
  const policy = {
    percent: 5,
    tiers: [
      { minimumCents: 5000, percent: 10 },
      { minimumCents: 10000, percent: 20 },
    ],
  };
  assert.equal(priceAfterDiscount(4999, policy), 4750);
  assert.equal(priceAfterDiscount(5000, policy), 4500);
  assert.equal(priceAfterDiscount(12000, policy), 9600);
  assert.throws(() => priceAfterDiscount(100, { percent: 101 }), TypeError);
  assert.deepEqual(
    policy.tiers.map((tier) => tier.minimumCents),
    [5000, 10000],
  );
});
