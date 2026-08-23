import type { ProcessResult } from "../types.js";
import type {
  Executor,
  ExecutorPrepareInput,
  ExecutorRunOptions,
  PreparedSandbox,
} from "./types.js";

export interface InMemoryExecutorScript {
  readonly name?: string;
  readonly rootPrefix?: string;
  readonly onRun?: (
    sandbox: PreparedSandbox,
    command: readonly string[],
    options: ExecutorRunOptions,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly failOnPrepare?: (input: ExecutorPrepareInput) => string | null;
}

export interface InMemoryExecutor extends Executor {
  readonly preparedInputs: readonly ExecutorPrepareInput[];
  readonly runInvocations: readonly {
    readonly sandbox: PreparedSandbox;
    readonly command: readonly string[];
    readonly options: ExecutorRunOptions;
  }[];
  readonly disposedIds: readonly string[];
}

export function createInMemoryExecutor(script: InMemoryExecutorScript = {}): InMemoryExecutor {
  const preparedInputs: ExecutorPrepareInput[] = [];
  const runInvocations: {
    sandbox: PreparedSandbox;
    command: readonly string[];
    options: ExecutorRunOptions;
  }[] = [];
  const disposedIds: string[] = [];
  const roots = new Map<string, string>();
  return {
    name: script.name ?? "in-memory",
    preparedInputs,
    runInvocations,
    disposedIds,
    prepare: async (input) => {
      const failure = script.failOnPrepare?.(input) ?? null;
      if (failure !== null) throw new Error(failure);
      preparedInputs.push(input);
      const root = `${script.rootPrefix ?? "/sandboxes"}/${input.sandboxId}`;
      roots.set(input.sandboxId, root);
      return { id: input.sandboxId, root };
    },
    run: async (sandbox, command, options) => {
      runInvocations.push({ sandbox, command, options });
      if (script.onRun) return script.onRun(sandbox, command, options);
      return {
        command,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
      };
    },
    dispose: async (sandbox) => {
      disposedIds.push(sandbox.id);
      roots.delete(sandbox.id);
    },
  };
}
