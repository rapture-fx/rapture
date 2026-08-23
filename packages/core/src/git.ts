import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FileChange, FileChangeStatus } from "@rapture/kernel";
import type { ProcessResult } from "./models.js";
import { runProcess } from "./process.js";

export class GitError extends Error {
  public override readonly name = "GitError";
}

export async function runGit(
  repository: string,
  args: readonly string[],
  options: { readonly allowFailure?: boolean; readonly timeoutMs?: number } = {},
): Promise<ProcessResult> {
  const result = await runProcess("git", ["-C", repository, ...args], {
    cwd: repository,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  if (!options.allowFailure && result.exitCode !== 0) {
    throw new GitError(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result;
}

export async function resolveCommit(repository: string, revision: string): Promise<string> {
  return (
    await runGit(repository, ["rev-parse", "--verify", `${revision}^{commit}`])
  ).stdout.trim();
}

export async function treeHash(repository: string, revision = "HEAD"): Promise<string> {
  return (await runGit(repository, ["rev-parse", `${revision}^{tree}`])).stdout.trim();
}

export async function workingTreeHash(repository: string): Promise<string> {
  await runGit(repository, ["add", "-A"]);
  return (await runGit(repository, ["write-tree"])).stdout.trim();
}

export async function currentCommit(repository: string): Promise<string | null> {
  const result = await runGit(repository, ["rev-parse", "HEAD"], { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function changedFiles(repository: string): Promise<readonly string[]> {
  const output = (await runGit(repository, ["status", "--porcelain=v1", "-z"])).stdout;
  const entries = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.length === 0) continue;
    const status = entry.slice(0, 2);
    let path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const renamedPath = entries[index + 1];
      if (renamedPath !== undefined) {
        path = renamedPath;
        index += 1;
      }
    }
    paths.push(path);
  }
  return [...new Set(paths)].sort();
}

export async function stagedPatch(repository: string): Promise<string> {
  await runGit(repository, ["add", "-A"]);
  return (await runGit(repository, ["diff", "--cached", "--binary", "--full-index"])).stdout;
}

export async function collectFileChanges(
  worktree: string,
  baseCommit: string,
  paths: readonly string[],
): Promise<readonly FileChange[]> {
  const changes: FileChange[] = [];
  for (const path of paths) {
    const before = await runGit(worktree, ["show", `${baseCommit}:${path}`], {
      allowFailure: true,
    });
    const hadBefore = before.exitCode === 0;
    const after = await readFile(join(worktree, path)).then(
      (content) => content.toString("utf8"),
      () => null,
    );
    if (!hadBefore && after === null) continue;
    const status: FileChangeStatus = after === null ? "deleted" : hadBefore ? "modified" : "added";
    changes.push({
      path,
      status,
      before: hadBefore ? before.stdout : null,
      after,
    });
  }
  return changes;
}

export async function repositoryFingerprint(repository: string, commit: string): Promise<string> {
  const remote = await runGit(repository, ["remote", "get-url", "origin"], { allowFailure: true });
  const { sha256 } = await import("./artifacts.js");
  return sha256(`${remote.stdout.trim()}\0${commit}`);
}

export function relativeArtifact(root: string, path: string): string {
  return relative(root, path);
}
