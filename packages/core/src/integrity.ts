import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { computeIntegrity, driftPaths, listTreeFiles } from "@rapture/kernel";
import { z } from "zod";
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

export async function listFrozenIntegrityFiles(
  root: string,
  experimentName = "real-scale-2",
): Promise<readonly string[]> {
  return listTreeFiles(root, integrityRoots(experimentName));
}

export async function computeFrozenIntegrity(
  root: string,
  experimentName = "real-scale-2",
): Promise<FrozenIntegrity> {
  const manifest = await computeIntegrity(root, integrityRoots(experimentName));
  return {
    schemaVersion: 1,
    experimentName,
    files: manifest.files,
    aggregateSha256: manifest.aggregateSha256,
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
  return driftPaths(expected, actual).map((path) => relative(".", path));
}
