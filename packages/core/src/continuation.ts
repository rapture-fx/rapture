import { cpus, type as osType, platform, release, totalmem } from "node:os";
import { createJsonlAppender, readJsonlLines } from "@rapture/kernel";
import { runGit } from "./git.js";
import type { ContinuationRecord } from "./models.js";
import { runProcess } from "./process.js";

export interface ContinuationProvenance {
  readonly record: (record: ContinuationRecord) => Promise<void>;
  readonly readAll: () => Promise<readonly ContinuationRecord[]>;
}

export async function createContinuationProvenance(path: string): Promise<ContinuationProvenance> {
  const appender = await createJsonlAppender(path);
  return {
    record: async (record) => {
      await appender.appendLine(JSON.stringify(record));
    },
    readAll: async () => {
      const lines = await readJsonlLines(path);
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
