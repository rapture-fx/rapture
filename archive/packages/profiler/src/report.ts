import { deriveProfile } from "./analysis.js";
import type { CrossRunAnalysis, RunTrace } from "./schema.js";

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function pad(label: string, width = 28): string {
  return label.padEnd(width);
}

export function formatSingleReport(trace: RunTrace): string {
  const profile = deriveProfile(trace);
  const m = trace.metadata;
  const lines: string[] = [];
  lines.push("RAPTURE AGENT COMPUTE PROFILE");
  lines.push("");
  lines.push(`${pad("Run")} ${m.runId}`);
  lines.push(`${pad("Agent")} ${m.agent}${m.agentVersion ? ` ${m.agentVersion}` : ""}`);
  lines.push(`${pad("Model")} ${m.model ?? "<unknown>"}`);
  lines.push(`${pad("Repository")} ${m.repositoryRoot}`);
  lines.push(
    `${pad("HEAD")} ${m.repoBefore.head ?? "<unknown>"}${m.repoAfter?.head && m.repoAfter.head !== m.repoBefore.head ? ` -> ${m.repoAfter.head}` : ""}`,
  );
  lines.push(`${pad("Duration")} ${durationStr(m.durationMs)}`);
  lines.push(`${pad("Status")} ${m.status}${m.exitCode !== null ? ` (exit ${m.exitCode})` : ""}`);
  lines.push("");
  lines.push(`${pad("Observed operations")} ${profile.totalOps}`);
  lines.push(`${pad("Unique operations")} ${profile.uniqueOps}`);
  lines.push(`${pad("Repeated operations")} ${profile.repeatedOps}`);
  lines.push(`${pad("Observable redundancy")} ${fmtPct(profile.repeatPct)}`);
  lines.push("");
  lines.push(`${pad("File reads")} ${profile.fileReads}`);
  lines.push(`${pad("Unique content reads")} ${profile.uniqueFileReads}`);
  lines.push(`${pad("Repeated unchanged reads")} ${profile.repeatedUnchangedReads}`);
  if (profile.bytesRead !== null) lines.push(`${pad("Bytes read")} ${profile.bytesRead}`);
  lines.push("");
  lines.push(`${pad("Searches")} ${profile.searches}`);
  lines.push(`${pad("Exact/equivalent repeats")} ${profile.repeatedSearches}`);
  lines.push("");
  lines.push(`${pad("Build/test commands")} ${profile.testOps + profile.buildOps}`);
  lines.push(`${pad("Repeated commands")} ${profile.repeatedTests + profile.repeatedBuilds}`);
  lines.push(`${pad("Shell commands")} ${profile.shellCommands}`);
  lines.push(`${pad("Duplicate shell commands")} ${profile.duplicateShellCommands}`);
  lines.push("");
  lines.push("Token usage");
  if (m.tokenUsage) {
    lines.push(`${pad("  Input")} ${m.tokenUsage.input ?? "<unknown>"}`);
    lines.push(`${pad("  Output")} ${m.tokenUsage.output ?? "<unknown>"}`);
    lines.push(`${pad("  Cache read")} ${m.tokenUsage.cacheRead ?? "<unknown>"}`);
    lines.push(`${pad("  Cost")} ${m.tokenUsage.cost ?? "<unknown>"}`);
  } else {
    lines.push(`${pad("  Input")} <unavailable>`);
    lines.push(`${pad("  Output")} <unavailable>`);
  }
  lines.push("");
  // potential deterministic reuse for single run = repeated deterministic ops within run
  const deterministic = countDeterministicRepeated(trace);
  lines.push("Potential deterministic reuse");
  lines.push(`${pad("  Operations")} ${deterministic}`);
  lines.push(
    `${pad("  Share of observed work")} ${profile.totalOps ? fmtPct((deterministic / profile.totalOps) * 100) : "0.0%"}`,
  );
  lines.push("");
  lines.push("This report measures repeated work.");
  lines.push("It does not claim that all repeated work is safe to reuse.");
  if (profile.unknownOps > 0)
    lines.push(
      `Unmeasurable/unknown operations: ${profile.unknownOps} (${fmtPct((profile.unknownOps / profile.totalOps) * 100)})`,
    );
  lines.push("");
  return lines.join("\n");
}

function countDeterministicRepeated(trace: RunTrace): number {
  // count repeated ops within run that are deterministic reusable
  const map = new Map<string, { count: number; op: (typeof trace.operations)[number] }>();
  for (const op of trace.operations) {
    const e = map.get(op.identityKey);
    if (!e) map.set(op.identityKey, { count: 1, op });
    else e.count++;
  }
  let reuse = 0;
  for (const { count, op } of map.values()) {
    if (count > 1 && isDeterministic(op)) reuse += count - 1;
  }
  return reuse;
}

