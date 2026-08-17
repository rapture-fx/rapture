import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const { parseConfig } = await loadFixtureModule<{
  parseConfig: (text: string) => Record<string, string>;
}>("src/config.ts");

const parsed = parseConfig('# heading\nname = ledger\nnote = "hash # ok"\nname = kit\n\nempty =\n');
assert.equal(parsed.name, "kit");
assert.equal(parsed.note, "hash # ok");
assert.equal(parsed.empty, "");
assert.throws(() => parseConfig("broken"), SyntaxError);
assert.deepEqual(parseConfig(""), {});
