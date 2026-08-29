import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunMetadata, RunTrace } from "./schema.js";
import { TRACE_VERSION } from "./schema.js";

export const DEFAULT_RUNS_DIR = ".rapture/runs";

export function runsRoot(repoRoot: string, customDir?: string): string {
  const dir = customDir ?? DEFAULT_RUNS_DIR;
  if (dir.startsWith("/")) return dir;
  return resolve(repoRoot, dir);
}

export function runDir(runsRootPath: string, runId: string): string {
  return join(runsRootPath, runId);
}

export function generateRunId(): string {
  // Use randomUUID for global uniqueness
  return randomUUID();
}

export async function storeRunTrace(
  repoRoot: string,
  trace: RunTrace,
  customDir?: string,
): Promise<string> {
  const root = runsRoot(repoRoot, customDir);
  const dir = runDir(root, trace.metadata.runId);
  await mkdir(dir, { recursive: true });
  // metadata.json
  await writeFile(join(dir, "metadata.json"), `${JSON.stringify(trace.metadata, null, 2)}\n`, {
    flag: "wx",
  });
  // raw.jsonl -> each line is RawEvent
  const rawLines =
    trace.rawEvents.map((e) => JSON.stringify(e)).join("\n") + (trace.rawEvents.length ? "\n" : "");
  await writeFile(join(dir, "raw.jsonl"), rawLines, { flag: "wx" });
  // operations.jsonl
  const opLines =
    trace.operations.map((o) => JSON.stringify(o)).join("\n") +
    (trace.operations.length ? "\n" : "");
  await writeFile(join(dir, "operations.jsonl"), opLines, { flag: "wx" });
  // trace.json (combined, versioned)
  const combined = {
    version: TRACE_VERSION,
    metadata: trace.metadata,
    operations: trace.operations,
  };
  await writeFile(join(dir, "trace.json"), `${JSON.stringify(combined, null, 2)}\n`, {
    flag: "wx",
  });
  return dir;
}

export async function loadRunTrace(
  repoRoot: string,
  runId: string,
  customDir?: string,
): Promise<RunTrace | null> {
  const root = runsRoot(repoRoot, customDir);
  const dir = runDir(root, runId);
  try {
    const metaRaw = await readFile(join(dir, "metadata.json"), "utf8");
    const metadata = JSON.parse(metaRaw) as RunMetadata;
    const rawRaw = await readFile(join(dir, "raw.jsonl"), "utf8").catch(() => "");
    const rawEvents = rawRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    const opsRaw = await readFile(join(dir, "operations.jsonl"), "utf8").catch(() => "");
    const operations = opsRaw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    return { metadata, rawEvents, operations };
  } catch {
    return null;
  }
}

export async function listRuns(
  repoRoot: string,
  customDir?: string,
): Promise<readonly RunMetadata[]> {
  const root = runsRoot(repoRoot, customDir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const metas: RunMetadata[] = [];
  for (const entry of entries) {
    const metaPath = join(root, entry, "metadata.json");
    try {
      const st = await stat(metaPath);
      if (!st.isFile()) continue;
      const raw = await readFile(metaPath, "utf8");
      metas.push(JSON.parse(raw) as RunMetadata);
    } catch {}
  }
  metas.sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
  return metas;
}

export async function markIncomplete(
  repoRoot: string,
  runId: string,
  reason: string,
  customDir?: string,
): Promise<void> {
  const root = runsRoot(repoRoot, customDir);
  const dir = runDir(root, runId);
  const metaPath = join(dir, "metadata.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as RunMetadata;
    const updated: RunMetadata = {
      ...meta,
      status: "incomplete",
      incompleteReason: reason,
      endTime: new Date().toISOString(),
    };
    await writeFile(metaPath, `${JSON.stringify(updated, null, 2)}\n`);
  } catch {
    // if metadata not exists, create minimal
    await mkdir(dir, { recursive: true });
    const minimal: RunMetadata = {
      runId,
      traceVersion: TRACE_VERSION,
      agent: "opencode",
      agentVersion: null,
      model: null,
      provider: null,
      task: null,
      taskHash: null,
      taskFile: null,
      repositoryRoot: repoRoot,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: null,
      exitCode: null,
      status: "incomplete",
      repoBefore: {
        head: null,
        tree: null,
        branch: null,
        dirty: false,
        statusPorcelain: "",
        untrackedCount: 0,
        modifiedCount: 0,
      },
      repoAfter: null,
      opencodeSessionId: null,
      tokenUsage: null,
      incompleteReason: reason,
      cohort: null,
      taskId: null,
      experimentId: null,
    };
    await writeFile(metaPath, `${JSON.stringify(minimal, null, 2)}\n`, { flag: "wx" }).catch(
      () => {},
    );
  }
}
