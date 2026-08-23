import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./artifacts.js";

export interface IntegrityManifest {
  readonly files: Readonly<Record<string, string>>;
  readonly aggregateSha256: string;
}

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

export async function listTreeFiles(
  root: string,
  roots: readonly string[],
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of roots) {
    files.push(...(await listFiles(root, entry)));
  }
  return [...new Set(files)].sort();
}

export async function computeIntegrity(
  root: string,
  roots: readonly string[],
): Promise<IntegrityManifest> {
  const files = await listTreeFiles(root, roots);
  const hashes: Record<string, string> = {};
  const lines: string[] = [];
  for (const file of files) {
    const digest = sha256(await readFile(resolve(root, file)));
    hashes[file] = digest;
    lines.push(`${file}\0${digest}`);
  }
  return {
    files: hashes,
    aggregateSha256: sha256(lines.join("\n")),
  };
}

export function driftPaths(
  expected: IntegrityManifest,
  actual: IntegrityManifest,
): readonly string[] {
  const paths = new Set([...Object.keys(expected.files), ...Object.keys(actual.files)]);
  return [...paths].sort().filter((path) => expected.files[path] !== actual.files[path]);
}
