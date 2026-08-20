import { open, readFile } from "node:fs/promises";
import { cpus, type as osType, platform, release, totalmem } from "node:os";
import pLimit from "p-limit";
import { runGit } from "./git.js";
import type { ContinuationRecord } from "./models.js";
import { runProcess } from "./process.js";

export interface ContinuationProvenance {
  readonly record: (record: ContinuationRecord) => Promise<void>;
  readonly readAll: () => Promise<readonly ContinuationRecord[]>;
}

async function readContinuationLines(path: string): Promise<string[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").filter((line) => line.length > 0);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function createContinuationProvenance(path: string): Promise<ContinuationProvenance> {
  const handle = await open(path, "a");
  await handle.close();
  const serialize = pLimit(1);
  return {
    record: (record) =>
      serialize(async () => {
        const appendHandle = await open(path, "a");
        try {
          await appendHandle.write(`${JSON.stringify(record)}\n`);
          await appendHandle.sync();
        } finally {
          await appendHandle.close();
        }
      }),
    readAll: async () => {
      const lines = await readContinuationLines(path);
      return lines.map((line) => JSON.parse(line) as ContinuationRecord);
    },
  };
}

export interface EnvironmentFingerprint {
  readonly os: string;
  readonly arch: string;
  readonly kernel: string;
  readonly cpuCount: number;
  readonly cpuModel: string | null;
  readonly memoryBytes: number;
  readonly nodeVersion: string;
  readonly gitVersion: string | null;
  readonly pnpmVersion: string | null;
}

export async function collectEnvironmentFingerprint(
  workspaceRoot: string,
): Promise<EnvironmentFingerprint> {
  const git = await runGit(workspaceRoot, ["--version"], { allowFailure: true });
  const pnpm = await runProcess("pnpm", ["--version"], {
    cwd: workspaceRoot,
    timeoutMs: 10_000,
  }).catch(() => null);
  return {
    os: platform(),
    arch: process.arch,
    kernel: `${osType()} ${release()}`,
    cpuCount: cpus().length,
    cpuModel: cpus()[0]?.model ?? null,
    memoryBytes: totalmem(),
    nodeVersion: process.version,
    gitVersion: git.exitCode === 0 ? git.stdout.trim() : null,
    pnpmVersion: pnpm !== null && pnpm.exitCode === 0 ? pnpm.stdout.trim() : null,
  };
}

const MATERIAL_FINGERPRINT_KEYS = ["os", "arch", "cpuCount", "nodeVersion", "gitVersion"] as const;

export function environmentFingerprintDiffers(
  previous: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): readonly string[] {
  const differences: string[] = [];
  for (const key of MATERIAL_FINGERPRINT_KEYS) {
    if (previous[key] !== current[key]) differences.push(key);
  }
  return differences;
}
