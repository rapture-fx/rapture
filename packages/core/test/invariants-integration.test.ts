import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  emptyInvariants,
  parseInvariants,
} from "@rapture/kernel";
import { loadInvariantsFromRepo } from "../src/integrity-report.js";
import { runVerificationIntegrity } from "../src/integrity-report.js";
import { runGit } from "../src/git.js";

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
  repo = await mkdtemp(join(tmpdir(), "rapture-invariants-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("loads .rapture/invariants.json when present and null when absent", async () => {
  expect(await loadInvariantsFromRepo(repo)).toBeNull();
  await mkdir(join(repo, ".rapture"), { recursive: true });
  await writeFile(
    join(repo, ".rapture", "invariants.json"),
    JSON.stringify({
      schemaVersion: 1,
      protectedPaths: ["validation/**"],
      ignorePaths: ["generated/**"],
      testFilePatterns: ["suites/**/*.spec.ts"],
    }),
  );
  const config = await loadInvariantsFromRepo(repo);
  expect(config?.protectedPaths).toEqual(["validation/**"]);
  void emptyInvariants;
});

it("honors protectedPaths declared by the repository", async () => {
  const base = await commitAll("pre-invariants");
  await writeFile(join(repo, ".rapture", "invariants.json"), JSON.stringify({
    schemaVersion: 1,
    protectedPaths: ["tools/verify.mjs"],
  }));
  await commitAll("declare invariants");
  await mkdir(join(repo, "tools"), { recursive: true });
  await writeFile(join(repo, "tools", "verify.mjs"), "process.exit(0);\n");
  const candidate = await commitAll("touch the verifier");

  const withoutPack = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
  });
  const withPack = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: candidate,
    invariants: parseInvariants({
      schemaVersion: 1,
      protectedPaths: ["tools/verify.mjs"],
    }),
  });

  expect(withoutPack.signals.some((signal) => signal.kind === "protected_file_modified")).toBe(false);
  expect(withPack.signals.some((signal) => signal.kind === "protected_file_modified")).toBe(true);
});

it("honors ignorePaths declared by the repository", async () => {
  const base = await commitAll("ignore-base");
  await mkdir(join(repo, "generated"), { recursive: true });
  await writeFile(join(repo, "generated", "stub.sh"), "# rebuilt\n");
  const head = await commitAll("regen");

  const config = parseInvariants({ schemaVersion: 1, ignorePaths: ["generated/**"] });
  const report = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: head,
    invariants: config,
  });
  const unfiltered = await runVerificationIntegrity({
    repository: repo,
    baseRef: base,
    candidateRef: head,
  });
  expect(unfiltered.totalSignals ?? 0).toBeGreaterThanOrEqual(0);
  expect(report.signals.length).toBeLessThanOrEqual(unfiltered.signals.length);
  expect(report.signals.some((signal) => signal.path.startsWith("generated/"))).toBe(false);
});
