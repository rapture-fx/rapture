import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCrossRun, deriveProfile } from "../src/analysis.js";
import { sha256Hex } from "../src/hash.js";
import { expandManifest, loadManifest, validateManifest } from "../src/manifest.js";
import { isDeterministicReusable, normalizeRawEvents } from "../src/normalize.js";
import { hashTask, redactEnv, redactRecord, redactString } from "../src/redact.js";
import type { NormalizedOperation, RawEvent, RunMetadata, RunTrace } from "../src/schema.js";
import { TRACE_VERSION } from "../src/schema.js";
import { generateRunId, listRuns, loadRunTrace, storeRunTrace } from "../src/storage.js";

function makeRaw(seq: number, type: string, data: unknown): RawEvent {
  return { seq, timestamp: new Date().toISOString(), type, data };
}

function makeFileReadOp(
  filePath: string,
  content: string,
  tree: string | null,
  seq = 0,
): NormalizedOperation {
  return {
    seq,
    timestamp: new Date().toISOString(),
    opClass: "file_read",
    tool: "read",
    rawType: "tool",
    identityKey: `file_read:${filePath}:${sha256Hex(content)}`,
    displayName: `read:${filePath}`,
    filePath,
    contentHash: sha256Hex(content),
    byteLength: Buffer.byteLength(content),
    command: null,
    normalizedCommand: null,
    workdir: null,
    exitCode: null,
    durationMs: null,
    searchPattern: null,
    searchPath: null,
    repoTree: tree,
    raw: {},
  };
}

function makeSearchOp(
  pattern: string,
  path: string | null,
  tree: string | null,
  seq = 0,
): NormalizedOperation {
  const normalizedPattern = pattern;
  return {
    seq,
    timestamp: new Date().toISOString(),
    opClass: "search",
    tool: "grep",
    rawType: "tool",
    identityKey: `search:${pattern}:${path ?? ""}:${tree ?? "no-tree"}`,
    displayName: `grep:${pattern}:${path ?? ""}`,
    filePath: null,
    contentHash: null,
    byteLength: null,
    command: null,
    normalizedCommand: null,
    workdir: null,
    exitCode: null,
    durationMs: null,
    searchPattern: normalizedPattern,
    searchPath: path,
    repoTree: tree,
    raw: {},
  };
}

function makeShellOp(cmd: string, tree: string | null, seq = 0): NormalizedOperation {
  const normalized = cmd.replace(/\s+/g, " ").trim();
  const cls = cmd.startsWith("git") ? "git" : cmd.includes("vitest") ? "test" : "shell";
  return {
    seq,
    timestamp: new Date().toISOString(),
    opClass: cls as NormalizedOperation["opClass"],
    tool: "bash",
    rawType: "tool",
    identityKey: `${cls}:${normalized}:${tree ?? "no-tree"}`,
    displayName: `${cls}:${normalized}`,
    filePath: null,
    contentHash: null,
    byteLength: null,
    command: cmd,
    normalizedCommand: normalized,
    workdir: "/repo",
    exitCode: 0,
    durationMs: 100,
    searchPattern: null,
    searchPath: null,
    repoTree: tree,
    raw: {},
  };
}

function makeMetadata(overrides: Partial<RunMetadata> & { runId: string }): RunMetadata {
  return {
    traceVersion: TRACE_VERSION,
    agent: "opencode",
    agentVersion: "1.18.25",
    model: "test-model",
    provider: "opencode",
    task: "test task",
    taskHash: sha256Hex("test task"),
    taskFile: null,
    repositoryRoot: "/tmp/repo",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationMs: 1000,
    exitCode: 0,
    status: "completed",
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
    tokenUsage: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    incompleteReason: null,
    ...overrides,
  };
}

