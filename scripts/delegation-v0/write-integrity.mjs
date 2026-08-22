#!/usr/bin/env node
/**
 * Write the integrity sidecar for the delegation-signal experiment freeze.
 *
 * Covers the frozen configuration plus every asset that decides an outcome: the manifest,
 * the provenance record, all three fixtures, the external validators, and the known-good
 * overlays. Re-running after execution must reproduce the same aggregate, which is what
 * shows the corpus did not move underneath the run.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const experimentName = process.argv[2] ?? "task-delegation-signal-v0";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const roots = [
  `experiments/${experimentName}.frozen.json`,
  "benchmarks/delegation-v0/manifest.json",
  "benchmarks/delegation-v0/provenance.json",
  "benchmarks/delegation-v0/fixtures",
  "benchmarks/delegation-v0/validators",
  "benchmarks/delegation-v0/known-good",
];

async function listFiles(relativePath) {
  const absolute = join(root, relativePath);
  const directory = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (directory === null) return [relativePath.split("\\").join("/")];
  const files = [];
  for (const entry of directory) {
    const child = join(relativePath, entry.name).split("\\").join("/");
    if (entry.isDirectory()) files.push(...(await listFiles(child)));
    else files.push(child);
  }
  return files;
}

const files = [...new Set((await Promise.all(roots.map(listFiles))).flat())].sort();
const hashes = {};
const lines = [];
for (const file of files) {
  const digest = createHash("sha256")
    .update(await readFile(join(root, file)))
    .digest("hex");
  hashes[file] = digest;
  lines.push(`${file}\0${digest}`);
}
const payload = {
  schemaVersion: 1,
  experimentName,
  fileCount: files.length,
  files: hashes,
  aggregateSha256: createHash("sha256").update(lines.join("\n")).digest("hex"),
};
const destination = join(root, `experiments/${experimentName}.integrity.json`);
await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${destination}\n${payload.fileCount} files\n${payload.aggregateSha256}\n`);
