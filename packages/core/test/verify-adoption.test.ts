import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "@rapture/kernel";
import { afterAll, beforeAll, expect, it } from "vitest";
import { findGitRoot, resolveBaseRef, runGit } from "../src/git.js";
import { runVerificationIntegrity } from "../src/integrity-report.js";

let repo: string;

async function commitAll(message: string): Promise<string> {
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "rapture-adoption-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "app.ts"), "export const a = 1;\n");
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
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("findGitRoot returns null outside a git repository", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rapture-nogit-"));
  expect(await findGitRoot(tmp)).toBeNull();
  await rm(tmp, { recursive: true, force: true });
});

it("findGitRoot discovers repo from subdirectory", async () => {
  await mkdir(join(repo, "src", "nested"), { recursive: true });
  const found = await findGitRoot(join(repo, "src", "nested"));
  expect(found).not.toBeNull();
  if (found === null) throw new Error("expected git root");
  const { realpath } = await import("node:fs/promises");
  expect(await realpath(found)).toBe(await realpath(repo));
});

it("candidate defaults to HEAD — verify with explicit base still works", async () => {
  const base = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  await writeFile(join(repo, "app.ts"), "export const a = 2;\n");
  const head = await commitAll("change");
  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: head,
  });
  expect(report.baseRef).toBe(base);
  expect(report.candidateRef).toBe(head);
  expect(report.baseSha).toBe(base);
  expect(report.candidateSha).toBe(head);
});

it("explicit base override is honored over auto-detection", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  const explicitBase = "HEAD~1";
  const resolved = await resolveBaseRef(repo, explicitBase, head);
  expect(resolved).toBe(explicitBase);
});

it("auto base resolves via merge-base deterministically", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  const first = await resolveBaseRef(repo, undefined, head);
  const second = await resolveBaseRef(repo, undefined, head);
  expect(first).toBe(second);
});

it("fails closed when no trustworthy base can be determined", async () => {
  const orphanRepo = await mkdtemp(join(tmpdir(), "rapture-orphan-"));
  await runGit(orphanRepo, ["init", "-q"]);
  await writeFile(join(orphanRepo, "file.txt"), "x\n");
  await runGit(orphanRepo, ["add", "-A"]);
  await runGit(orphanRepo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    "init",
  ]);
  // Remove any main/master refs to force no trustworthy base
  await runGit(orphanRepo, ["branch", "-D", "main"], { allowFailure: true });
  await runGit(orphanRepo, ["branch", "-D", "master"], { allowFailure: true });
  // Create orphan branch with no common history
  await runGit(orphanRepo, ["checkout", "--orphan", "orphan", "-q"]);
  await writeFile(join(orphanRepo, "other.txt"), "y\n");
  await runGit(orphanRepo, ["add", "-A"]);
  await runGit(orphanRepo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    "orphan",
  ]);
  const head = (await runGit(orphanRepo, ["rev-parse", "HEAD"])).stdout.trim();
  await expect(resolveBaseRef(orphanRepo, undefined, head)).rejects.toThrow(
    /unable to determine trusted base/u,
  );
  await rm(orphanRepo, { recursive: true, force: true });
});

it("invariants auto-load and explicit override are respected", async () => {
  await mkdir(join(repo, ".rapture"), { recursive: true });
  await writeFile(
    join(repo, ".rapture", "invariants.json"),
    JSON.stringify({ schemaVersion: 1, protectedPaths: ["protected/**"] }),
  );
  const { loadInvariantsFromRepo } = await import("../src/integrity-report.js");
  const auto = await loadInvariantsFromRepo(repo);
  expect(auto?.protectedPaths).toContain("protected/**");
  // explicit override via parseInvariantsFile
  const tmpInv = join(repo, "custom-invariants.json");
  await writeFile(tmpInv, JSON.stringify({ schemaVersion: 1, protectedPaths: ["other/**"] }));
  const { parseInvariantsFile } = await import("@rapture/kernel");
  const explicit = await parseInvariantsFile(tmpInv);
  expect(explicit.protectedPaths).toEqual(["other/**"]);
});

it("structured JSON output is deterministic via canonicalization", async () => {
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  const base = (await runGit(repo, ["rev-parse", "HEAD~1"])).stdout.trim();
  const report1 = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: head,
  });
  const report2 = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: head,
  });
  const { generatedAt: _a, ...rest1 } = report1;
  const { generatedAt: _b, ...rest2 } = report2;
  expect(canonicalize(rest1)).toBe(canonicalize(rest2));
  // also verify required fields exist
  expect(report1.schemaVersion).toBe(1);
  expect(["ACCEPT", "WARN", "REJECT"]).toContain(report1.verdict);
  expect(typeof report1.baseSha).toBe("string");
  expect(typeof report1.candidateSha).toBe("string");
  expect(Array.isArray(report1.signals)).toBe(true);
  expect(typeof report1.invariants).toBe("object");
  expect(report1.invariants.source).toBeDefined();
});

it("GitHub Action adapter does not duplicate detector logic", async () => {
  const actionPath = join(process.cwd(), ".github", "actions", "verify", "action.yml");
  // Try repo root if running from package dir
  const candidates = [actionPath, join(process.cwd(), "../../.github/actions/verify/action.yml")];
  let content: string | null = null;
  for (const p of candidates) {
    try {
      content = await readFile(p, "utf8");
      break;
    } catch {}
  }
  if (content === null) {
    // fallback: locate via git root
    const root = await findGitRoot(process.cwd());
    if (root) content = await readFile(join(root, ".github/actions/verify/action.yml"), "utf8");
  }
  expect(content).not.toBeNull();
  if (content === null) throw new Error("expected action content");
  // Must delegate to CLI/core, not reimplement signals
  expect(content).toContain("apps/cli/dist/index.js");
  expect(content).not.toContain("test_file_deleted");
  expect(content).not.toContain("detectIntegritySignals");
});
