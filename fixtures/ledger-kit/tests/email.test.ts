import assert from "node:assert/strict";
import { test } from "node:test";
import { emailKey, formatContact, normalizeEmail } from "../src/email.ts";

test("preserves contact formatting and lookup keys", () => {
  assert.equal(formatContact(" Ada ", "  A@B.C "), "Ada <a@b.c>");
  assert.equal(emailKey("  A@B.C "), "a@b.c");
});

test("exports a shared normalizeEmail helper", () => {
  assert.equal(normalizeEmail("  A@B.C "), "a@b.c");
});
