import { execa } from "execa";
import type { RepoState } from "./schema.js";

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa("git", args, { cwd, reject: false, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout ?? "", exitCode: result.exitCode ?? 0 };
}

export async function getRepoState(cwd: string): Promise<RepoState> {
  const headRes = await runGit(cwd, ["rev-parse", "HEAD"]);
  const head = headRes.exitCode === 0 ? headRes.stdout.trim() : null;

  const treeRes = head
    ? await runGit(cwd, ["rev-parse", `${head}^{tree}`])
    : { stdout: "", exitCode: 1 };
  const tree = treeRes.exitCode === 0 ? treeRes.stdout.trim() : null;

  const branchRes = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : null;

  const statusRes = await runGit(cwd, ["status", "--porcelain"]);
  const statusPorcelain = statusRes.stdout ?? "";
  const lines = statusPorcelain.split("\n").filter((l) => l.length > 0);
  let untracked = 0;
  let modified = 0;
  for (const line of lines) {
    if (line.startsWith("??")) untracked++;
    else modified++;
  }
  const dirty = lines.length > 0;

  return {
    head,
    tree,
    branch: branch === "HEAD" ? null : branch,
    dirty,
    statusPorcelain,
    untrackedCount: untracked,
    modifiedCount: modified,
  };
}

export async function ensureCleanReset(cwd: string): Promise<void> {
  await execa("git", ["reset", "--hard", "HEAD"], { cwd, reject: false });
  await execa("git", ["clean", "-fd"], { cwd, reject: false });
}

export async function getHead(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["rev-parse", "HEAD"]);
  return res.exitCode === 0 ? res.stdout.trim() : null;
}

export async function getAgentVersion(): Promise<string | null> {
  const res = await execa("opencode", ["--version"], { reject: false });
  if (res.exitCode === 0) return res.stdout.trim();
  return null;
}
