import { performance } from "node:perf_hooks";
import { execa } from "execa";
import type { ProcessResult } from "../types.js";

export interface RunProcessOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = await execa(command, args, {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    reject: false,
    timeout: options.timeoutMs,
    killSignal: "SIGTERM",
    forceKillAfterDelay: 3_000,
    stdin: "ignore",
    stripFinalNewline: false,
  });
  return {
    command: [command, ...args],
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
