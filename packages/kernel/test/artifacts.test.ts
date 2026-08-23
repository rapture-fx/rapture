import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  redactSecrets,
  safeArtifactPath,
  sha256,
  writeJsonArtifactIfAbsent,
  writeRawTextArtifact,
  writeTextArtifact,
} from "../src/evidence/artifacts.js";

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

it("computes stable sha256 digests", () => {
  expect(sha256("alpha\n")).toBe(sha256("alpha\n"));
  expect(sha256("alpha\n")).toMatch(/^[a-f0-9]{64}$/u);
});

it("refuses to overwrite immutable text artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-artifacts-"));
  const path = join(root, "out.txt");
  await writeTextArtifact(path, "first\n");
  await expect(writeTextArtifact(path, "second\n")).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path, "utf8")).toBe("first\n");
});

it("redacts text artifacts on write", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-artifacts-"));
  const path = join(root, "secret.txt");
  const hash = await writeTextArtifact(path, "token=super-secret\n");
  const content = await readFile(path, "utf8");
  expect(content).not.toContain("super-secret");
  expect(hash).toBe(sha256(content));
});

it("writeJsonArtifactIfAbsent writes once and then reports false", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-artifacts-"));
  const path = join(root, "data.json");
  expect(await writeJsonArtifactIfAbsent(path, { a: 1 })).toBe(true);
  expect(await writeJsonArtifactIfAbsent(path, { a: 2 })).toBe(false);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1 });
});

it("raw text artifacts skip redaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-artifacts-"));
  const path = join(root, "patch.txt");
  await writeRawTextArtifact(path, "token=keep-me\n");
  expect(await readFile(path, "utf8")).toBe("token=keep-me\n");
});
