import { readFile } from "node:fs/promises";
import { z } from "zod";
import { globToRegExp } from "./glob.js";
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
  return {
    ...(invariants.protectedPaths.length > 0
      ? { protectedPaths: [...invariants.protectedPaths] }
      : {}),
    ...(invariants.testFilePatterns.length > 0
      ? { testFilePatterns: invariants.testFilePatterns.map(globToRegExp) }
      : {}),
  };
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
