import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { defaultBranch, mergeBase, resolveBaseRef, runGit } from "../src/git.js";

let repo: string;
let baseCommit: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "rapture-zero-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "a.txt"), "base\n");
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    "base",
  ]);
  baseCommit = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  await runGit(repo, ["checkout", "-b", "feature", "-q"]);
  await writeFile(join(repo, "a.txt"), "head\n");
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    "head",
  ]);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("detects the default branch", async () => {
  expect(await defaultBranch(repo)).toBe("main");
});

it("computes merge-base", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  expect(await mergeBase(repo, head, "main")).toBe(baseCommit);
});

it("resolves base automatically when omitted", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  expect(await resolveBaseRef(repo, undefined, head)).toBe(baseCommit);
});

it("honors an explicit base", async () => {
  const explicit = "HEAD~1";
  expect(await resolveBaseRef(repo, explicit, "HEAD")).toBe(explicit);
});
