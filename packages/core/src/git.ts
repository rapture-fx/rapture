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

export async function findGitRoot(startPath: string): Promise<string | null> {
  const result = await runGit(startPath, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function defaultBranch(repository: string): Promise<string | null> {
  const symbolic = await runGit(
    repository,
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  if (symbolic.exitCode === 0) {
    const ref = symbolic.stdout.trim().replace(/^origin\//u, "");
    if (ref.length > 0) {
      const check = await runGit(repository, ["rev-parse", "--verify", ref], {
        allowFailure: true,
      });
      if (check.exitCode === 0) return ref;
    }
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const check = await runGit(repository, ["rev-parse", "--verify", candidate], {
      allowFailure: true,
    });
    if (check.exitCode === 0) return candidate;
  }
  return null;
}

export async function mergeBase(repository: string, a: string, b: string): Promise<string | null> {
  const result = await runGit(repository, ["merge-base", a, b], { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function resolveBaseRef(
  repository: string,
  explicitBase: string | undefined,
  candidateRef: string,
): Promise<string> {
  if (explicitBase !== undefined) return explicitBase;
  const branch = await defaultBranch(repository);
  if (branch === null) {
    throw new GitError(
      "unable to determine trusted base: no remote default branch and no main/master branch found; supply --base explicitly",
    );
  }
  const base = await mergeBase(repository, candidateRef, branch);
  if (base === null) {
    throw new GitError(
      `unable to determine trusted base: no merge-base between ${candidateRef} and ${branch}; supply --base explicitly`,
    );
  }
  return base;
}

export function relativeArtifact(root: string, path: string): string {
  return relative(root, path);
}
