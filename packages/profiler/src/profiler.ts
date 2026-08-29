import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execa } from "execa";
import { getAgentVersion, getRepoState } from "./git.js";
import { normalizeRawEvents } from "./normalize.js";
import { redactString } from "./redact.js";
import type { RawEvent, RunMetadata, RunTrace, TokenUsage } from "./schema.js";
import { TRACE_VERSION } from "./schema.js";
import { generateRunId, storeRunTrace } from "./storage.js";

export interface ProfileOptions {
  readonly repoRoot: string;
  readonly task: string | null;
  readonly taskFile: string | null;
  readonly persistTaskText: boolean;
  readonly extraOpenCodeArgs: readonly string[];
  readonly model: string | null;
  readonly agent: string | null;
  readonly runsDir?: string;
  readonly timeoutMs?: number;
  readonly cohort?: string | null;
  readonly taskId?: string | null;
  readonly experimentId?: string | null;
}

export async function profileOpenCode(opts: ProfileOptions): Promise<RunTrace> {
  const runId = generateRunId();
  const startTime = new Date().toISOString();
  const startMs = Date.now();
  const repoRoot = resolve(opts.repoRoot);

  const repoBefore = await getRepoState(repoRoot);
  const agentVersion = await getAgentVersion();

  let taskText: string | null = null;
  let taskHash: string | null = null;
  if (opts.task !== null) {
    taskText = opts.persistTaskText ? redactString(opts.task) : null;
    taskHash = createHash("sha256").update(opts.task, "utf8").digest("hex");
  } else if (opts.taskFile) {
    try {
      const raw = await readFile(resolve(opts.taskFile), "utf8");
      taskText = opts.persistTaskText ? redactString(raw) : null;
      taskHash = createHash("sha256").update(raw, "utf8").digest("hex");
    } catch {
      taskHash = null;
    }
  }

  // Build opencode command
  // We will run: opencode run --format json [extra args] [task as message]
  // If task given, pass as positional message. If taskFile, read file and pass content.
  const opencodeArgs: string[] = ["run", "--format", "json"];
  if (opts.model) opencodeArgs.push("--model", opts.model);
  if (opts.agent) opencodeArgs.push("--agent", opts.agent);
  // extra args are passed through (e.g., --agent build)
  for (const a of opts.extraOpenCodeArgs) opencodeArgs.push(a);
  // message: task text or empty
  let message = "";
  if (opts.task) message = opts.task;
  else if (opts.taskFile) {
    try {
      message = await readFile(resolve(opts.taskFile), "utf8");
    } catch {
      message = "";
    }
  }
  if (message) opencodeArgs.push(message);

  const rawEvents: RawEvent[] = [];
  let seq = 0;
  let opencodeSessionId: string | null = null;
  let exitCode: number | null = null;
  let stderr = "";
  let stdoutBuf = "";

  // We use spawn to capture JSON lines incrementally
  const child = spawn("opencode", opencodeArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rawLineBuffer: string[] = [];

  function handleChunk(chunk: string): void {
    stdoutBuf += chunk;
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        // capture sessionID if present
        if (typeof obj["sessionID"] === "string" && !opencodeSessionId)
          opencodeSessionId = obj["sessionID"] as string;
        if (typeof obj["sessionId"] === "string" && !opencodeSessionId)
          opencodeSessionId = obj["sessionId"] as string;
        // opencode run json events may be wrapped: {type: "part", part:{...}} vs {type:"tool"}
        rawEvents.push({
          seq: seq++,
          timestamp: new Date().toISOString(),
          type: (obj["type"] as string | undefined) ?? "unknown",
          data: obj,
        });
        rawLineBuffer.push(trimmed);
      } catch {
        // not json line, keep as raw
        rawEvents.push({
          seq: seq++,
          timestamp: new Date().toISOString(),
          type: "stdout",
          data: { line: trimmed },
        });
      }
    }
  }

  const stdoutPromise = new Promise<void>((resolveP) => {
    child.stdout?.on("data", (d: Buffer) => handleChunk(d.toString("utf8")));
    child.stdout?.on("end", resolveP);
    child.stdout?.on("close", resolveP);
  });
  const stderrPromise = new Promise<void>((resolveP) => {
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.stderr?.on("end", resolveP);
    child.stderr?.on("close", resolveP);
  });

  const exitPromise = new Promise<number | null>((resolveP) => {
    child.on("close", (code) => resolveP(code));
    child.on("error", () => resolveP(null));
  });

  // timeout handling
  let timeoutId: NodeJS.Timeout | null = null;
  if (opts.timeoutMs) {
    timeoutId = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
    }, opts.timeoutMs);
  }

  const [code] = await Promise.all([exitPromise, stdoutPromise, stderrPromise]);
  if (timeoutId) clearTimeout(timeoutId);
  exitCode = code;

  // flush remaining stdoutBuf
  if (stdoutBuf.trim().length > 0) {
    const trimmed = stdoutBuf.trim();
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj["sessionID"] === "string" && !opencodeSessionId)
        opencodeSessionId = obj["sessionID"] as string;
      rawEvents.push({
        seq: seq++,
        timestamp: new Date().toISOString(),
        type: (obj["type"] as string | undefined) ?? "unknown",
        data: obj,
      });
    } catch {
      rawEvents.push({
        seq: seq++,
        timestamp: new Date().toISOString(),
        type: "stdout",
        data: { line: trimmed },
      });
    }
  }

  // capture any stderr lines as raw events
  if (stderr.trim()) {
    for (const line of stderr.split("\n").filter((l) => l.trim())) {
      rawEvents.push({
        seq: seq++,
        timestamp: new Date().toISOString(),
        type: "stderr",
        data: { line: redactString(line) },
      });
    }
  }

  // Try to enrich rawEvents from opencode sqlite if sessionId known: fetch parts
  if (opencodeSessionId) {
    const dbEvents = await fetchSessionParts(opencodeSessionId);
    for (const dbEv of dbEvents) {
      rawEvents.push({
        seq: seq++,
        timestamp: new Date().toISOString(),
        type: dbEv.type,
        data: dbEv.data,
      });
    }
  }

  const endTime = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const repoAfter = await getRepoState(repoRoot);

  // Determine token usage from raw events or sqlite
  let tokenUsage: TokenUsage | null = null;
  if (opencodeSessionId) {
    tokenUsage = await fetchTokenUsage(opencodeSessionId);
  }
  // fallback: parse from rawEvents for step-finish tokens
  if (!tokenUsage) {
    for (const ev of rawEvents) {
      const d = ev.data as Record<string, unknown> | null;
      if (d && typeof d["tokens"] === "object" && d["tokens"] !== null) {
        const t = d["tokens"] as Record<string, unknown>;
        tokenUsage = {
          input: typeof t["input"] === "number" ? (t["input"] as number) : null,
          output: typeof t["output"] === "number" ? (t["output"] as number) : null,
          reasoning: typeof t["reasoning"] === "number" ? (t["reasoning"] as number) : null,
          cacheRead:
            typeof (t["cache"] as Record<string, unknown> | undefined)?.["read"] === "number"
              ? ((t["cache"] as Record<string, unknown>)["read"] as number)
              : null,
          cacheWrite:
            typeof (t["cache"] as Record<string, unknown> | undefined)?.["write"] === "number"
              ? ((t["cache"] as Record<string, unknown>)["write"] as number)
              : null,
          cost: typeof d["cost"] === "number" ? (d["cost"] as number) : null,
        };
        break;
      }
    }
  }

  // extract model/provider from raw events or session
  let model: string | null = opts.model;
  let provider: string | null = null;
  if (model && model.includes("/")) {
    provider = model.split("/")[0] ?? null;
  }
  if (!model && opencodeSessionId) {
    const info = await fetchSessionInfo(opencodeSessionId);
    if (info) {
      model = info.model;
      provider = info.provider;
    }
  }
  // if model has slash but provider already set, keep it; otherwise try to derive provider from model
  if (!provider && model && model.includes("/")) {
    provider = model.split("/")[0] ?? null;
  }

  // Normalize
  const operations = normalizeRawEvents(rawEvents, { repoTree: repoBefore.tree, repoRoot });

  const status: RunMetadata["status"] =
    exitCode === 0 ? "completed" : exitCode === null ? "incomplete" : "failed";

  const metadata: RunMetadata = {
    runId,
    traceVersion: TRACE_VERSION,
    agent: "opencode",
    agentVersion,
    model,
    provider,
    task: taskText,
    taskHash,
    taskFile: opts.taskFile,
    repositoryRoot: repoRoot,
    startTime,
    endTime,
    durationMs,
    exitCode,
    status,
    repoBefore,
    repoAfter,
    opencodeSessionId,
    tokenUsage,
    incompleteReason: status === "incomplete" ? "process did not exit cleanly" : null,
    cohort: opts.cohort ?? null,
    taskId: opts.taskId ?? null,
    experimentId: opts.experimentId ?? null,
  };

  const trace: RunTrace = { metadata, rawEvents, operations };
  await storeRunTrace(repoRoot, trace, opts.runsDir);
  return trace;
}

