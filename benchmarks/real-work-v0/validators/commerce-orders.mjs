import { assert, candidateModule, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const { normalizeOrder } = await candidateModule(repository, "src/orders.mjs");
  const valid = { customerId: " c-1 ", lines: [{ sku: " sku-1 ", quantity: 2 }] };
  const snapshot = structuredClone(valid);
  assert.deepEqual(normalizeOrder(valid), {
    ok: true,
    value: { customerId: "c-1", lines: [{ sku: "sku-1", quantity: 2 }] },
  });
  assert.deepEqual(valid, snapshot);
  assert.deepEqual(normalizeOrder({ customerId: "", lines: [{ sku: "", quantity: 0 }] }), {
    ok: false,
    errors: [
      { path: "customerId", code: "required" },
      { path: "lines.0.sku", code: "required" },
      { path: "lines.0.quantity", code: "positive_integer_required" },
    ],
  });
});
