import { execa } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SourceCheckout {
  readonly dir: string;
  readonly resolvedSha: string;
  dispose(): Promise<void>;
}

/**
 * Materialize an exact source revision in a throwaway git worktree.
 *
 * The primary working tree is never checked out or otherwise mutated: it may
 * hold uncommitted work, and an in-place `git checkout` there would either fail
 * (leaving the previous revision deployed while the result claims the requested
 * one) or discard that work.
 */
export async function checkoutRevision(
  repoRoot: string,
  sourceRevision: string,
): Promise<SourceCheckout> {
  const resolved = await execa("git", ["rev-parse", "--verify", `${sourceRevision}^{commit}`], {
    cwd: repoRoot,
    reject: false,
  });
  if (resolved.exitCode !== 0) {
    throw new Error(`source revision not found in ${repoRoot}: ${sourceRevision}`);
  }
  const resolvedSha = resolved.stdout.trim();

  const dir = await mkdtemp(join(tmpdir(), "rapture-src-"));
  const added = await execa("git", ["worktree", "add", "--detach", dir, resolvedSha], {
    cwd: repoRoot,
    reject: false,
  });
  if (added.exitCode !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`failed to create worktree for ${resolvedSha}: ${added.stderr}`);
  }

  return {
    dir,
    resolvedSha,
    async dispose(): Promise<void> {
      await execa("git", ["worktree", "remove", "--force", dir], { cwd: repoRoot, reject: false });
      await rm(dir, { recursive: true, force: true });
    },
  };
}
