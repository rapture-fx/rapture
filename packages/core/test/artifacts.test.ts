import { expect, it } from "vitest";
import { redactSecrets, safeArtifactPath } from "../src/artifacts.js";

it("redacts obvious secrets", () => {
  const value = "Authorization: Bearer abc123\napi_key=secret-value\nghp_abcdefghijklmnop";
  const redacted = redactSecrets(value);
  expect(redacted).not.toContain("abc123");
  expect(redacted).not.toContain("secret-value");
  expect(redacted).not.toContain("ghp_abcdefghijklmnop");
});

it("rejects artifact path escape", () => {
  expect(() => safeArtifactPath("/tmp/rapture-root", "../escape")).toThrow(/child/u);
});