async function fetchSessionParts(
  sessionId: string,
): Promise<readonly { type: string; data: unknown }[]> {
  const dbPath = `${process.env["HOME"] ?? ""}/.local/share/opencode/opencode.db`;
  try {
    const { execa } = await import("execa");
    const res = await execa(
      "sqlite3",
      [
        dbPath,
        `SELECT data FROM part WHERE session_id='${sessionId.replace(/'/g, "''")}' ORDER BY time_created ASC;`,
      ],
      { reject: false },
    );
    if (res.exitCode !== 0) return [];
    const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);
    const out: { type: string; data: unknown }[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        out.push({ type: (obj["type"] as string | undefined) ?? "part", data: obj });
      } catch {
        /* ignore */
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchTokenUsage(sessionId: string): Promise<TokenUsage | null> {
  const dbPath = `${process.env["HOME"] ?? ""}/.local/share/opencode/opencode.db`;
  try {
    const res = await execa(
      "sqlite3",
      [
        dbPath,
        `SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost FROM session WHERE id='${sessionId.replace(/'/g, "''")}';`,
      ],
      { reject: false },
    );
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    const line = res.stdout.trim().split("\n")[0] ?? "";
    if (!line) return null;
    const parts = line.split("|");
    if (parts.length < 6) return null;
    return {
      input: parts[0] ? Number(parts[0]) : null,
      output: parts[1] ? Number(parts[1]) : null,
      reasoning: parts[2] ? Number(parts[2]) : null,
      cacheRead: parts[3] ? Number(parts[3]) : null,
      cacheWrite: parts[4] ? Number(parts[4]) : null,
      cost: parts[5] ? Number(parts[5]) : null,
    };
  } catch {
    return null;
  }
}

async function fetchSessionInfo(
  sessionId: string,
): Promise<{ model: string | null; provider: string | null } | null> {
  const dbPath = `${process.env["HOME"] ?? ""}/.local/share/opencode/opencode.db`;
  try {
    const res = await execa(
      "sqlite3",
      [dbPath, `SELECT model FROM session WHERE id='${sessionId.replace(/'/g, "''")}';`],
      { reject: false },
    );
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    const raw = res.stdout.trim().split("\n")[0] ?? "";
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const id = typeof obj["id"] === "string" ? (obj["id"] as string) : null;
      const provider = typeof obj["providerID"] === "string" ? (obj["providerID"] as string) : null;
      return { model: id, provider };
    } catch {
      return { model: raw || null, provider: null };
    }
  } catch {
    return null;
  }
}
