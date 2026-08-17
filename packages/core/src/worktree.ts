import { access, mkdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import pLimit from "p-limit";
import { runGit } from "./git.js";

export interface WorktreeManager {
  readonly root: string;
  readonly pathFor: (runId: string) => string;
  readonly create: (runId: string, commit: string) => Promise<string>;
  readonly remove: (runId: string) => Promise<void>;
}

export async function createWorktreeManager(
  repository: string,
  root: string,
): Promise<WorktreeManager> {
  const resolvedRoot = resolve(root);
  await mkdir(resolvedRoot, { recursive: true });
  const mutate = pLimit(1);
  const pathFor = (runId: string): string => {
    if (!/^[a-z0-9_-]+$/u.test(runId)) throw new Error("unsafe run ID for worktree path");
    const target = resolve(resolvedRoot, runId);
    const relation = relative(resolvedRoot, target);
    if (relation.startsWith(`..${sep}`) || relation === ".." || relation === "") {
      throw new Error("worktree path escaped managed root");
    }
    return target;
  };
  return {
    root: resolvedRoot,
    pathFor,
    create: (runId, commit) =>
      mutate(async () => {
        const target = pathFor(runId);
        let targetExists = true;
        try {
          await access(target);
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            targetExists = false;
          } else {
            throw error;
          }
        }
        if (targetExists) throw new Error(`worktree path already exists: ${target}`);
        await runGit(repository, ["worktree", "add", "--detach", target, commit]);
        return target;
      }),
    remove: (runId) =>
      mutate(async () => {
        const target = pathFor(runId);
        await runGit(repository, ["worktree", "remove", "--force", target], {
          allowFailure: true,
        });
        await rm(target, { recursive: true, force: true });
        await runGit(repository, ["worktree", "prune"]);
      }),
  };
}
