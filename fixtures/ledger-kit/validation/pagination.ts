import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const { pageSlice } = await loadFixtureModule<{
  pageSlice: <T>(items: readonly T[], page: number, pageSize: number) => T[];
}>("src/pagination.ts");

assert.deepEqual(pageSlice(["a", "b", "c", "d"], 1, 2), ["a", "b"]);
assert.deepEqual(pageSlice(["a", "b", "c", "d"], 2, 2), ["c", "d"]);
assert.deepEqual(pageSlice(["a", "b", "c"], 2, 2), ["c"]);
assert.deepEqual(pageSlice(["a"], 3, 1), []);
assert.throws(() => pageSlice(["a"], 0, 1), RangeError);
assert.throws(() => pageSlice(["a"], -1, 1), RangeError);
assert.throws(() => pageSlice(["a"], 1.5, 1), RangeError);
assert.throws(() => pageSlice(["a"], 1, 0), RangeError);
