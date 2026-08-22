import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { sha256 } from "./artifacts.js";
import { isLedgerKitExperiment } from "./frozen.js";

export const FROZEN_INTEGRITY_PATH = "experiments/real-scale-2.integrity.json";

export function frozenIntegrityPath(experimentName: string): string {
  return `experiments/${experimentName}.integrity.json`;
}

const ledgerKitFixtureRoots = [
  "fixtures/ledger-kit/tasks.json",
  "fixtures/ledger-kit/create.mjs",
  "fixtures/ledger-kit/package.json",
  "fixtures/ledger-kit/tsconfig.json",
  "fixtures/ledger-kit/src",
  "fixtures/ledger-kit/validation",
] as const;

function integrityRoots(experimentName: string): readonly string[] {
  if (!isLedgerKitExperiment(experimentName)) return [frozenIntegrityPath(experimentName)];
  return [`experiments/${experimentName}.frozen.json`, ...ledgerKitFixtureRoots];
}

export function frozenIntegritySchema(experimentName: string) {
  return z
    .object({
      schemaVersion: z.literal(1),
      experimentName: z.literal(experimentName),
      files: z.record(z.string(), z.string()),
      aggregateSha256: z.string().min(1),
    })
    .strict();
}

export type FrozenIntegrity = z.infer<ReturnType<typeof frozenIntegritySchema>>;

async function listFiles(root: string, relativePath: string): Promise<readonly string[]> {
  const absolute = join(root, relativePath);
  const directory = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (directory === null) return [relativePath.split("\\").join("/")];
  const files: string[] = [];
  for (const entry of directory) {
    const child = join(relativePath, entry.name).split("\\").join("/");
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else files.push(child);
  }
  return files;
}

export async function listFrozenIntegrityFiles(
  root: string,
  experimentName = "real-scale-2",
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of integrityRoots(experimentName)) {
    files.push(...(await listFiles(root, entry)));
  }
  return [...new Set(files)].sort();
}

export async function computeFrozenIntegrity(
  root: string,
  experimentName = "real-scale-2",
): Promise<FrozenIntegrity> {
  const files = await listFrozenIntegrityFiles(root, experimentName);
  const hashes: Record<string, string> = {};
  const lines: string[] = [];
  for (const file of files) {
    const digest = sha256(await readFile(resolve(root, file)));
    hashes[file] = digest;
    lines.push(`${file}\0${digest}`);
  }
  return {
    schemaVersion: 1,
    experimentName,
    files: hashes,
    aggregateSha256: sha256(lines.join("\n")),
  };
}

export async function loadExpectedIntegrity(
  root: string,
  experimentName = "real-scale-2",
): Promise<FrozenIntegrity | null> {
  try {
    const value = JSON.parse(
      await readFile(join(root, frozenIntegrityPath(experimentName)), "utf8"),
    ) as unknown;
    return frozenIntegritySchema(experimentName).parse(value);
  } catch {
    return null;
  }
}

export function integrityDrift(
  expected: FrozenIntegrity,
  actual: FrozenIntegrity,
): readonly string[] {
  const paths = new Set([...Object.keys(expected.files), ...Object.keys(actual.files)]);
  return [...paths]
    .sort()
    .filter((path) => expected.files[path] !== actual.files[path])
    .map((path) => relative(".", path));
}
