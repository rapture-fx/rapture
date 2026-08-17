import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVolumeDiscount } from "../src/discount.ts";

test("applies 5% at 10 items and 10% at 50 items", () => {
  assert.equal(applyVolumeDiscount(100, 9), 100);
  assert.equal(applyVolumeDiscount(100, 10), 95);
  assert.equal(applyVolumeDiscount(100, 50), 90);
});

test("rejects negative inputs", () => {
  assert.throws(() => applyVolumeDiscount(-1, 1), RangeError);
  assert.throws(() => applyVolumeDiscount(10, -1), RangeError);
});
