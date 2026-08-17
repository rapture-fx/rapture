import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const { createSku } = await loadFixtureModule<{
  createSku: (department: string, id: string) => string;
}>("src/sku.ts");

assert.equal(createSku("ACC", "0042"), "ACC-0042");
assert.equal(createSku("INV", "0001"), "INV-0001");
assert.throws(() => createSku("acc", "0042"), TypeError);
assert.throws(() => createSku("AC", "0042"), TypeError);
assert.throws(() => createSku("ACCT", "0042"), TypeError);
assert.throws(() => createSku("ACC", "42"), TypeError);
assert.throws(() => createSku("ACC", "00421"), TypeError);
assert.throws(() => createSku("", "0042"), TypeError);
assert.throws(() => createSku("ACC", "00A2"), TypeError);
