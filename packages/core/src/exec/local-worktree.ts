import { join, relative, resolve, sep } from "node:path";
import type {
  Executor,
  ExecutorPrepareInput,
  ExecutorRunOptions,
  PreparedSandbox,
} from "@rapture/kernel";
import { sha256 } from "@rapture/kernel";
import { runProcess } from "../process.js";
import { createWorktreeManager, type WorktreeManager } from "../worktree.js";

export interface LocalWorktreeExecutorOptions {
  readonly worktreesRoot: string;
}

export function createLocalWorktreeExecutor(options: LocalWorktreeExecutorOptions): Executor {
  const managersByRepository = new Map<string, Promise<WorktreeManager>>();
  const managersBySandbox = new Map<string, WorktreeManager>();

  const managerFor = async (repository: string): Promise<WorktreeManager> => {
    const key = resolve(repository);
    let existing = managersByRepository.get(key);
    if (existing === undefined) {
      const root = join(options.worktreesRoot, sha256(key).slice(0, 16));
      existing = createWorktreeManager(key, root);
      managersByRepository.set(key, existing);
    }
    return existing;
  };

  return {
    name: "local-worktree",
    prepare: async (input: ExecutorPrepareInput): Promise<PreparedSandbox> => {
      if (!/^[a-z0-9_-]+$/u.test(input.sandboxId)) {
        throw new Error("sandbox ID must match [a-z0-9_-]+");
      }
      const repository = resolve(input.repository);
      const manager = await managerFor(repository);
      const root = await manager.create(input.sandboxId, input.baseCommit);
      managersBySandbox.set(input.sandboxId, manager);
      return { id: input.sandboxId, root };
    },
    run: async (sandbox, command, options: ExecutorRunOptions) => {
      const manager = managersBySandbox.get(sandbox.id);
      if (manager === undefined) throw new Error(`unknown sandbox: ${sandbox.id}`);
      const expectedRoot = manager.pathFor(sandbox.id);
      if (resolve(sandbox.root) !== expectedRoot) {
        throw new Error(`sandbox root mismatch for ${sandbox.id}`);
      }
      const executable = command[0];
      if (executable === undefined) throw new Error("empty executor command");
      const args = command.slice(1);
      let cwd = expectedRoot;
      if (options.cwd !== undefined) {
        cwd = resolve(expectedRoot, options.cwd);
        const relation = relative(expectedRoot, cwd);
        if (relation === ".." || relation.startsWith(`..${sep}`)) {
          throw new Error("executor cwd escaped sandbox root");
        }
      }
      return runProcess(executable, args, {
        cwd,
        timeoutMs: options.timeoutMs,
        ...(options.env === undefined ? {} : { env: options.env }),
      });
    },
    dispose: async (sandbox) => {
      const manager = managersBySandbox.get(sandbox.id);
      if (manager === undefined) return;
      await manager.remove(sandbox.id);
      managersBySandbox.delete(sandbox.id);
    },
  };
}
