import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { formatVerificationIntegrity, runVerificationIntegrity } from "../src/integrity-report.js";

let repo: string;

async function commitAll(message: string): Promise<string> {
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    message,
  ]);
  return (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "rapture-verify-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await mkdir(join(repo, ".github", "workflows"), { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, ".github", "workflows", "ci.yml"), "jobs: build\n");
  await writeFile(join(repo, "src", "app.ts"), "export const answer = 42;\n");
  await writeFile(join(repo, "src", "app.test.ts"), "expect(1).toBe(1);\nexpect(2).toBe(2);\n");
  await writeFile(join(repo, "tsconfig.json"), '{\n  "strict": true\n}\n');
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("returns ACCEPT for a clean documentation change", async () => {
  const base = await commitAll("base");
  await writeFile(join(repo, "README.md"), "# hello\n");
  const candidate = await commitAll("docs");

  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
  });
  expect(report.verdict).toBe("ACCEPT");
  expect(report.signals).toEqual([]);
  expect(report.productionChangeWithoutTestEvidence).toBe(false);
  expect(formatVerificationIntegrity(report)).toContain("VERDICT: ACCEPT");
});

it("rejects a commit that deletes tests and suppresses checks", async () => {
  const base = await commitAll("clean-state");
  await runGit(repo, ["rm", "-q", "src/app.test.ts"]);
  await mkdir(join(repo, "scripts"), { recursive: true });
  await writeFile(join(repo, "scripts", "run.sh"), "node build.mjs || true\n");
  await writeFile(join(repo, "tsconfig.json"), '{\n  "strict": false\n}\n');
  await writeFile(join(repo, "src", "api.ts"), "try { go(); } catch (e) {}\n");
  const candidate = await commitAll("weaken everything");

  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
  });
  expect(report.verdict).toBe("REJECT");
  const kinds = new Set(report.signals.map((signal) => signal.kind));
  expect(kinds).toContain("test_file_deleted");
  expect(kinds).toContain("exit_code_handling_weakened");
  expect(kinds).toContain("static_analysis_suppressed");
  expect(kinds).toContain("error_handling_suppressed");

  const formatted = formatVerificationIntegrity(report);
  expect(formatted).toContain("VERIFICATION INTEGRITY");
  expect(formatted).toContain("VERDICT: REJECT");
});

it("warns when production code changes without any test evidence", async () => {
  const base = await commitAll("post-weaken");
  await writeFile(join(repo, "src", "app.ts"), "export const answer = 43;\n");
  const candidate = await commitAll("production-only change");

  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
  });
  expect(report.verdict).toBe("WARN");
  expect(report.productionChangeWithoutTestEvidence).toBe(true);
  expect(report.signals).toEqual([]);
});

it("accepts a change that touches both production code and its tests", async () => {
  const base = await commitAll("warn-state");
  await writeFile(join(repo, "src", "app.ts"), "export const answer = 44;\n");
  await writeFile(join(repo, "src", "app.test.ts"), "expect(answer).toBe(44);\n");
  const candidate = await commitAll("code + test");

  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
  });
  expect(report.verdict).toBe("ACCEPT");
  expect(report.productionChangeWithoutTestEvidence).toBe(false);
});