describe("Secret redaction", () => {
  it("redacts authorization bearer", () => {
    expect(redactString("authorization: Bearer sk-abc123 secretXYZ")).toContain("[REDACTED]");
    expect(redactString("authorization: Bearer sk-abc123")).not.toContain("sk-abc123");
  });
  it("redacts api_key pattern", () => {
    expect(redactString("api_key=supersecret123")).toContain("[REDACTED]");
    expect(redactString("api_key=supersecret123")).not.toContain("supersecret123");
  });
  it("redacts sk- tokens", () => {
    expect(redactString("sk-abcdef1234567890abcdef")).toBe("[REDACTED]");
  });
  it("redacts JWT", () => {
    const jwt =
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signaturePartMoreThan10Chars";
    // our pattern requires 3 parts each >=10
    expect(redactString(`token ${jwt} end`)).toContain("[REDACTED]");
  });
  it("redacts env secrets", () => {
    const env = redactEnv({ OPENAI_API_KEY: "sk-123", NORMAL_VAR: "hello", SECRET_TOKEN: "abc" });
    expect(env["OPENAI_API_KEY"]).toBe("[REDACTED]");
    expect(env["SECRET_TOKEN"]).toBe("[REDACTED]");
    expect(env["NORMAL_VAR"]).toBe("hello");
  });
  it("redacts record fields", () => {
    const out = redactRecord({
      api_key: "secret",
      nested: { password: "123", ok: "value" },
    }) as Record<string, unknown>;
    expect(out["api_key"]).toBe("[REDACTED]");
    const nested = out["nested"] as Record<string, unknown>;
    expect(nested["password"]).toBe("[REDACTED]");
    expect(nested["ok"]).toBe("value");
  });
  it("hashTask is deterministic", () => {
    expect(hashTask("hello")).toBe(hashTask("hello"));
    expect(hashTask("hello")).not.toBe(hashTask("world"));
  });
});

