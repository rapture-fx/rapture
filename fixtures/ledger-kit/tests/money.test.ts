import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMoney } from "../src/money.ts";

test("parses dollar and comma-formatted amounts to cents-rounded dollars", () => {
  assert.equal(parseMoney("$12.50"), 12.5);
  assert.equal(parseMoney("12.50"), 12.5);
  assert.equal(parseMoney("0.99"), 0.99);
  assert.equal(parseMoney("1,234.56"), 1234.56);
});

test("rejects empty and non-numeric input", () => {
  assert.throws(() => parseMoney(""), TypeError);
  assert.throws(() => parseMoney("abc"), TypeError);
});
