import type { ProcessResult } from "../types.js";

export interface ExecutorPrepareInput {
  readonly repository: string;
  readonly baseCommit: string;
  readonly sandboxId: string;
}

export interface PreparedSandbox {
  readonly id: string;
  readonly root: string;
}

export interface ExecutorRunOptions {
  readonly timeoutMs: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface Executor {
  readonly name: string;
  readonly prepare: (input: ExecutorPrepareInput) => Promise<PreparedSandbox>;
  readonly run: (
    sandbox: PreparedSandbox,
    command: readonly string[],
    options: ExecutorRunOptions,
  ) => Promise<ProcessResult>;
  readonly dispose: (sandbox: PreparedSandbox) => Promise<void>;
}
