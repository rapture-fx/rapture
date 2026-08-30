import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256FileHex(path: string): Promise<string | null> {
  try {
    const data = await readFile(path);
    return sha256Hex(data);
  } catch {
    return null;
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashObject(value: unknown): string {
  return sha256Hex(stableStringify(value));
}