describe("Operation normalization", () => {
  it("normalizes file_read via read tool", () => {
    const raw = makeRaw(0, "tool", {
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "src/app.ts" },
        output: "file content here",
      },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops.length).toBe(1);
    expect(ops[0]!.opClass).toBe("file_read");
    expect(ops[0]!.filePath).toBe("src/app.ts");
    expect(ops[0]!.contentHash).toBe(sha256Hex("file content here"));
  });
  it("normalizes grep as search", () => {
    const raw = makeRaw(0, "tool", {
      tool: "grep",
      state: { status: "completed", input: { pattern: "foo", path: "src" }, output: "match" },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.opClass).toBe("search");
    expect(ops[0]!.searchPattern).toBe("foo");
  });
  it("normalizes bash git as git class", () => {
    const raw = makeRaw(0, "tool", {
      tool: "bash",
      state: { status: "completed", input: { command: "git status" }, output: "" },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.opClass).toBe("git");
    expect(ops[0]!.normalizedCommand).toBe("git status");
  });
  it("normalizes bash test command", () => {
    const raw = makeRaw(0, "tool", {
      tool: "bash",
      state: { status: "completed", input: { command: "pnpm vitest run" }, output: "" },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.opClass).toBe("test");
  });
  it("normalizes bash build", () => {
    const raw = makeRaw(0, "tool", {
      tool: "bash",
      state: { status: "completed", input: { command: "pnpm build" }, output: "" },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.opClass).toBe("build");
  });
  it("directory_list for directory reads", () => {
    const raw = makeRaw(0, "tool", {
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp" },
        output: "<path>/tmp</path>\n<type>directory</type>",
      },
    });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.opClass).toBe("directory_list");
  });
  it("produces stable identity keys", () => {
    const raw1 = makeRaw(0, "tool", {
      tool: "read",
      state: { status: "completed", input: { filePath: "a.ts" }, output: "content" },
    });
    const raw2 = makeRaw(1, "tool", {
      tool: "read",
      state: { status: "completed", input: { filePath: "a.ts" }, output: "content" },
    });
    const ops = normalizeRawEvents([raw1, raw2], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.identityKey).toBe(ops[1]!.identityKey);
  });
  it("different content produces different identity", () => {
    const raw1 = makeRaw(0, "tool", {
      tool: "read",
      state: { status: "completed", input: { filePath: "a.ts" }, output: "content1" },
    });
    const raw2 = makeRaw(1, "tool", {
      tool: "read",
      state: { status: "completed", input: { filePath: "a.ts" }, output: "content2" },
    });
    const ops = normalizeRawEvents([raw1, raw2], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops[0]!.identityKey).not.toBe(ops[1]!.identityKey);
  });
  it("search identity includes tree", () => {
    const raw = makeRaw(0, "tool", {
      tool: "grep",
      state: { status: "completed", input: { pattern: "foo" }, output: "" },
    });
    const ops1 = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    const ops2 = normalizeRawEvents([raw], { repoTree: "tree2", repoRoot: "/repo" });
    expect(ops1[0]!.identityKey).not.toBe(ops2[0]!.identityKey);
  });
  it("ignores non-tool events", () => {
    const raw = makeRaw(0, "text", { type: "text", text: "hello" });
    const ops = normalizeRawEvents([raw], { repoTree: "tree1", repoRoot: "/repo" });
    expect(ops.length).toBe(0);
  });
});

describe("File/blob identity", () => {
  it("same content same hash across runs", () => {
    const c = "identical content";
    const op1 = makeFileReadOp("src/a.ts", c, "tree1");
    const op2 = makeFileReadOp("src/a.ts", c, "tree1");
    expect(op1.identityKey).toBe(op2.identityKey);
    expect(op1.contentHash).toBe(op2.contentHash);
  });
  it("same path different content different identity", () => {
    const op1 = makeFileReadOp("src/a.ts", "v1", "tree1");
    const op2 = makeFileReadOp("src/a.ts", "v2", "tree1");
    expect(op1.identityKey).not.toBe(op2.identityKey);
  });
});

describe("Repeated detection", () => {
  it("counts repeated unchanged file reads within run", () => {
    const trace: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [
        makeFileReadOp("a.ts", "same", "tree1", 0),
        makeFileReadOp("a.ts", "same", "tree1", 1),
        makeFileReadOp("b.ts", "other", "tree1", 2),
      ],
    };
    const profile = deriveProfile(trace);
    expect(profile.fileReads).toBe(3);
    expect(profile.repeatedUnchangedReads).toBe(1);
    expect(profile.repeatedOps).toBe(1);
  });
  it("counts duplicate identical shell commands", () => {
    const trace: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [
        makeShellOp("git status", "tree1", 0),
        makeShellOp("git status", "tree1", 1),
        makeShellOp("git log", "tree1", 2),
      ],
    };
    const profile = deriveProfile(trace);
    expect(profile.duplicateShellCommands).toBe(1);
  });
  it("cross-run same file read detected", () => {
    const trace1: RunTrace = {
      metadata: makeMetadata({
        runId: "r1",
        repoBefore: {
          head: "h1",
          tree: "tree1",
          branch: "main",
          dirty: false,
          statusPorcelain: "",
          untrackedCount: 0,
          modifiedCount: 0,
        },
      }),
      rawEvents: [],
      operations: [makeFileReadOp("a.ts", "content", "tree1", 0)],
    };
    const trace2: RunTrace = {
      metadata: makeMetadata({
        runId: "r2",
        repoBefore: {
          head: "h1",
          tree: "tree1",
          branch: "main",
          dirty: false,
          statusPorcelain: "",
          untrackedCount: 0,
          modifiedCount: 0,
        },
      }),
      rawEvents: [],
      operations: [makeFileReadOp("a.ts", "content", "tree1", 0)],
    };
    const analysis = analyzeCrossRun([trace1, trace2]);
    expect(analysis.crossRunRepeatPct).toBe(50);
    expect(analysis.topRepeatedFiles.length).toBe(1);
  });
  it("cross-run same command against equivalent state", () => {
    const t = "tree1";
    const trace1: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [makeShellOp("git status", t)],
    };
    const trace2: RunTrace = {
      metadata: makeMetadata({ runId: "r2" }),
      rawEvents: [],
      operations: [makeShellOp("git status", t)],
    };
    const analysis = analyzeCrossRun([trace1, trace2]);
    expect(analysis.repeatedOpsAcrossRuns).toBe(1);
    expect(analysis.topRepeatedCommands.some((c) => c.key === "git status")).toBe(true);
  });
  it("cross-run same search against equivalent tree", () => {
    const trace1: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [makeSearchOp("foo", "src", "tree1")],
    };
    const trace2: RunTrace = {
      metadata: makeMetadata({ runId: "r2" }),
      rawEvents: [],
      operations: [makeSearchOp("foo", "src", "tree1")],
    };
    const analysis = analyzeCrossRun([trace1, trace2]);
    expect(analysis.repeatedOpsAcrossRuns).toBe(1);
    expect(analysis.topRepeatedSearches.length).toBe(1);
  });
  it("different tree does not count as repeat", () => {
    const trace1: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [makeSearchOp("foo", "src", "tree1")],
    };
    const trace2: RunTrace = {
      metadata: makeMetadata({ runId: "r2" }),
      rawEvents: [],
      operations: [makeSearchOp("foo", "src", "tree2")],
    };
    const analysis = analyzeCrossRun([trace1, trace2]);
    expect(analysis.repeatedOpsAcrossRuns).toBe(0);
  });
});

