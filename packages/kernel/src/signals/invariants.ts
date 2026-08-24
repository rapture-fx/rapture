import { readFile } from "node:fs/promises";
import { z } from "zod";
import type {
  FileChange,
  IntegritySignal,
  SignalDetectorOptions,
} from "./detect.js";

export const invariantsSchema = z
  .object({
    schemaVersion: z.literal(1),
    protectedPaths: z.array(z.string().min(1)).default([]),
    testFilePatterns: z.array(z.string().min(1)).default([]),
    ignorePaths: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type InvariantsConfig = z.infer<typeof invariantsSchema>;

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split("\\").join("/").replace(/^\.\//u, "");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char: string = normalized[index] ?? "";
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        const isDirectoryGlob = normalized[index + 2] === "/";
        source += isDirectoryGlob ? "(?:.*/)?" : ".*";
        index += isDirectoryGlob ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`(?:^|/)${source}$`, "u");
}

export function parseInvariants(value: unknown): InvariantsConfig {
  return invariantsSchema.parse(value);
}

export async function parseInvariantsFile(path: string): Promise<InvariantsConfig> {
  const content = await readFile(path, "utf8");
  return invariantsSchema.parse(JSON.parse(content) as unknown);
}

export function emptyInvariants(): InvariantsConfig {
  return invariantsSchema.parse({ schemaVersion: 1 });
}

export function invariantsToDetectorOptions(
  invariants: InvariantsConfig,
): SignalDetectorOptions {
  const options: {
    readonly protectedPaths?: readonly string[];
    readonly testFilePatterns?: readonly RegExp[];
  } = {};
  if (invariants.protectedPaths.length > 0) {
    (options as { protectedPaths?: readonly string[] }).protectedPaths = [
      ...invariants.protectedPaths,
    ];
  }
  if (invariants.testFilePatterns.length > 0) {
    (options as { testFilePatterns?: readonly RegExp[] }).testFilePatterns =
      invariants.testFilePatterns.map(globToRegExp);
  }
  return options;
}

export function filterIgnoredSignals(
  signals: readonly IntegritySignal[],
  invariants: InvariantsConfig,
): readonly IntegritySignal[] {
  if (invariants.ignorePaths.length === 0) return signals;
  const ignorePatterns = invariants.ignorePaths.map(globToRegExp);
  return signals.filter(
    (signal) => !ignorePatterns.some((pattern) => pattern.test(signal.path)),
  );
}

export function isIgnoredPath(path: string, invariants: InvariantsConfig): boolean {
  if (invariants.ignorePaths.length === 0) return false;
  const ignorePatterns = invariants.ignorePaths.map(globToRegExp);
  return ignorePatterns.some((pattern) => pattern.test(path));
}

export function changesWithInvariantContext(
  changes: readonly FileChange[],
  invariants: InvariantsConfig,
): readonly FileChange[] {
  if (invariants.ignorePaths.length === 0) return changes;
  const ignorePatterns = invariants.ignorePaths.map(globToRegExp);
  return changes.filter(
    (change) => !ignorePatterns.some((pattern) => pattern.test(change.path)),
  );
}