function isDeterministic(op: {
  opClass: string;
  contentHash: string | null;
  repoTree: string | null;
  searchPattern: string | null;
  normalizedCommand: string | null;
}): boolean {
  if (op.opClass === "file_read" && op.contentHash) return true;
  if (op.opClass === "directory_list" && op.repoTree) return true;
  if (op.opClass === "search" && op.searchPattern && op.repoTree) return true;
  if (op.opClass === "git" && op.repoTree && op.normalizedCommand) return true;
  return false;
}

function durationStr(ms: number | null): string {
  if (ms === null) return "<unknown>";
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatCrossRunReport(analysis: CrossRunAnalysis): string {
  const lines: string[] = [];
  lines.push("RAPTURE CROSS-RUN ANALYSIS");
  lines.push("");
  lines.push(`${pad("Runs")} ${analysis.runIds.join(", ")}`);
  lines.push(`${pad("Total observable ops")} ${analysis.totalOps}`);
  lines.push(`${pad("Unique ops")} ${analysis.uniqueOpsAcrossRuns}`);
  lines.push(`${pad("Repeated ops")} ${analysis.repeatedOpsAcrossRuns}`);
  lines.push(`${pad("Observable redundancy")} ${fmtPct(analysis.crossRunRepeatPct)}`);
  lines.push("");
  lines.push(`${pad("Deterministic reuse candidates")} ${analysis.deterministicReuseCandidates}`);
  lines.push(`${pad("Share of observed work")} ${fmtPct(analysis.deterministicReusePct)}`);
  lines.push("");
  lines.push("Breakdown by operation class");
  for (const [cls, vals] of Object.entries(analysis.byClass)) {
    if (vals.total > 0)
      lines.push(
        `${pad(`  ${cls}`)} total=${vals.total} repeated=${vals.repeated} (${vals.total ? fmtPct((vals.repeated / vals.total) * 100) : "0.0%"})`,
      );
  }
  lines.push("");
  lines.push("Top repeated files");
  if (analysis.topRepeatedFiles.length === 0) lines.push("  (none)");
  else
    for (const f of analysis.topRepeatedFiles)
      lines.push(`  ${f.count}x ${f.paths[0]} [key=${f.key.slice(0, 32)}...]`);
  lines.push("");
  lines.push("Top repeated commands");
  if (analysis.topRepeatedCommands.length === 0) lines.push("  (none)");
  else for (const c of analysis.topRepeatedCommands) lines.push(`  ${c.count}x ${c.key}`);
  lines.push("");
  lines.push("Top repeated searches");
  if (analysis.topRepeatedSearches.length === 0) lines.push("  (none)");
  else for (const s of analysis.topRepeatedSearches) lines.push(`  ${s.count}x ${s.key}`);
  lines.push("");
  lines.push("Top repeated tests/builds");
  if (analysis.topRepeatedTestsBuilds.length === 0) lines.push("  (none)");
  else for (const t of analysis.topRepeatedTestsBuilds) lines.push(`  ${t.count}x ${t.key}`);
  lines.push("");
  lines.push("Token / cost overlap");
  lines.push(`${pad("  Total input")} ${analysis.tokenOverlap.totalInput ?? "<unavailable>"}`);
  lines.push(`${pad("  Total output")} ${analysis.tokenOverlap.totalOutput ?? "<unavailable>"}`);
  lines.push(
    `${pad("  Total cache read")} ${analysis.tokenOverlap.totalCacheRead ?? "<unavailable>"}`,
  );
  lines.push(
    `${pad("  Repeated estimate")} ${analysis.tokenOverlap.repeatedEstimate ?? "<unavailable - no per-op attribution>"}`,
  );
  lines.push(`${pad("  Confidence")} ${analysis.tokenOverlap.confidence}`);
  lines.push("");
  lines.push(`${pad("Unmeasurable portion")} ${fmtPct(analysis.unmeasurablePortion)}`);
  lines.push("");
  lines.push("This report quantifies observed redundancy only.");
  lines.push("Repeated does not equal safely reusable.");
  lines.push("");
  return lines.join("\n");
}

export function formatSignalAssessment(analysis: CrossRunAnalysis): string {
  const red = analysis.crossRunRepeatPct;
  const det = analysis.deterministicReusePct;
  let signal: string;
  if (red >= 30 && det >= 15) signal = "PHASE_0_STRONG_SIGNAL";
  else if (red >= 15 || det >= 15) {
    // spec: weak is 15-30 redundancy or <15 deterministic share but ambiguous. Use spec thresholds directly
    if (red >= 15 && red < 30) signal = "PHASE_0_WEAK_SIGNAL";
    else if (red >= 30 && det < 15) signal = "PHASE_0_WEAK_SIGNAL";
    else if (red < 15 && det >= 5) signal = "PHASE_0_WEAK_SIGNAL";
    else signal = "PHASE_0_KILL_SIGNAL";
  } else signal = "PHASE_0_KILL_SIGNAL";
  // If instrumentation clearly missing major class, mark BLOCKED? For now return kill/weak/strong
  return signal;
}
