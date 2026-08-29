import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (v: string) => out.push(v),
      stderr: (v: string) => err.push(v),
    },
    out,
    err,
  };
}

describe("CLI profiler commands", () => {
  let repo: string;
  let prevCwd: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "cli-profiler-"));
    const { spawn } = await import("node:child_process");
    const run = (args: string[]) =>
      new Promise<void>((res, rej) => {
        const p = spawn("git", args, { cwd: repo });
        p.on("close", (c) => (c === 0 ? res() : rej(new Error(`git ${args.join(" ")} exit ${c}`))));
      });
    await run(["init"]);
    await run(["config", "user.email", "t@t.com"]);
    await run(["config", "user.name", "t"]);
    await writeFile(join(repo, "README.md"), "# test");
    await run(["add", "."]);
    await run(["commit", "-m", "init"]);
    prevCwd = process.cwd();
    process.chdir(repo);
  });
  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(repo, { recursive: true, force: true });
  });

  it("runs list empty returns 0 and message", async () => {
    const { io, out } = makeIo();
    const code = await main(["runs", "list"], io);
    expect(code).toBe(0);
    expect(out.join("")).toContain("No runs");
  });

  it("runs show missing returns 2", async () => {
    const { io, err } = makeIo();
    const code = await main(["runs", "show", "nonexistent"], io);
    expect(code).toBe(2);
    expect(err.join("")).toContain("not found");
  });

  it("analyze --all with no runs returns 2", async () => {
    const { io } = makeIo();
    const code = await main(["analyze", "--all"], io);
    expect(code).toBe(2);
  });

  it("profile requires task", async () => {
    const { io, err } = makeIo();
    const code = await main(["profile", "opencode"], io);
    expect(code).toBe(2);
    expect(err.join("")).toContain("requires --task");
  });

  it("analyze missing run id returns 2", async () => {
    const { io } = makeIo();
    const code = await main(["analyze", "bad-id"], io);
    expect(code).toBe(2);
  });

  it("runs list --json outputs array", async () => {
    const { io, out } = makeIo();
    const code = await main(["runs", "list", "--json"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("creates synthetic run and analyze", async () => {
    // manually create a run to test analyze pipeline
    const { generateRunId, storeRunTrace } = await import("@rapture/profiler");
    const { sha256Hex } = await import("@rapture/profiler");
    const runId = generateRunId();
    const meta = {
      runId,
      traceVersion: "1" as const,
      agent: "opencode",
      agentVersion: "test",
      model: "m",
      provider: "opencode",
      task: "hello",
      taskHash: sha256Hex("hello"),
      taskFile: null,
      repositoryRoot: repo,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 100,
      exitCode: 0,
      status: "completed" as const,
      repoBefore: {
        head: "abc",
        tree: "tree1",
        branch: "main",
        dirty: false,
        statusPorcelain: "",
        untrackedCount: 0,
        modifiedCount: 0,
      },
      repoAfter: {
        head: "abc",
        tree: "tree1",
        branch: "main",
        dirty: false,
        statusPorcelain: "",
        untrackedCount: 0,
        modifiedCount: 0,
      },
      opencodeSessionId: null,
      tokenUsage: null,
      incompleteReason: null,
    };
    const op = {
      seq: 0,
      timestamp: new Date().toISOString(),
      opClass: "file_read" as const,
      tool: "read",
      rawType: "tool",
      identityKey: `file_read:a.txt:${sha256Hex("content")}`,
      displayName: "read:a.txt",
      filePath: "a.txt",
      contentHash: sha256Hex("content"),
      byteLength: 7,
      command: null,
      normalizedCommand: null,
      workdir: null,
      exitCode: null,
      durationMs: null,
      searchPattern: null,
      searchPath: null,
      repoTree: "tree1",
      raw: {},
    };
    await storeRunTrace(repo, { metadata: meta, rawEvents: [], operations: [op] });
    const { io: io2, out: out2 } = makeIo();
    const code2 = await main(["runs", "show", runId], io2);
    expect(code2).toBe(0);
    expect(out2.join("")).toContain("RAPTURE AGENT COMPUTE PROFILE");

    const { io: io3, out: out3 } = makeIo();
    const code3 = await main(["analyze", runId], io3);
    expect(code3).toBe(0);
    expect(out3.join("")).toContain("RAPTURE AGENT COMPUTE PROFILE");
  });

  it("experiment run with invalid manifest returns 2", async () => {
    const bad = join(repo, "bad.json");
    await writeFile(
      bad,
      JSON.stringify({ version: 1, agent: "opencode", mode: "bad", repository: repo, tasks: [] }),
    );
    const { io } = makeIo();
    const code = await main(["experiment", "run", bad], io);
    expect(code).toBe(2);
  });
});
