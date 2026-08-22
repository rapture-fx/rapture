import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runGit } from "./git.js";
import type { TaskContextInjection } from "./models.js";

/**
 * Write injected context into a worktree and hide it from change detection.
 *
 * Paths are confined to the worktree, and every injected path is added to the worktree's
 * git exclude file so `git status` never reports it. Without that, the material an
 * experiment adds would be indistinguishable from work the agent did, and would trip
 * editable-scope enforcement.
 */
export async function materializeTaskContext(
  worktree: string,
  context: TaskContextInjection,
): Promise<void> {
  const root = resolve(worktree);
  for (const [path, content] of Object.entries(context.files)) {
    if (isAbsolute(path)) throw new Error(`injected context path must be relative: ${path}`);
    const target = resolve(root, path);
    const relation = relative(root, target);
    if (relation.startsWith("..") || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      throw new Error(`injected context escaped the worktree: ${path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  if (context.ignorePaths.length > 0) {
    // A linked worktree's `.git` is a file pointing elsewhere, so the exclude path has to
    // come from git itself rather than being assembled by hand. Each linked worktree gets
    // its own info/exclude, so this never touches the base repository.
    const located = await runGit(root, ["rev-parse", "--git-path", "info/exclude"]);
    const excludePath = resolve(root, located.stdout.trim());
    await mkdir(dirname(excludePath), { recursive: true });
    const existing = await readFile(excludePath, "utf8").catch(() => "");
    const already = new Set(existing.split("\n").map((line) => line.trim()));
    const missing = context.ignorePaths.filter((path) => !already.has(path));
    // Linked worktrees share info/exclude with the base checkout, so appending is
    // idempotent by design rather than growing the file once per run.
    if (missing.length > 0) await appendFile(excludePath, `\n${missing.join("\n")}\n`, "utf8");
  }
}
