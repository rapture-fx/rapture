import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const { parseMoney } = await loadFixtureModule<{
  parseMoney: (input: string) => number;
}>("src/money.ts");

assert.equal(parseMoney("$12.50"), 12.5);
assert.equal(parseMoney("12.50"), 12.5);
assert.equal(parseMoney("0.99"), 0.99);
assert.equal(parseMoney("1,234.56"), 1234.56);
assert.equal(parseMoney("2.5"), 2.5);
assert.equal(parseMoney("-3.20"), -3.2);
assert.throws(() => parseMoney(""), TypeError);
assert.throws(() => parseMoney("abc"), TypeError);
assert.throws(() => parseMoney("$"), TypeError);
