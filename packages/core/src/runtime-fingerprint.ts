import os from "node:os";
import { join } from "node:path";
import { writeJsonArtifactIfAbsent } from "./artifacts.js";
import { detectAgentEnvironmentVariables } from "./host-state.js";

/**
 * Provider/runtime capability fingerprint.
 *
 * Records the exact tested execution identity so attribution results are
 * interpretable: CLI version, model identity, agent mode, structured output
 * format, sanitized environment surface, and adapter identity. Never persists
 * credentials and never infers account limits that are not explicitly
 * observable.
 */

export interface RuntimeCapabilityFingerprint {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly agentProvider: string;
  readonly agentCliVersion: string | null;
  readonly agentModel: string | null;
  readonly agentMode: "build";
  readonly structuredOutputFormat: "json" | null;
  readonly structuredEventTypesObserved: readonly string[] | null;
  readonly platform: string;
  readonly release: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  /** Names of inherited agent-related environment variables; values are never recorded. */
  readonly agentEnvironmentVariableNames: readonly string[];
  /** Model availability probe result captured during preflight. */
  readonly modelProbe: {
    readonly probedAt: string;
    readonly available: boolean;
    readonly detail: string | null;
  } | null;
  readonly adapterName: string;
  readonly adapterVersion: string | null;
}

export async function persistRuntimeFingerprint(
  directory: string,
  fingerprint: Omit<RuntimeCapabilityFingerprint, "schemaVersion" | "capturedAt"> &
    Partial<Pick<RuntimeCapabilityFingerprint, "capturedAt">>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RuntimeCapabilityFingerprint> {
  const record: RuntimeCapabilityFingerprint = {
    ...fingerprint,
    agentEnvironmentVariableNames:
      fingerprint.agentEnvironmentVariableNames.length > 0
        ? fingerprint.agentEnvironmentVariableNames
        : detectAgentEnvironmentVariables(env),
    schemaVersion: 1,
    capturedAt: fingerprint.capturedAt ?? new Date().toISOString(),
  };
  await writeJsonArtifactIfAbsent(join(directory, "runtime-fingerprint.json"), record);
  return record;
}

export function platformSummary(): Pick<
  RuntimeCapabilityFingerprint,
  "platform" | "release" | "arch" | "nodeVersion" | "cpuCount" | "totalMemoryBytes"
> {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}
