#!/usr/bin/env node
/**
 * Verify every experiment integrity sidecar in the repository.
 *
 * Guards the rule that historical frozen experiments are never silently rewritten: each
 * sidecar's recorded per-file hashes must still match the working tree, and the aggregate
 * must still match the file list it was built from. Exits non-zero on any drift.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const experiments = join(root, "experiments");
const sidecars = (await readdir(experiments))
  .filter((name) => name.endsWith(".integrity.json"))
  .sort();

let failures = 0;
for (const sidecar of sidecars) {
  const payload = JSON.parse(await readFile(join(experiments, sidecar), "utf8"));
  const lines = [];
  let missing = 0;
  let drift = 0;
  for (const [path, expected] of Object.entries(payload.files)) {
    let actual = null;
    try {
      actual = createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex");
    } catch {
      missing += 1;
    }
    if (actual !== null && actual !== expected) drift += 1;
    lines.push(`${path}\0${expected}`);
  }
  const aggregate = createHash("sha256").update(lines.join("\n")).digest("hex");
  const matches = aggregate === payload.aggregateSha256;
  const ok = matches && missing === 0 && drift === 0;
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? "OK  " : "FAIL"} ${sidecar}  files=${Object.keys(payload.files).length} missing=${missing} drift=${drift} aggregate=${matches ? "match" : "MISMATCH"}\n`,
  );
}
process.stdout.write(`${sidecars.length} sidecar(s), ${failures} failure(s)\n`);
process.exitCode = failures === 0 ? 0 : 1;
