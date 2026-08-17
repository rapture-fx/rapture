import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSlice } from "../src/pagination.ts";

test("treats page as 1-based", () => {
  assert.deepEqual(pageSlice(["a", "b", "c", "d"], 1, 2), ["a", "b"]);
  assert.deepEqual(pageSlice(["a", "b", "c", "d"], 2, 2), ["c", "d"]);
});

test("rejects a zero or negative page", () => {
  assert.throws(() => pageSlice(["a"], 0, 1), RangeError);
  assert.throws(() => pageSlice(["a"], -1, 1), RangeError);
});
