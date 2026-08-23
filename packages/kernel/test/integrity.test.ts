import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "../src/evidence/artifacts.js";
import { computeIntegrity, driftPaths, listTreeFiles } from "../src/evidence/integrity.js";

async function makeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rapture-integrity-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "a.txt"), "alpha\n");
  await writeFile(join(root, "nested", "b.txt"), "beta\n");
  return root;
}

it("hashes every file under the given roots deterministically", async () => {
  const root = await makeTree();
  const manifest = await computeIntegrity(root, ["a.txt", "nested"]);
  expect(manifest.files["a.txt"]).toBe(sha256("alpha\n"));
  expect(manifest.files["nested/b.txt"]).toBe(sha256("beta\n"));
  const again = await computeIntegrity(root, ["a.txt", "nested"]);
  expect(manifest.aggregateSha256).toBe(again.aggregateSha256);
});

it("computes the aggregate as sha256 of path\\0hash lines", async () => {
  const root = await makeTree();
  const manifest = await computeIntegrity(root, ["a.txt"]);
  expect(manifest.aggregateSha256).toBe(sha256(`a.txt\0${sha256("alpha\n")}`));
});

it("detects any single-file mutation via drift and aggregate change", async () => {
  const root = await makeTree();
  const before = await computeIntegrity(root, ["a.txt", "nested"]);
  await writeFile(join(root, "nested", "b.txt"), "tampered\n");
  const after = await computeIntegrity(root, ["a.txt", "nested"]);
  expect(driftPaths(before, after)).toEqual(["nested/b.txt"]);
  expect(before.aggregateSha256).not.toBe(after.aggregateSha256);
});

it("reports added and removed files as drift", async () => {
  const root = await makeTree();
  const before = await computeIntegrity(root, ["a.txt"]);
  await writeFile(join(root, "c.txt"), "new\n");
  const after = await computeIntegrity(root, ["a.txt", "c.txt"]);
  expect(driftPaths(before, after)).toEqual(["c.txt"]);
});

it("treats a missing root as a literal file entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-integrity-"));
  const files = await listTreeFiles(root, ["does-not-exist.json"]);
  expect(files).toEqual(["does-not-exist.json"]);
});
