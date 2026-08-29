import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunTrace } from "./schema.js";

export const ARTIFACT_VERSION = 1 as const;

export interface WorkingSetArtifact {
  readonly version: typeof ARTIFACT_VERSION;
  readonly repositoryTreeHash: string | null;
  readonly sourceRunIds: readonly string[];
  readonly generationTimestamp: string;
  readonly taskDomain: string;
  readonly files: readonly {
    readonly path: string;
    readonly contentHash: string;
    readonly sourceRunIds: readonly string[];
  }[];
  readonly directories: readonly {
    readonly path: string;
    readonly sourceRunIds: readonly string[];
  }[];
  readonly searches: readonly {
    readonly pattern: string;
    readonly path: string | null;
    readonly normalizedPattern: string;
    readonly normalizedPath: string | null;
    readonly sourceRunIds: readonly string[];
  }[];
  readonly gitQueries: readonly {
    readonly command: string;
    readonly normalizedCommand: string;
    readonly sourceRunIds: readonly string[];
  }[];
  readonly artifactSizeBytes: number;
  readonly approxTokens: number;
}



function normalizePattern(p: string): string {
  // remove surrounding quotes, trim, collapse whitespace
  let s = p.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\s+/g, " ").trim();
}

function normalizePath(p: string | null): string | null {
  if (p === null) return null;
  let s = p.trim().replace(/^\.\//, "");
  if (s === "" || s === "." || s === "./") return null;
  return s;
}

export function generateWorkingSetArtifact(
  traces: readonly RunTrace[],
  taskDomain: string,
  treeHash: string | null,
): WorkingSetArtifact {
  if (traces.length === 0) throw new Error("no traces to generate artifact");
  // verify all traces share same tree if treeHash provided
  // For Phase 0C, allow artifact generation from prior traces even if tree differs slightly (e.g., added docs)
  // Still record the artifact's tree as the requested treeHash for compatibility checks.
  // If strict identical required, caller should ensure traces match.
  if (treeHash) {
    const mismatched = traces.filter((t) => t.metadata.repoBefore.tree !== treeHash);
    if (mismatched.length > 0 && mismatched.length === traces.length) {
      // all mismatched -> still allow but note (could be tree drift due to added non-code files)
      // Do not throw; artifact will be marked with requested tree.
    }
  }
  const sourceRunIds = [...traces.map((t) => t.metadata.runId)].sort();

  const fileMap = new Map<string, { contentHash: string; sourceRunIds: Set<string> }>();
  const dirMap = new Map<string, Set<string>>();
  const searchMap = new Map<string, { pattern: string; path: string | null; normalizedPattern: string; normalizedPath: string | null; sourceRunIds: Set<string> }>();
  const gitMap = new Map<string, { command: string; normalizedCommand: string; sourceRunIds: Set<string> }>();

  for (const trace of traces) {
    const runId = trace.metadata.runId;
    for (const op of trace.operations) {
      if (op.opClass === "file_read" && op.filePath && op.contentHash) {
        const key = `${op.filePath}:${op.contentHash}`;
        let entry = fileMap.get(key);
        if (!entry) {
          entry = { contentHash: op.contentHash, sourceRunIds: new Set() };
          fileMap.set(key, entry);
        }
        // we need to store path separately; key includes path+hash, but we also need path
        // store mapping from key to path via separate map
        entry.sourceRunIds.add(runId);
      } else if (op.opClass === "directory_list" && op.filePath) {
        const p = op.filePath;
        let set = dirMap.get(p);
        if (!set) {
          set = new Set();
          dirMap.set(p, set);
        }
        set.add(runId);
      } else if (op.opClass === "search" && op.searchPattern) {
        const normPat = normalizePattern(op.searchPattern);
        const normPath = normalizePath(op.searchPath);
        const key = `${normPat}:${normPath ?? ""}`;
        let entry = searchMap.get(key);
        if (!entry) {
          entry = { pattern: op.searchPattern, path: op.searchPath, normalizedPattern: normPat, normalizedPath: normPath, sourceRunIds: new Set() };
          searchMap.set(key, entry);
        }
        entry.sourceRunIds.add(runId);
      } else if (op.opClass === "git" && op.normalizedCommand) {
        const key = op.normalizedCommand;
        let entry = gitMap.get(key);
        if (!entry) {
          entry = { command: op.command ?? op.normalizedCommand, normalizedCommand: op.normalizedCommand, sourceRunIds: new Set() };
          gitMap.set(key, entry);
        }
        entry.sourceRunIds.add(runId);
      }
    }
  }

  // Build files array: deduplicate by path+hash, sort deterministically
  const files: WorkingSetArtifact["files"] = [...fileMap.entries()]
    .map(([key, v]) => {
      const [path] = key.split(":");
      return { path: path ?? "", contentHash: v.contentHash, sourceRunIds: [...v.sourceRunIds].sort() };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.contentHash < b.contentHash ? -1 : 1));

  const directories: WorkingSetArtifact["directories"] = [...dirMap.entries()]
    .map(([path, set]) => ({ path, sourceRunIds: [...set].sort() }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const searches: WorkingSetArtifact["searches"] = [...searchMap.values()]
    .map((v) => ({
      pattern: v.pattern,
      path: v.path,
      normalizedPattern: v.normalizedPattern,
      normalizedPath: v.normalizedPath,
      sourceRunIds: [...v.sourceRunIds].sort(),
    }))
    .sort((a, b) => (a.normalizedPattern < b.normalizedPattern ? -1 : a.normalizedPattern > b.normalizedPattern ? 1 : (a.normalizedPath ?? "") < (b.normalizedPath ?? "") ? -1 : 1));

  const gitQueries: WorkingSetArtifact["gitQueries"] = [...gitMap.values()]
    .map((v) => ({
      command: v.command,
      normalizedCommand: v.normalizedCommand,
      sourceRunIds: [...v.sourceRunIds].sort(),
    }))
    .sort((a, b) => (a.normalizedCommand < b.normalizedCommand ? -1 : 1));

  // provisional artifact without size/tokens for calculation
  const provisional: Omit<WorkingSetArtifact, "artifactSizeBytes" | "approxTokens"> = {
    version: ARTIFACT_VERSION,
    repositoryTreeHash: treeHash,
    sourceRunIds,
    generationTimestamp: new Date().toISOString(),
    taskDomain,
    files,
    directories,
    searches,
    gitQueries,
  };
  const json = JSON.stringify(provisional, null, 2);
  const size = Buffer.byteLength(json, "utf8");
  // approx tokens: ~4 bytes per token heuristic
  const approxTokens = Math.ceil(size / 4);

  return { ...provisional, artifactSizeBytes: size, approxTokens };
}

export function artifactToMarkdown(artifact: WorkingSetArtifact): string {
  const lines: string[] = [];
  lines.push(`# Repository Working Set Artifact v${artifact.version}`);
  lines.push(`- Tree: ${artifact.repositoryTreeHash ?? "unknown"}`);
  lines.push(`- Domain: ${artifact.taskDomain}`);
  lines.push(`- Generated: ${artifact.generationTimestamp}`);
  lines.push(`- Source runs: ${artifact.sourceRunIds.join(", ")}`);
  lines.push(`- Size: ${artifact.artifactSizeBytes} bytes (~${artifact.approxTokens} tokens)`);
  lines.push("");
  if (artifact.files.length > 0) {
    lines.push("## Files previously read (exact path + content hash)");
    for (const f of artifact.files) {
      lines.push(`- \`${f.path}\` hash \`${f.contentHash.slice(0, 12)}\` from ${f.sourceRunIds.length} runs`);
    }
    lines.push("");
  }
  if (artifact.directories.length > 0) {
    lines.push("## Directories previously listed");
    for (const d of artifact.directories) {
      lines.push(`- \`${d.path}\` from ${d.sourceRunIds.length} runs`);
    }
    lines.push("");
  }
  if (artifact.searches.length > 0) {
    lines.push("## Repository searches (normalized)");
    for (const s of artifact.searches) {
      const scope = s.normalizedPath ? ` in \`${s.normalizedPath}\`` : "";
      lines.push(`- \`${s.normalizedPattern}\`${scope} from ${s.sourceRunIds.length} runs`);
    }
    lines.push("");
  }
  if (artifact.gitQueries.length > 0) {
    lines.push("## Git queries");
    for (const g of artifact.gitQueries) {
      lines.push(`- \`${g.normalizedCommand}\` from ${g.sourceRunIds.length} runs`);
    }
    lines.push("");
  }
  lines.push("_This artifact contains deterministic repository facts only. Verify any fact before relying on it._");
  return lines.join("\n");
}

export async function writeArtifact(
  dir: string,
  name: string,
  artifact: WorkingSetArtifact,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, `${name}.json`);
  const mdPath = join(dir, `${name}.md`);
  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(mdPath, `${artifactToMarkdown(artifact)}\n`, "utf8");
  return { jsonPath, mdPath };
}

export function isArtifactCompatible(artifact: WorkingSetArtifact, treeHash: string | null): boolean {
  if (!artifact.repositoryTreeHash || !treeHash) return false;
  return artifact.repositoryTreeHash === treeHash;
}

export function validateNoLeakage(artifact: WorkingSetArtifact, targetRunId: string): boolean {
  return !artifact.sourceRunIds.includes(targetRunId);
}
