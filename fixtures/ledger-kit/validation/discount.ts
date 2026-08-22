import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const { applyVolumeDiscount } = await loadFixtureModule<{
  applyVolumeDiscount: (subtotal: number, quantity: number) => number;
}>("src/discount.ts");

assert.equal(applyVolumeDiscount(100, 0), 100);
assert.equal(applyVolumeDiscount(100, 9), 100);
assert.equal(applyVolumeDiscount(100, 10), 95);
assert.equal(applyVolumeDiscount(100, 49), 95);
assert.equal(applyVolumeDiscount(100, 50), 90);
assert.equal(applyVolumeDiscount(19.99, 10), 18.99);
assert.throws(() => applyVolumeDiscount(-1, 1), RangeError);
assert.throws(() => applyVolumeDiscount(10, -1), RangeError);
assert.throws(() => applyVolumeDiscount(Number.NaN, 1), RangeError);
