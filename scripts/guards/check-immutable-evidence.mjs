#!/usr/bin/env node
/**
 * Prove that write-capable formatting cannot mutate protected research evidence.
 *
 * This asserts behaviour, not configuration text. It stages the protected trees plus a
 * Biome configuration into a temporary workspace, runs every write-capable formatting
 * command the repository exposes, and compares every protected file byte for byte. Any
 * difference fails the guard and names the files.
 *
 * It therefore catches an exclusion that was dropped, a new experiment directory nobody
 * remembered to exclude, and a Biome upgrade whose rules changed -- the failure modes an
 * "is the pattern present?" assertion would miss.
 */

import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { configFiles, protectedEvidenceRoots } from "./protected-evidence.mjs";

const execFileAsync = promisify(execFile);
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Every write-capable formatting entry point a developer or CI job might run. */
const writeCommands = [
  ["format", "--write", "."],
  ["check", "--write", "."],
  ["check", "--write", "--unsafe", "."],
];

async function filesBelow(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
  }
  return files;
}

async function collectProtectedFiles(root) {
  const collected = [];
  for (const evidenceRoot of protectedEvidenceRoots) {
    const absolute = join(root, evidenceRoot);
    if ((await stat(absolute).catch(() => null)) === null) continue;
    for (const path of await filesBelow(absolute)) collected.push(`${evidenceRoot}/${path}`);
  }
  return collected.sort();
}

/**
 * Stage protected evidence into a scratch workspace, run write-capable formatting, and
 * report which protected files changed.
 *
 * @param {object} [options]
 * @param {string} [options.biomeConfig] Replacement biome.json contents. Used by the guard's
 *   own negative control to prove the exclusions are what keep evidence intact.
 */
export async function detectEvidenceMutation(options = {}) {
  const protectedFiles = await collectProtectedFiles(repositoryRoot);
  if (protectedFiles.length === 0) {
    throw new Error("no protected evidence found; refusing to pass vacuously");
  }
  const workspace = await mkdtemp(join(tmpdir(), "rapture-immutable-evidence-"));
  try {
    for (const evidenceRoot of protectedEvidenceRoots) {
      const source = join(repositoryRoot, evidenceRoot);
      if ((await stat(source).catch(() => null)) === null) continue;
      await cp(source, join(workspace, evidenceRoot), { recursive: true });
    }
    for (const file of configFiles) {
      await cp(join(repositoryRoot, file), join(workspace, file)).catch(() => undefined);
    }
    if (options.biomeConfig !== undefined) {
      await writeFile(join(workspace, "biome.json"), options.biomeConfig, "utf8");
    }

    const biome = join(repositoryRoot, "node_modules/.bin/biome");
    for (const args of writeCommands) {
      // A non-zero exit is fine: unfixable lint findings do not matter, only writes do.
      await execFileAsync(biome, args, { cwd: workspace }).catch(() => undefined);
    }

    const mutated = [];
    for (const file of protectedFiles) {
      const before = await readFile(join(repositoryRoot, file));
      const after = await readFile(join(workspace, file)).catch(() => null);
      if (after === null || !before.equals(after)) mutated.push(file);
    }
    return { protectedFiles, mutated };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { protectedFiles, mutated } = await detectEvidenceMutation();
  if (mutated.length > 0) {
    process.stderr.write(
      `write-capable formatting mutated ${mutated.length} protected evidence file(s):\n` +
        `${mutated.map((file) => `  ${file}`).join("\n")}\n` +
        "Protected research evidence is integrity-hashed; rewriting it invalidates a suite\n" +
        "fingerprint or a frozen experiment. Exclude these paths in biome.json instead of\n" +
        "reformatting them.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `immutable evidence guard PASS: ${protectedFiles.length} protected file(s) across ` +
        `${protectedEvidenceRoots.length} root(s) survived ${writeCommands.length} write-capable formatting command(s) unchanged\n`,
    );
  }
}
