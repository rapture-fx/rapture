import assert from "node:assert/strict";
import { test } from "node:test";
import { createSku } from "../src/sku.ts";

test("formats a valid department and numeric id", () => {
  assert.equal(createSku("ACC", "0042"), "ACC-0042");
});

test("rejects invalid department or id shapes", () => {
  assert.throws(() => createSku("acc", "0042"), TypeError);
  assert.throws(() => createSku("AC", "0042"), TypeError);
  assert.throws(() => createSku("ACC", "42"), TypeError);
  assert.throws(() => createSku("", "0042"), TypeError);
});
