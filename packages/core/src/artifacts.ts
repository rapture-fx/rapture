import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export function redactSecrets(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeArtifactPath(root: string, ...segments: readonly string[]): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, ...segments);
  const relation = relative(rootPath, target);
  if (relation.startsWith(`..${sep}`) || relation === ".." || relation === "") {
    throw new Error("artifact path must be a child of the artifact root");
  }
  return target;
}

export async function writeTextArtifact(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const redacted = redactSecrets(content);
  await writeFile(path, redacted, { encoding: "utf8", flag: "wx" });
  return sha256(redacted);
}

export async function writeRawTextArtifact(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  return sha256(content);
}

export async function writeJsonArtifact(path: string, value: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return sha256(content);
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}
