import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { signalSeverity } from "../src/severity.js";
import { formatScanMarkdown, runVerificationScan } from "../src/verification-scan.js";

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
  repo = await mkdtemp(join(tmpdir(), "rapture-scan-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("assigns severity by kind and escalates sensitive paths", () => {
  expect(signalSeverity({ kind: "test_file_deleted", path: "src/a.test.ts", detail: "" })).toBe(
    "critical",
  );
  expect(signalSeverity({ kind: "test_skipped", path: "tests/x.test.ts", detail: "" })).toBe(
    "high",
  );
  const authSkip = signalSeverity({
    kind: "test_skipped",
    path: "tests/auth-login.test.ts",
    detail: "",
  });
  expect(authSkip).toBe("critical");
  expect(
    signalSeverity({ kind: "protected_file_modified", path: "tools/validator.mjs", detail: "" }),
  ).toBe("medium");
  expect(
    signalSeverity({
      kind: "protected_file_modified",
      path: "validation/payment-check.ts",
      detail: "",
    }),
  ).toBe("high");
});

it("attributes weakening to the exact commits that introduced it", async () => {
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "app.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src", "app.test.ts"), "expect(1).toBe(1);\n");
  const base = await commitAll("base");

  await writeFile(join(repo, "README.md"), "# clean\n");
  const cleanCommit = await commitAll("docs only");

  await runGit(repo, ["rm", "-q", "src/app.test.ts"]);
  const weakening = await commitAll("drop the inconvenient test");

  const scan = await runVerificationScan({
    repository: repo,
    baseRef: base,
    headRef: weakening,
  });

  expect(scan.commitsScanned).toBe(2);
  expect(scan.criticalCount).toBe(1);
  expect(scan.overallVerdict).toBe("REJECT");

  const cleanFinding = scan.findings.find((finding) => finding.commit === cleanCommit);
  expect(cleanFinding?.signals ?? []).toEqual([]);

  const badFinding = scan.findings.find((finding) => finding.commit === weakening);
  expect(badFinding?.signals.map((signal) => signal.kind)).toContain("test_file_deleted");
  expect(badFinding?.signals[0]?.severity).toBe("critical");
  expect(badFinding?.subject).toBe("drop the inconvenient test");

  const markdown = formatScanMarkdown(scan);
  expect(markdown).toContain("# Agent Verification Integrity Audit");
  expect(markdown).toContain("**[CRITICAL]** `src/app.test.ts`");
  expect(markdown).toContain("OVERALL VERDICT: REJECT");
  expect(markdown).toContain("| Clean commits | 1/2 |");
});

it("accepts a fully clean window", async () => {
  const base = await commitAll("scan-clean-base");
  await mkdir(join(repo, "docs"), { recursive: true });
  await writeFile(join(repo, "docs", "note.md"), "text\n");
  const head = await commitAll("more docs");

  const scan = await runVerificationScan({ repository: repo, baseRef: base, headRef: head });
  expect(scan.overallVerdict).toBe("ACCEPT");
  expect(scan.totalSignals).toBe(0);
  expect(formatScanMarkdown(scan)).toContain("VERDICT: ACCEPT");
});