describe("Deterministic reuse candidates", () => {
  it("file_read with hash is candidate", () => {
    const op = makeFileReadOp("a.ts", "content", "tree1");
    expect(isDeterministicReusable(op)).toBe(true);
  });
  it("shell is not candidate", () => {
    const op = makeShellOp("npm run dev", "tree1");
    expect(isDeterministicReusable(op)).toBe(false);
  });
  it("git with tree is candidate", () => {
    const op = makeShellOp("git status", "tree1");
    expect(isDeterministicReusable(op)).toBe(true);
  });
  it("cross-run counts only deterministic", () => {
    const t1: RunTrace = {
      metadata: makeMetadata({ runId: "r1" }),
      rawEvents: [],
      operations: [makeFileReadOp("a.ts", "c", "tree1"), makeShellOp("npm run dev", "tree1")],
    };
    const t2: RunTrace = {
      metadata: makeMetadata({ runId: "r2" }),
      rawEvents: [],
      operations: [makeFileReadOp("a.ts", "c", "tree1"), makeShellOp("npm run dev", "tree1")],
    };
    const analysis = analyzeCrossRun([t1, t2]);
    // only file_read should be candidate (shell excluded)
    expect(analysis.deterministicReuseCandidates).toBe(1);
  });
});

describe("Storage and regeneration", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rapture-profiler-"));
  });

  it("persists and loads run trace", async () => {
    const runId = generateRunId();
    const trace: RunTrace = {
      metadata: makeMetadata({ runId, repositoryRoot: tmp }),
      rawEvents: [makeRaw(0, "tool", { tool: "read" })],
      operations: [makeFileReadOp("a.ts", "hello", "tree1")],
    };
    await storeRunTrace(tmp, trace);
    const loaded = await loadRunTrace(tmp, runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.runId).toBe(runId);
    expect(loaded!.operations.length).toBe(1);
    expect(loaded!.rawEvents.length).toBe(1);
  });

  it("load missing returns null and list empty", async () => {
    expect(await loadRunTrace(tmp, "nonexistent")).toBeNull();
    expect(await listRuns(tmp)).toEqual([]);
  });

  it("corrupted run does not corrupt others", async () => {
    const r1 = generateRunId();
    const r2 = generateRunId();
    await storeRunTrace(tmp, {
      metadata: makeMetadata({ runId: r1, repositoryRoot: tmp }),
      rawEvents: [],
      operations: [],
    });
    await storeRunTrace(tmp, {
      metadata: makeMetadata({ runId: r2, repositoryRoot: tmp }),
      rawEvents: [],
      operations: [],
    });
    // corrupt r1
    await writeFile(join(tmp, ".rapture", "runs", r1, "metadata.json"), "not json");
    const runs = await listRuns(tmp);
    // only r2 should be listed (r1 corrupted ignored)
    expect(runs.some((r) => r.runId === r2)).toBe(true);
    expect(runs.some((r) => r.runId === r1)).toBe(false);
    expect(await loadRunTrace(tmp, r2)).not.toBeNull();
    expect(await loadRunTrace(tmp, r1)).toBeNull();
  });

  it("analysis regenerable from raw traces", async () => {
    const r1 = generateRunId();
    const r2 = generateRunId();
    const t1: RunTrace = {
      metadata: makeMetadata({ runId: r1, repositoryRoot: tmp }),
      rawEvents: [makeRaw(0, "a", {})],
      operations: [makeFileReadOp("a.ts", "same", "tree1")],
    };
    const t2: RunTrace = {
      metadata: makeMetadata({ runId: r2, repositoryRoot: tmp }),
      rawEvents: [makeRaw(0, "b", {})],
      operations: [makeFileReadOp("a.ts", "same", "tree1")],
    };
    await storeRunTrace(tmp, t1);
    await storeRunTrace(tmp, t2);
    const loaded1 = await loadRunTrace(tmp, r1);
    const loaded2 = await loadRunTrace(tmp, r2);
    const a1 = analyzeCrossRun([t1, t2]);
    const a2 = analyzeCrossRun([loaded1!, loaded2!]);
    expect(a2.crossRunRepeatPct).toBe(a1.crossRunRepeatPct);
    expect(a2.deterministicReusePct).toBe(a1.deterministicReusePct);
  });

  it("trace schema validation - version", async () => {
    const runId = generateRunId();
    const trace: RunTrace = {
      metadata: makeMetadata({ runId, repositoryRoot: tmp }),
      rawEvents: [],
      operations: [],
    };
    await storeRunTrace(tmp, trace);
    const raw = await readFile(join(tmp, ".rapture", "runs", runId, "metadata.json"), "utf8");
    const meta = JSON.parse(raw) as RunMetadata;
    expect(meta.traceVersion).toBe(TRACE_VERSION);
    const opsRaw = await readFile(join(tmp, ".rapture", "runs", runId, "operations.jsonl"), "utf8");
    expect(opsRaw).toBe(""); // no ops -> empty file
  });
});

