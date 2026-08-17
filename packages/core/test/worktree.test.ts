import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveCommit } from "../src/git.js";
import { createWorktreeManager } from "../src/worktree.js";
import { createGitRepository } from "./helpers.js";

it("rejects worktree path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-worktree-"));
  const repository = await createGitRepository(root);
  const manager = await createWorktreeManager(repository, join(root, "worktrees"));
  expect(() => manager.pathFor("../../escape")).toThrow(/unsafe/u);
});

it("refuses to reuse an existing worktree path", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-worktree-"));
  const repository = await createGitRepository(root);
  const manager = await createWorktreeManager(repository, join(root, "worktrees"));
  await mkdir(manager.pathFor("existing"));
  await expect(manager.create("existing", await resolveCommit(repository, "HEAD"))).rejects.toThrow(
    /already exists/u,
  );
});
