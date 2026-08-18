import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { sha256 } from "./artifacts.js";

export const FROZEN_INTEGRITY_PATH = "experiments/real-scale-2.integrity.json";

const integrityRoots = [
  "experiments/real-scale-2.frozen.json",
  "fixtures/ledger-kit/tasks.json",
  "fixtures/ledger-kit/create.mjs",
  "fixtures/ledger-kit/package.json",
  "fixtures/ledger-kit/tsconfig.json",
  "fixtures/ledger-kit/src",
  "fixtures/ledger-kit/validation",
] as const;

export const frozenIntegritySchema = z
  .object({
    schemaVersion: z.literal(1),
    experimentName: z.literal("real-scale-2"),
    files: z.record(z.string(), z.string()),
    aggregateSha256: z.string().min(1),
  })
  .strict();

export type FrozenIntegrity = z.infer<typeof frozenIntegritySchema>;

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

export async function listFrozenIntegrityFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of integrityRoots) {
    files.push(...(await listFiles(root, entry)));
  }
  return [...new Set(files)].sort();
}

export async function computeFrozenIntegrity(root: string): Promise<FrozenIntegrity> {
  const files = await listFrozenIntegrityFiles(root);
  const hashes: Record<string, string> = {};
  const lines: string[] = [];
  for (const file of files) {
    const digest = sha256(await readFile(resolve(root, file)));
    hashes[file] = digest;
    lines.push(`${file}\0${digest}`);
  }
  return {
    schemaVersion: 1,
    experimentName: "real-scale-2",
    files: hashes,
    aggregateSha256: sha256(lines.join("\n")),
  };
}

export async function loadExpectedIntegrity(root: string): Promise<FrozenIntegrity | null> {
  try {
    const value = JSON.parse(await readFile(join(root, FROZEN_INTEGRITY_PATH), "utf8")) as unknown;
    return frozenIntegritySchema.parse(value);
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
