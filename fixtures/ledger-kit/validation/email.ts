import assert from "node:assert/strict";
import { loadFixtureModule } from "./load.ts";

const email = await loadFixtureModule<{
  normalizeEmail: (email: string) => string;
  formatContact: (name: string, email: string) => string;
  emailKey: (email: string) => string;
}>("src/email.ts");

assert.equal(typeof email.normalizeEmail, "function");
assert.equal(email.normalizeEmail("  A@B.C "), "a@b.c");
assert.equal(email.formatContact(" Ada ", "  A@B.C "), "Ada <a@b.c>");
assert.equal(email.emailKey("  A@B.C "), "a@b.c");
assert.equal(email.formatContact("Ada", "ada@example.com"), "Ada <ada@example.com>");