describe("Manifest validation", () => {
  it("valid manifest passes", () => {
    const m = {
      version: 1,
      agent: "opencode",
      mode: "clean-reset",
      repository: "/tmp",
      tasks: [{ id: "t1", task: "do thing" }],
    };
    expect(validateManifest(m).ok).toBe(true);
  });
  it("invalid version fails", () => {
    expect(
      validateManifest({
        version: 2,
        agent: "opencode",
        mode: "clean-reset",
        repository: "/tmp",
        tasks: [{ id: "t1", task: "x" }],
      }).ok,
    ).toBe(false);
  });
  it("empty tasks fails", () => {
    expect(
      validateManifest({
        version: 1,
        agent: "opencode",
        mode: "clean-reset",
        repository: "/tmp",
        tasks: [],
      }).ok,
    ).toBe(false);
  });
  it("expands repetitions", () => {
    const m = {
      version: 1 as const,
      agent: "opencode" as const,
      mode: "clean-reset" as const,
      repository: "/tmp",
      tasks: [{ id: "t1", task: "hello", repetitions: 3 }],
    };
    expect(expandManifest(m).length).toBe(3);
    expect(expandManifest(m)[0]!.repetition).toBe(1);
    expect(expandManifest(m)[2]!.repetition).toBe(3);
  });
  it("loadManifest from file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "manifest-"));
    const path = join(tmp, "manifest.json");
    const m = {
      version: 1,
      agent: "opencode",
      mode: "evolving",
      repository: "/tmp",
      tasks: [{ id: "t1", task: "hi" }],
    };
    await writeFile(path, JSON.stringify(m));
    const loaded = await loadManifest(path);
    expect(loaded.mode).toBe("evolving");
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("Repository state identity", () => {
  it("git state differs when files change", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "repo-state-"));
    await execa("git", ["init"], { cwd: tmp });
    await execa("git", ["config", "user.email", "t@t.com"], { cwd: tmp });
    await execa("git", ["config", "user.name", "t"], { cwd: tmp });
    await writeFile(join(tmp, "a.txt"), "hello");
    await execa("git", ["add", "."], { cwd: tmp });
    await execa("git", ["commit", "-m", "init"], { cwd: tmp });
    const head1 = (await execa("git", ["rev-parse", "HEAD"], { cwd: tmp })).stdout.trim();
    await writeFile(join(tmp, "a.txt"), "world");
    await execa("git", ["add", "."], { cwd: tmp });
    await execa("git", ["commit", "-m", "update"], { cwd: tmp });
    const head2 = (await execa("git", ["rev-parse", "HEAD"], { cwd: tmp })).stdout.trim();
    expect(head1).not.toBe(head2);
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("Incomplete run handling", () => {
  it("store and mark incomplete", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "incomplete-"));
    const runId = generateRunId();
    const trace: RunTrace = {
      metadata: {
        ...makeMetadata({ runId, repositoryRoot: tmp }),
        status: "completed",
        exitCode: 0,
      },
      rawEvents: [],
      operations: [],
    };
    await storeRunTrace(tmp, trace);
    // simulate crash by writing incomplete status directly
    const metaPath = join(tmp, ".rapture", "runs", runId, "metadata.json");
    const raw = JSON.parse(await readFile(metaPath, "utf8")) as RunMetadata;
    const updated = { ...raw, status: "incomplete" as const, incompleteReason: "killed" };
    await writeFile(metaPath, JSON.stringify(updated, null, 2));
    const loaded = await loadRunTrace(tmp, runId);
    expect(loaded!.metadata.status).toBe("incomplete");
    await rm(tmp, { recursive: true, force: true });
  });
});
