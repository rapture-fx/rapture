import { execFile } from "node:child_process";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeJsonArtifactIfAbsent } from "./artifacts.js";

/**
 * Clean-host execution protocol.
 *
 * Captures a host-state provenance snapshot before experiment execution:
 * memory, CPU utilization, load average, Rapture RSS, known active agent
 * processes, and inherited OpenCode-related environment variables that
 * previously polluted CLI execution. The snapshot warns about obvious
 * competing coding-agent processes and environment pollution but never fails
 * the run solely because ordinary desktop processes exist, and never kills
 * anything.
 */

const execFileAsync = promisify(execFile);

export const AGENT_ENV_VAR_PREFIXES = Object.freeze([
  "OPENCODE_",
  "CODEX_",
  "ANTHROPIC_",
  "OPENAI_",
]);

const CODING_AGENT_PROCESS_PATTERN = /(opencode|codex|claude|gemini|cursor-agent|aider|goose)/i;

export interface HostAgentProcess {
  readonly pid: number;
  readonly command: string;
}

export interface HostStateSnapshot {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly platform: string;
  readonly release: string;
  readonly arch: string;
  readonly cpuCount: number;
  readonly cpuModel: string | null;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly loadAverage1m: number;
  readonly raptureRssBytes: number;
  /** Brief CPU utilization sample as a fraction in [0,1], or null. */
  readonly cpuUtilizationSample: number | null;
  readonly activeAgentProcesses: readonly HostAgentProcess[];
  /** Names only; values are never recorded. */
  readonly agentEnvironmentVariables: readonly string[];
  readonly nodeVersion: string;
  readonly warnings: readonly string[];
}

interface CpuSnapshot {
  readonly idle: number;
  readonly total: number;
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
  }
  return { idle, total };
}

async function cpuUtilizationSample(sampleMs: number): Promise<number | null> {
  const before = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const after = cpuSnapshot();
  const idleDelta = after.idle - before.idle;
  const totalDelta = after.total - before.total;
  if (totalDelta <= 0) return null;
  return Math.min(1, Math.max(0, 1 - idleDelta / totalDelta));
}

export async function listActiveCodingAgentProcesses(): Promise<readonly HostAgentProcess[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 5_000 });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = /^(\d+)\s+(.*)$/.exec(line);
        return match ? { pid: Number(match[1]), command: match[2] ?? "" } : null;
      })
      .filter(
        (item): item is HostAgentProcess =>
          item !== null &&
          !Number.isNaN(item.pid) &&
          CODING_AGENT_PROCESS_PATTERN.test(item.command) &&
          !item.command.includes("rapture"),
      );
  } catch {
    return [];
  }
}

export function detectAgentEnvironmentVariables(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return Object.keys(env)
    .filter(
      (key) => key !== undefined && AGENT_ENV_VAR_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )
    .sort();
}

export async function captureHostState(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HostStateSnapshot> {
  const [cpuUtilizationSample_, activeAgentProcesses] = await Promise.all([
    cpuUtilizationSample(250),
    listActiveCodingAgentProcesses(),
  ]);
  const cpus = os.cpus();
  const warnings: string[] = [];
  if (activeAgentProcesses.length > 0) {
    warnings.push(
      `${activeAgentProcesses.length} potentially competing coding-agent process(es) detected: ${activeAgentProcesses
        .map((process) => `pid ${process.pid}`)
        .join(", ")}`,
    );
  }
  const agentEnvironmentVariables = detectAgentEnvironmentVariables(env);
  if (agentEnvironmentVariables.length > 0) {
    warnings.push(
      `inherited agent environment variables present (previously caused opencode CLI pollution): ${agentEnvironmentVariables.join(", ")}`,
    );
  }
  const freeMemoryFraction = os.totalmem() > 0 ? os.freemem() / os.totalmem() : 1;
  if (freeMemoryFraction < 0.1) {
    warnings.push(`host memory is low: ${(freeMemoryFraction * 100).toFixed(1)}% available`);
  }
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? null,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    loadAverage1m: os.loadavg()[0] ?? 0,
    raptureRssBytes: process.memoryUsage.rss(),
    cpuUtilizationSample: cpuUtilizationSample_,
    activeAgentProcesses,
    agentEnvironmentVariables,
    nodeVersion: process.version,
    warnings,
  };
}

/** Persist the snapshot exclusively so resume never rewrites the original. */
export async function persistHostStateSnapshot(
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HostStateSnapshot> {
  const snapshot = await captureHostState(env);
  await writeJsonArtifactIfAbsent(join(directory, "host-state.json"), snapshot);
  return snapshot;
}
