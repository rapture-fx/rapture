#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const experimentName = process.argv[2] ?? "real-scale-2";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const roots = [
  `experiments/${experimentName}.frozen.json`,
  "fixtures/ledger-kit/tasks.json",
  "fixtures/ledger-kit/create.mjs",
  "fixtures/ledger-kit/package.json",
  "fixtures/ledger-kit/tsconfig.json",
  "fixtures/ledger-kit/src",
  "fixtures/ledger-kit/validation",
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
  files: hashes,
  aggregateSha256: createHash("sha256").update(lines.join("\n")).digest("hex"),
};
const destination = join(root, `experiments/${experimentName}.integrity.json`);
await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${destination}\n${payload.aggregateSha256}\n`);
