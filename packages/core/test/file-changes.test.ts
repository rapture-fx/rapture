import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { collectFileChanges } from "../src/git.js";
import { runGit } from "../src/git.js";

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "rapture-filechanges-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@invalid.example", "commit", "--allow-empty", "-q", "-m", "init"]);
  await writeFile(join(repo, "kept.txt"), "original\n");
  await writeFile(join(repo, "removed.txt"), "doomed\n");
  await runGit(repo, ["add", "."]);
  await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@invalid.example", "commit", "-q", "-m", "base"]);
});

afterAll(async () => {
  await runGit(repo, ["clean", "-fd"], { allowFailure: true });
});

it("classifies added, modified, and deleted files against the base commit", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  await writeFile(join(repo, "kept.txt"), "changed\n");
  await writeFile(join(repo, "new.txt"), "brand new\n");
  await runGit(repo, ["rm", "-q", "removed.txt"]);

  const changes = await collectFileChanges(repo, head, [
    "kept.txt",
    "new.txt",
    "removed.txt",
  ]);

  expect(changes).toEqual([
    { path: "kept.txt", status: "modified", before: "original\n", after: "changed\n" },
    { path: "new.txt", status: "added", before: null, after: "brand new\n" },
    { path: "removed.txt", status: "deleted", before: "doomed\n", after: null },
  ]);
});
