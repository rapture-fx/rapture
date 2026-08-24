import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInvariants } from "@rapture/kernel";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { buildTrustMap, formatTrustMapMarkdown } from "../src/trustmap.js";

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "rapture-trustmap-"));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, ".github", "workflows"), { recursive: true });
  await writeFile(join(repo, "src", "app.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "src", "app.test.ts"), "expect(1).toBe(1);\n");
  await writeFile(join(repo, ".github", "workflows", "ci.yml"), "jobs:\n  build:\n");
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
    "init",
  ]);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

it("classifies the verification surface and flags agent-modifiable claims", async () => {
  const map = await buildTrustMap({ repository: repo, ref: "HEAD" });

  const testsRow = map.rows.find((row) => row.claim.startsWith("Tests pass"));
  expect(testsRow?.surfaceFiles).toContain("src/app.test.ts");
  expect(testsRow?.agentModifiable).toBe(true);
  expect(testsRow?.independent).toBe(false);

  const ciRow = map.rows.find((row) => row.claim.startsWith("CI checks"));
  expect(ciRow?.surfaceFiles).toContain(".github/workflows/ci.yml");
  expect(ciRow?.agentModifiable).toBe(true);

  const oracleRow = map.rows.find((row) => row.claim.startsWith("Independent oracle"));
  expect(oracleRow?.independent).toBe(false);
});

it("marks declared protected surfaces as independent", async () => {
  const invariants = parseInvariants({
    schemaVersion: 1,
    protectedPaths: [".github/workflows/**", "**/*.test.ts"],
  });
  const map = await buildTrustMap({
    repository: repo,
    ref: "HEAD",
    invariants,
  });
  const ciRow = map.rows.find((row) => row.claim.startsWith("CI checks"));
  expect(ciRow?.agentModifiable).toBe(false);
  const testsRow = map.rows.find((row) => row.claim.startsWith("Tests pass"));
  expect(testsRow?.agentModifiable).toBe(false);

  const markdown = formatTrustMapMarkdown(map);
  expect(markdown).toContain("| Claim | Evidence surface | Agent-modifiable | Independent |");
  expect(markdown).toContain("✅ No agent-modifiable acceptance claims detected.");
});

it("warns when claims rest on modifiable evidence", async () => {
  const map = await buildTrustMap({ repository: repo, ref: "HEAD" });
  const markdown = formatTrustMapMarkdown(map);
  expect(markdown).toContain("⚠️");
  expect(markdown).toMatch(/acceptance claim\(s\) rest on evidence the agent can modify/u);
});
