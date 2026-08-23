import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLocalWorktreeExecutor } from "../src/exec/local-worktree.js";
import { runGit } from "../src/git.js";

let repository: string;
let worktreesRoot: string;
let baseCommit: string;

async function commitAll(message: string): Promise<string> {
  await runGit(repository, ["add", "-A"]);
  await runGit(repository, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@invalid.example",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return (await runGit(repository, ["rev-parse", "HEAD"])).stdout.trim();
}

beforeAll(async () => {
  repository = await mkdtemp(join(tmpdir(), "rapture-exec-repo-"));
  worktreesRoot = await mkdtemp(join(tmpdir(), "rapture-exec-wt-"));
  await runGit(repository, ["init", "-q", "-b", "main"]);
  await writeFile(join(repository, "app.txt"), "base content\n");
  baseCommit = await commitAll("base");
});

afterAll(async () => {
  await rm(worktreesRoot, { recursive: true, force: true }).catch(() => {});
});

it("prepares an isolated sandbox at the base commit", async () => {
  const executor = createLocalWorktreeExecutor({ worktreesRoot });
  const sandbox = await executor.prepare({
    repository,
    baseCommit,
    sandboxId: "sb_isolated",
  });
  expect(await readFile(join(sandbox.root, "app.txt"), "utf8")).toBe("base content\n");
  await executor.dispose(sandbox);
});

it("runs commands inside the sandbox without touching the source repository", async () => {
  const executor = createLocalWorktreeExecutor({ worktreesRoot });
  const sandbox = await executor.prepare({
    repository,
    baseCommit,
    sandboxId: "sb_runs",
  });
  const result = await executor.run(
    sandbox,
    [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('made.txt', 'hi\\n'); console.log('ran')",
    ],
    { timeoutMs: 30_000 },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("ran");
  expect(await readFile(join(sandbox.root, "made.txt"), "utf8")).toBe("hi\n");
  let missing = false;
  await access(join(repository, "made.txt")).catch(() => {
    missing = true;
  });
  expect(missing).toBe(true);
  await executor.dispose(sandbox);
});

it("honors env overrides", async () => {
  const executor = createLocalWorktreeExecutor({ worktreesRoot });
  const sandbox = await executor.prepare({
    repository,
    baseCommit,
    sandboxId: "sb_env",
  });
  const envResult = await executor.run(
    sandbox,
    [process.execPath, "-e", "process.stdout.write(process.env.HELLO ?? '')"],
    { timeoutMs: 30_000, env: { ...process.env, HELLO: "from-env" } as Record<string, string> },
  );
  expect(envResult.stdout).toBe("from-env");
  await executor.dispose(sandbox);
});

it("rejects unsafe sandbox ids and disposes idempotently-safely", async () => {
  const executor = createLocalWorktreeExecutor({ worktreesRoot });
  await expect(
    executor.prepare({ repository, baseCommit, sandboxId: "../escape" }),
  ).rejects.toThrow(/sandbox ID/u);
  await executor.dispose({ id: "never-prepared", root: "/nowhere" });
});

it("refuses to run against forged or unknown sandboxes", async () => {
  const executor = createLocalWorktreeExecutor({ worktreesRoot });
  await expect(
    executor.run({ id: "ghost", root: join(worktreesRoot, "ghost") }, ["echo", "hi"], {
      timeoutMs: 5_000,
    }),
  ).rejects.toThrow(/unknown sandbox/u);

  const sandbox = await executor.prepare({
    repository,
    baseCommit,
    sandboxId: "sb_forged",
  });
  await expect(
    executor.run({ id: "sb_forged", root: "/etc" }, ["ls"], { timeoutMs: 5_000 }),
  ).rejects.toThrow(/root mismatch/u);
  await expect(
    executor.run(sandbox, ["ls"], { timeoutMs: 5_000, cwd: "../../.." }),
  ).rejects.toThrow(/escaped sandbox/u);
  await executor.dispose(sandbox);
});
