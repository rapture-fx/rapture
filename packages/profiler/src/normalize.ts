import { sha256Hex } from "./hash.js";
import { redactString } from "./redact.js";
import type { NormalizedOperation, OperationClass, RawEvent } from "./schema.js";

export interface MechanicalSearch {
  readonly pattern: string;
  readonly path: string | null;
  readonly normalizedPattern: string;
  readonly normalizedPath: string | null;
}

function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i] ?? "";
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

export function tryParseBashSearch(command: string): MechanicalSearch | null {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return null;
  const first = tokens[0] ?? "";
  const isRg = first === "rg" || first.endsWith("/rg");
  const isGrep = first === "grep" || first.endsWith("/grep");
  if (!isRg && !isGrep) return null;
  // skip flags
  let idx = 1;
  // flags that take an argument: -g, --glob, -t, --type, etc. For conservative correctness, known flag-arg pairs:
  const flagWithArg = new Set(["-g", "--glob", "-t", "--type", "--type-add", "-A", "-B", "-C", "--after-context", "--before-context", "-m", "--max-count"]);
  while (idx < tokens.length) {
    const tok = tokens[idx] ?? "";
    if (tok.startsWith("-")) {
      if (flagWithArg.has(tok) && idx + 1 < tokens.length) {
        idx += 2;
      } else if (tok.startsWith("--") && tok.includes("=")) {
        // --glob=foo style
        idx += 1;
      } else {
        // check if token is flag with attached value like -gpattern? skip simple
        idx += 1;
      }
      continue;
    }
    break;
  }
  if (idx >= tokens.length) return null;
  const rawPattern = tokens[idx] ?? "";
  idx++;
  // next token if exists and not flag is path
  let rawPath: string | null = null;
  if (idx < tokens.length) {
    const maybePath = tokens[idx] ?? "";
    if (!maybePath.startsWith("-")) rawPath = maybePath;
    // if remaining tokens, treat first as path (repo search usually single path)
  }
  const normalizedPattern = rawPattern.replace(/\s+/g, " ").trim();
  const normalizedPath = rawPath ? rawPath.replace(/^\.\//, "").trim() || null : null;
  // handle repo root scope: "." or "./" => null (repo root)
  const finalPath = normalizedPath === "." || normalizedPath === "./" ? null : normalizedPath;
  return {
    pattern: rawPattern,
    path: rawPath,
    normalizedPattern,
    normalizedPath: finalPath,
  };
}

export function tryParseBashListing(command: string): string | null {
  const trimmed = command.trim();
  // simple ls cases: "ls", "ls -1", "ls -la", "ls path", "ls -1 path"
  // handle flags with digits like -1, -la, -R
  const lsMatch = trimmed.match(/^\s*ls(\s+-[\w]+\s*)*\s*(\S+)?\s*$/);
  if (lsMatch) {
    const path = lsMatch[2] ?? null;
    if (path) {
      const norm = normalizeFilePath(path);
      return norm === "" ? "." : norm;
    }
    return "."; // repo root listing
  }
  return null;
}

function classifyCommand(command: string): OperationClass {
  const cmd = command.trim();
  if (/^\s*git(\s|$)/.test(cmd)) return "git";
  if (/\b(pnpm|npm|yarn|bun)\s+(install|i)(\b|\s)/.test(cmd)) return "install";
  // mechanical search detection: bash rg/grep
  if (tryParseBashSearch(cmd)) return "search";
  // listing equivalence: simple ls -> directory_list where provably equivalent
  if (tryParseBashListing(cmd) !== null) return "directory_list";
  // test detection must be before build because some test runs include build
  if (
    /\b(vitest|jest|mocha|playwright|cypress|ava|tap)\b/.test(cmd) ||
    /\b(pnpm|npm|yarn|bun)\s+(test|jest|vitest)/.test(cmd)
  )
    return "test";
  if (
    /\b(tsc|vite\s+build|next\s+build|webpack|esbuild|rollup|pnpm\s+build|npm\s+run\s+build)\b/.test(
      cmd,
    )
  )
    return "build";
  // generic shell
  return "shell";
}

function normalizeCommandValue(cmd: string): string {
  // redact secrets, collapse whitespace, trim
  const redacted = redactString(cmd);
  return redacted.replace(/\s+/g, " ").trim();
}

function normalizeFilePath(p: string): string {
  // keep as posix, remove leading ./, trim
  return p.replace(/^\.\//, "").trim();
}

function opIdentityKey(
  op: Omit<NormalizedOperation, "seq" | "timestamp" | "raw"> & { raw?: unknown },
): string {
  // deterministic key for cross-run comparison
  // includes class + path/hash or normalized command + repoTree
  if (op.opClass === "file_read" && op.filePath) {
    // content identity via hash if available else path only (less strict)
    if (op.contentHash) return `file_read:${op.filePath}:${op.contentHash}`;
    return `file_read:${op.filePath}:nohash`;
  }
  if (op.opClass === "file_write" && op.filePath) {
    if (op.contentHash) return `file_write:${op.filePath}:${op.contentHash}`;
    return `file_write:${op.filePath}`;
  }
  if (op.opClass === "directory_list" && op.filePath) {
    return `directory_list:${op.filePath}:${op.repoTree ?? "no-tree"}`;
  }
  if (op.opClass === "search" && op.searchPattern) {
    const pattern = op.searchPattern;
    const path = op.searchPath ?? "";
    const tree = op.repoTree ?? "no-tree";
    return `search:${pattern}:${path}:${tree}`;
  }
  if (
    (op.opClass === "git" ||
      op.opClass === "shell" ||
      op.opClass === "test" ||
      op.opClass === "build" ||
      op.opClass === "install") &&
    op.normalizedCommand
  ) {
    const tree = op.repoTree ?? "no-tree";
    // for deterministic commands we include tree for cross-run safe reuse
    return `${op.opClass}:${op.normalizedCommand}:${tree}`;
  }
  if (op.command) return `${op.opClass}:${op.normalizedCommand ?? op.command}`;
  // fallback: hash raw
  return `${op.opClass}:${op.displayName}:${sha256Hex(op.displayName)}`;
}

export interface NormalizeContext {
  readonly repoTree: string | null;
  readonly repoRoot: string;
}

export function normalizeRawEvents(
  rawEvents: readonly RawEvent[],
  ctx: NormalizeContext,
): readonly NormalizedOperation[] {
  const ops: NormalizedOperation[] = [];
  const seenCallIds = new Set<string>();
  for (const ev of rawEvents) {
    // deduplicate by callID if present (covers json stream + DB enrichment duplicates)
    const data = ev.data as Record<string, unknown> | null;
    let callId: string | null = null;
    if (data) {
      const direct = data["callID"] as string | undefined;
      const part = data["part"] as Record<string, unknown> | undefined;
      const partCall = part?.["callID"] as string | undefined;
      // also check nested state? not needed
      callId = direct ?? partCall ?? null;
      // also check inside state? opencode DB parts store callID at top level
      if (!callId && typeof data["id"] === "string") {
        // not callID, ignore
      }
    }
    if (callId && seenCallIds.has(callId)) continue;
    if (callId) seenCallIds.add(callId);
    const op = normalizeSingle(ev, ctx);
    if (op) ops.push(op);
  }
  return ops;
}

export function normalizeSingle(ev: RawEvent, ctx: NormalizeContext): NormalizedOperation | null {
  const data = ev.data as Record<string, unknown> | null;
  // we handle known opencode part types
  // Supported raw types: tool, bash-output, read-output etc.
  // Our profiler captures raw json lines from `opencode run --format json`
  // That format includes events like {type:"part", part:{type:"tool", ...}} or {type:"tool",...} depending on version
  // We normalize generic handling: extract tool name if present
  if (!data || typeof data !== "object") {
    return {
      seq: ev.seq,
      timestamp: ev.timestamp,
      opClass: "unknown",
      tool: null,
      rawType: ev.type,
      identityKey: `unknown:${ev.seq}:${sha256Hex(JSON.stringify(ev.data))}`,
      displayName: ev.type,
      filePath: null,
      contentHash: null,
      byteLength: null,
      command: null,
      normalizedCommand: null,
      workdir: null,
      exitCode: null,
      durationMs: null,
      searchPattern: null,
      searchPath: null,
      repoTree: ctx.repoTree,
      raw: ev.data,
    };
  }

  // Try to detect tool payload.
  // Opencode db parts: {type:"tool", tool:"read", state:{input,output,...}}
  // JSON stream: {type:"tool_use", part:{type:"tool", tool:"read", state:{...}}}
  // Also: {type:"tool_use", timestamp, sessionID, part:{...}}
  const toolDirect = (data["tool"] as string | undefined) ?? (data["name"] as string | undefined) ?? null;
  const part = data["part"] as Record<string, unknown> | undefined;
  const toolFromPart = part
    ? ((part["tool"] as string | undefined) ?? (part["name"] as string | undefined) ?? null)
    : null;
  const tool = toolDirect ?? toolFromPart ?? null;
  const typeField = (data["type"] as string | undefined) ?? (part?.["type"] as string | undefined) ?? ev.type;

  // Extract state/input
  const rawState = (data["state"] as Record<string, unknown> | undefined) ?? part?.["state"] as Record<string, unknown> | undefined ?? data;
  const state = (rawState as Record<string, unknown> | undefined) ?? data;
  // state may be inside part.state
  const effectiveState = (part?.["state"] as Record<string, unknown> | undefined) ?? state;
  const input =
    (effectiveState?.["input"] as Record<string, unknown> | undefined) ??
    (state?.["input"] as Record<string, unknown> | undefined) ??
    (data["input"] as Record<string, unknown> | undefined) ??
    (part?.["input"] as Record<string, unknown> | undefined) ??
    null;
  const output =
    (effectiveState?.["output"] as string | undefined) ??
    (state?.["output"] as string | undefined) ??
    (data["output"] as string | undefined) ??
    null;
  const status = (effectiveState?.["status"] as string | undefined) ?? (state?.["status"] as string | undefined) ?? null;

  if (tool) {
    return normalizeToolCall(ev, tool, typeField, input, output, effectiveState ?? state, status, ctx);
  }

  // Non-tool events (text, reasoning, step-finish)
  // These are not counted as operations for redundancy? But we keep as unknown/agent_tool if needed
  // For now, only tool events become operations; others are raw but not operations
  // However to keep observable operation count accurate, we ignore non-tool events here.
  // Return null to skip
  // But step-finish contains token metadata; caller handles that separately.
  return null;
}

function normalizeToolCall(
  ev: RawEvent,
  tool: string,
  rawType: string,
  input: Record<string, unknown> | null,
  output: string | null,
  state: Record<string, unknown> | null,
  _status: string | null,
  ctx: NormalizeContext,
): NormalizedOperation {
  const timestamp = ev.timestamp;
  const seq = ev.seq;
  const repoTree = ctx.repoTree;

  // common fields
  let opClass: OperationClass = "unknown";
  let filePath: string | null = null;
  let contentHash: string | null = null;
  let byteLength: number | null = null;
  let command: string | null = null;
  let normalizedCommand: string | null = null;
  let workdir: string | null = null;
  let exitCode: number | null = null;
  let durationMs: number | null = null;
  let searchPattern: string | null = null;
  let searchPath: string | null = null;
  let displayName = `${tool}`;

  if (tool === "read") {
    const p =
      (input?.["filePath"] as string | undefined) ??
      (input?.["path"] as string | undefined) ??
      null;
    if (p) {
      filePath = normalizeFilePath(p);
      // Heuristic: if p ends with slash or is directory, it's directory_list
      // Opencode read on directory returns entries list; we detect via output containing "<type>directory</type>"
      const isDir = output
        ? output.includes("<type>directory</type>") || output.includes('"type": "directory"')
        : false;
      // also check input has no extension and output looks like directory?
      if (isDir || p.endsWith("/")) {
        opClass = "directory_list";
        displayName = `read:${filePath}`;
      } else {
        opClass = "file_read";
        displayName = `read:${filePath}`;
        if (output) {
          byteLength = Buffer.byteLength(output, "utf8");
          // try to extract file content hash: if output contains file content, hash it
          // For rapture profiler we hash output as proxy for file content; redact first?
          contentHash = sha256Hex(output);
        }
        // also if metadata contains preview? ignore
      }
    } else {
      opClass = "unknown";
    }
  } else if (tool === "edit" || tool === "write") {
    const p = (input?.["filePath"] as string | undefined) ?? null;
    if (p) {
      filePath = normalizeFilePath(p);
      opClass = "file_write";
      displayName = `${tool}:${filePath}`;
      const newString =
        (input?.["newString"] as string | undefined) ??
        (input?.["content"] as string | undefined) ??
        output ??
        null;
      if (newString && typeof newString === "string") {
        contentHash = sha256Hex(newString);
        byteLength = Buffer.byteLength(newString, "utf8");
      }
    }
  } else if (tool === "bash") {
    const cmd =
      (input?.["command"] as string | undefined) ?? (input?.["cmd"] as string | undefined) ?? null;
    const wd =
      (input?.["workdir"] as string | undefined) ??
      (input?.["workDir"] as string | undefined) ??
      null;
    if (cmd) {
      command = cmd;
      normalizedCommand = normalizeCommandValue(cmd);
      workdir = wd ? normalizeFilePath(wd) : ctx.repoRoot;
      opClass = classifyCommand(cmd);
      // mechanical search extraction for bash
      const bashSearch = tryParseBashSearch(cmd);
      if (bashSearch) {
        opClass = "search";
        searchPattern = bashSearch.normalizedPattern;
        searchPath = bashSearch.normalizedPath;
        displayName = `search:${bashSearch.normalizedPattern}:${bashSearch.normalizedPath ?? ""}`;
      } else {
        const listingPath = tryParseBashListing(cmd);
        if (listingPath !== null) {
          opClass = "directory_list";
          filePath = listingPath;
          displayName = `directory_list:${listingPath}`;
        } else {
          displayName = `${opClass}:${normalizedCommand}`;
        }
      }
      // check for git op within bash? already classified
      if (output && typeof output === "string") byteLength = Buffer.byteLength(output, "utf8");
      // extract exit info if present in state
      const meta = (state?.["metadata"] as Record<string, unknown> | undefined) ?? null;
      if (meta && typeof meta["exitCode"] === "number") exitCode = meta["exitCode"] as number;
      const time = (state?.["time"] as Record<string, unknown> | undefined) ?? null;
      if (time && typeof time["start"] === "number" && typeof time["end"] === "number") {
        durationMs = (time["end"] as number) - (time["start"] as number);
      }
    } else {
      opClass = "shell";
    }
  } else if (tool === "grep") {
    opClass = "search";
    searchPattern =
      (input?.["pattern"] as string | undefined) ??
      (input?.["query"] as string | undefined) ??
      null;
    searchPath =
      (input?.["path"] as string | undefined) ?? (input?.["include"] as string | undefined) ?? null;
    if (searchPattern) {
      displayName = `grep:${searchPattern}:${searchPath ?? ""}`;
      // contentHash for deterministic search? use pattern+tree?
      // identityKey will handle
    }
    if (output) byteLength = Buffer.byteLength(output, "utf8");
  } else if (tool === "glob") {
    opClass = "directory_list";
    const pattern = (input?.["pattern"] as string | undefined) ?? null;
    filePath = pattern ? normalizeFilePath(pattern) : null;
    displayName = `glob:${pattern ?? ""}`;
    if (filePath) {
      // for identity we use pattern+tree
      searchPattern = pattern;
    }
  } else if (tool === "todowrite" || tool === "todo" || tool === "task") {
    opClass = "agent_tool";
    displayName = `${tool}`;
  } else {
    opClass = "unknown";
    displayName = tool;
  }

  const base: Omit<NormalizedOperation, "identityKey"> = {
    seq,
    timestamp,
    opClass,
    tool,
    rawType,
    displayName,
    filePath,
    contentHash,
    byteLength,
    command,
    normalizedCommand,
    workdir,
    exitCode,
    durationMs,
    searchPattern,
    searchPath,
    repoTree,
    raw: state ?? input ?? output ?? ev.data,
  };
  const identityKey = opIdentityKey(base as NormalizedOperation);
  return { ...base, identityKey };
}

export function isShellReadLike(op: NormalizedOperation): boolean {
  if (!op.command) return false;
  // shell commands that look like repository reads via cat/sed/head/tail/grep/rg/find
  // Do not relabel as file_read; report separately.
  return /\b(cat|sed|head|tail|grep|rg|find|ls)\b/.test(op.command);
}

export function isDeterministicReusable(op: NormalizedOperation): boolean {
  // strict rules per spec
  if (op.opClass === "file_read" && op.contentHash && op.filePath) return true;
  if (op.opClass === "directory_list" && op.repoTree) return true; // listing against identical tree
  if (op.opClass === "search" && op.searchPattern && op.repoTree) return true;
  if (op.opClass === "git" && op.repoTree && op.normalizedCommand) return true;
  // note: we do NOT classify shell/test/build/install as deterministic reusable without additional input identity
  // per spec, symbol extraction only if deterministic tooling; we don't have that
  return false;
}
