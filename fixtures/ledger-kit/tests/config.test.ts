import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.ts";

test("parses comments, quotes, and last-wins duplicates", () => {
  const parsed = parseConfig('# heading\nname = ledger\nnote = "hash # ok"\nname = kit\n');
  assert.equal(parsed.name, "kit");
  assert.equal(parsed.note, "hash # ok");
});

test("rejects a line without an equals sign", () => {
  assert.throws(() => parseConfig("broken"), SyntaxError);
});
