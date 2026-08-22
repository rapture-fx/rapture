import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Per-process agent telemetry.
 *
 * Complements host-wide telemetry with per-process RSS, CPU percentage, and
 * process identity, sampled via unprivileged `ps`. Processes are attributed to
 * experiment runs by the unique `.worktrees/<attemptId>` path in the agent
 * command line. Telemetry failures never invalidate engineering runs.
 */

const execFileAsync = promisify(execFile);

export interface ProcessTelemetrySample {
  readonly timestamp: string;
  /** Attempt id parsed from the worktree path, or null for unattributed matches. */
  readonly attemptId: string | null;
  readonly pid: number;
  readonly ppid: number;
  readonly pcpuPercent: number;
  readonly rssKb: number;
  readonly elapsedSeconds: number | null;
  /** Truncated command line (paths preserved; arguments after the prompt elided). */
  readonly commandSnippet: string;
}

export interface ProcessTelemetrySampler {
  start(): void;
  stop(): Promise<void>;
}

export interface ProcessTelemetrySink {
  /** Create the backing artifact eagerly (empty streams stay inspectable). */
  init(): Promise<void>;
  append(sample: ProcessTelemetrySample): Promise<void>;
}

export function createProcessTelemetryFileSink(path: string): ProcessTelemetrySink {
  let queue: Promise<void> = Promise.resolve();
  let initialized = false;
  const ensureFile = async (): Promise<void> => {
    if (initialized) return;
    initialized = true;
    const { appendFile } = await import("node:fs/promises");
    // Create the artifact eagerly so an empty telemetry stream is still a
    // present, inspectable file.
    await appendFile(path, "", { encoding: "utf8" }).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    });
  };
  return {
    init(): Promise<void> {
      queue = queue.then(ensureFile);
      return queue;
    },
    append(sample: ProcessTelemetrySample): Promise<void> {
      queue = queue
        .then(ensureFile)
        .then(() =>
          import("node:fs/promises").then(({ appendFile }) =>
            appendFile(path, `${JSON.stringify(sample)}\n`, { encoding: "utf8" }),
          ),
        );
      return queue;
    },
  };
}

/**
 * Extract the attempt id from an agent command line. Agent commands confine
 * the CLI with `--dir <repo>/.worktrees/<attemptId>`; that trailing segment is
 * unique per run attempt.
 */
export function attemptIdFromCommand(command: string): string | null {
  const match = /\.worktrees\/([A-Za-z0-9._-]+)(?:$|\s)/u.exec(command);
  return match?.[1] ?? null;
}

const MAX_SNIPPET_LENGTH = 240;

export async function sampleAgentProcesses(
  worktreeMarker: string,
  timestamp = new Date().toISOString(),
): Promise<readonly ProcessTelemetrySample[]> {
  let stdout: string;
  try {
    const result = await execFileAsync("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,etime=,command="], {
      timeout: 5_000,
    });
    stdout = result.stdout;
  } catch {
    return [];
  }
  const samples: ProcessTelemetrySample[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes(worktreeMarker)) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(?:([\d:-]+))?\s*(.*)$/u.exec(trimmed);
    if (match === null) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pcpu = Number.parseFloat(match[3] ?? "0");
    const rss = Number.parseInt(match[4] ?? "0", 10);
    const elapsedRaw = match[5];
    const command = match[6] ?? "";
    if (!command.includes(worktreeMarker) && !command.includes("opencode")) continue;
    samples.push({
      timestamp,
      attemptId: attemptIdFromCommand(command),
      pid,
      ppid,
      pcpuPercent: Number.isNaN(pcpu) ? 0 : pcpu,
      rssKb: Number.isNaN(rss) ? 0 : rss,
      elapsedSeconds: parseElapsedSeconds(elapsedRaw ?? null),
      commandSnippet:
        command.length > MAX_SNIPPET_LENGTH ? command.slice(0, MAX_SNIPPET_LENGTH) : command,
    });
  }
  return samples;
}

export function parseElapsedSeconds(value: string | null): number | null {
  if (value === null || value.trim().length === 0) return null;
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return null;
  // forms: mm:ss, hh:mm:ss, dd-hh:mm:ss
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

export function createProcessTelemetrySampler(
  sink: ProcessTelemetrySink,
  options: {
    readonly intervalMs?: number;
    readonly worktreeMarker: string;
    readonly onError?: (error: unknown) => void;
  },
): ProcessTelemetrySampler {
  const intervalMs = options.intervalMs ?? 1_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      const samples = await sampleAgentProcesses(options.worktreeMarker);
      for (const sample of samples) await sink.append(sample);
    } catch (error: unknown) {
      options.onError?.(error);
    }
  };

  return {
    start() {
      if (timer !== null || stopped) return;
      void sink.init().catch(() => undefined);
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await tick();
    },
  };
}

export interface AttemptProcessSummary {
  readonly attemptId: string;
  readonly sampleCount: number;
  readonly rssMaxKb: number | null;
  readonly rssMeanKb: number | null;
  readonly pcpuMeanPercent: number | null;
  readonly pcpuMaxPercent: number | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
}

/** Aggregate persisted samples into per-attempt summaries. */
export function aggregateProcessTelemetry(
  samples: readonly ProcessTelemetrySample[],
): readonly AttemptProcessSummary[] {
  const byAttempt = new Map<string, ProcessTelemetrySample[]>();
  for (const sample of samples) {
    if (sample.attemptId === null) continue;
    const existing = byAttempt.get(sample.attemptId) ?? [];
    existing.push(sample);
    byAttempt.set(sample.attemptId, existing);
  }
  const summaries: AttemptProcessSummary[] = [];
  for (const [attemptId, group] of byAttempt) {
    const timestamps = group.map((sample) => sample.timestamp).sort();
    const rssValues = group.map((sample) => sample.rssKb);
    const cpuValues = group.map((sample) => sample.pcpuPercent);
    summaries.push({
      attemptId,
      sampleCount: group.length,
      rssMaxKb: rssValues.length > 0 ? Math.max(...rssValues) : null,
      rssMeanKb:
        rssValues.length > 0 ? rssValues.reduce((a, b) => a + b, 0) / rssValues.length : null,
      pcpuMeanPercent:
        cpuValues.length > 0 ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length : null,
      pcpuMaxPercent: cpuValues.length > 0 ? Math.max(...cpuValues) : null,
      firstSeenAt: timestamps[0] ?? null,
      lastSeenAt: timestamps[timestamps.length - 1] ?? null,
    });
  }
  return summaries.sort((a, b) => a.attemptId.localeCompare(b.attemptId));
}
