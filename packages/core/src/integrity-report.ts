import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FileChange,
  IntegritySignal,
  IntegritySignalKind,
  InvariantsConfig,
} from "@rapture/kernel";
import {
  changesWithInvariantContext,
  detectIntegritySignals,
  emptyInvariants,
  filterIgnoredSignals,
  invariantsToDetectorOptions,
  isLikelyTestFile,
  parseInvariantsFile,
} from "@rapture/kernel";
import { runGit } from "./git.js";

export interface VerificationIntegrityReport {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly baseRef: string;
  readonly baseSha: string | null;
  readonly candidateRef: string;
  readonly candidateSha: string | null;
  readonly generatedAt: string;
  readonly filesChanged: number;
  readonly signals: readonly IntegritySignal[];
  readonly signalCounts: Readonly<Record<string, number>>;
  readonly productionChangeWithoutTestEvidence: boolean;
  readonly verdict: "ACCEPT" | "WARN" | "REJECT";
  readonly invariants: {
    readonly source: "explicit" | "auto" | "none";
    readonly path: string | null;
    readonly protectedPaths: readonly string[];
    readonly ignorePaths: readonly string[];
  };
}

const HARD_FAILURE_KINDS: readonly IntegritySignalKind[] = [
  "test_file_deleted",
  "test_skipped",
  "assertions_removed",
  "verification_config_modified",
  "ci_workflow_modified",
  "ci_workflow_deleted",
  "exit_code_handling_weakened",
  "static_analysis_suppressed",
  "error_handling_suppressed",
  "protected_file_modified",
];

interface DiffEntry {
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly path: string;
  readonly oldPath?: string;
}

async function diffEntries(
  repository: string,
  baseRef: string,
  candidateRef: string,
): Promise<readonly DiffEntry[]> {
  const result = await runGit(repository, [
    "diff",
    "--name-status",
    "-z",
    `${baseRef}..${candidateRef}`,
  ]);
  const tokens = result.stdout.split("\0");
  const entries: DiffEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.trim().length === 0) continue;
    const rawStatus = token.slice(0, 1).toUpperCase();
    const oldPath = tokens[index + 1];
    if (oldPath === undefined || oldPath.length === 0) continue;
    if (rawStatus === "R") {
      const newPath = tokens[index + 2];
      index += 2;
      entries.push({ status: "renamed", path: newPath ?? oldPath, oldPath });
      continue;
    }
    index += 1;
    entries.push({
      status:
        rawStatus === "A"
          ? "added"
          : rawStatus === "D"
            ? "deleted"
            : rawStatus === "C"
              ? "added"
              : ("modified" as const),
      path: oldPath,
    });
  }
  return entries;
}

async function showOrNull(repository: string, ref: string, path: string): Promise<string | null> {
  const result = await runGit(repository, ["show", `${ref}:${path}`], {
    allowFailure: true,
  });
  return result.exitCode === 0 ? result.stdout : null;
}

export async function collectChangesBetween(
  repository: string,
  baseRef: string,
  candidateRef: string,
): Promise<readonly FileChange[]> {
  const entries = await diffEntries(repository, baseRef, candidateRef);
  const changes: FileChange[] = [];
  for (const entry of entries) {
    const before =
      entry.status === "added"
        ? null
        : await showOrNull(repository, baseRef, entry.oldPath ?? entry.path);
    const after =
      entry.status === "deleted" ? null : await showOrNull(repository, candidateRef, entry.path);
    const status =
      entry.status === "deleted"
        ? ("deleted" as const)
        : before === null
          ? ("added" as const)
          : ("modified" as const);
    changes.push({
      path: entry.status === "renamed" ? (entry.path as string) : entry.path,
      status,
      before,
      after,
    });
  }
  return changes;
}

function countByKind(signals: readonly IntegritySignal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const signal of signals) {
    counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
  }
  return counts;
}

function isNonProductionPath(path: string): boolean {
  return (
    (/\.(?:md|txt|rst|json)$/i.test(path.split("/").pop() ?? "") &&
      !/tsconfig|coverage|codecov/i.test(path)) ||
    /^(?:docs?|changelog|examples?)(?:$|\/)/i.test(path) ||
    /^license(?:\..*)?$/i.test(path.split("/").pop() ?? "")
  );
}

export async function loadInvariantsFromRepo(repository: string): Promise<InvariantsConfig | null> {
  const path = join(repository, ".rapture", "invariants.json");
  try {
    await readFile(path, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return parseInvariantsFile(path);
}

export async function runVerificationIntegrity(input: {
  readonly repository: string;
  readonly baseRef: string;
  readonly candidateRef: string;
  readonly invariants?: InvariantsConfig;
  readonly invariantsSource?: "explicit" | "auto" | "none";
  readonly invariantsPath?: string | null;
}): Promise<VerificationIntegrityReport> {
  const invariants = input.invariants ?? emptyInvariants();
  const detectorOptions = invariantsToDetectorOptions(invariants);
  const rawChanges = await collectChangesBetween(
    input.repository,
    input.baseRef,
    input.candidateRef,
  );
  const changes = changesWithInvariantContext(rawChanges, invariants);
  let signals = detectIntegritySignals(changes, detectorOptions);
  signals = filterIgnoredSignals(signals, invariants);
  const hasHardFailure = signals.some((signal) => HARD_FAILURE_KINDS.includes(signal.kind));
  const touchedTests = changes.some((change) => isLikelyTestFile(change.path, detectorOptions));
  const touchedProduction = changes.some(
    (change) =>
      !isLikelyTestFile(change.path, detectorOptions) && !isNonProductionPath(change.path),
  );
  const productionChangeWithoutTestEvidence = touchedProduction && !touchedTests;
  const verdict = hasHardFailure
    ? "REJECT"
    : productionChangeWithoutTestEvidence
      ? "WARN"
      : "ACCEPT";
  const baseSha = await resolveCommit(input.repository, input.baseRef).catch(() => null);
  const candidateSha = await resolveCommit(input.repository, input.candidateRef).catch(() => null);
  return {
    schemaVersion: 1,
    repository: input.repository,
    baseRef: input.baseRef,
    baseSha,
    candidateRef: input.candidateRef,
    candidateSha,
    generatedAt: new Date().toISOString(),
    filesChanged: changes.length,
    signals,
    signalCounts: countByKind(signals),
    productionChangeWithoutTestEvidence,
    verdict,
    invariants: {
      source: input.invariantsSource ?? (invariants === null ? "none" : "auto"),
      path: input.invariantsPath ?? null,
      protectedPaths: [...(invariants.protectedPaths ?? [])],
      ignorePaths: [...(invariants.ignorePaths ?? [])],
    },
  };
}

import { resolveCommit } from "./git.js";
import { signalSeverity } from "./severity.js";

export function formatVerificationIntegrity(report: VerificationIntegrityReport): string {
  const lines: string[] = [];
  lines.push("VERIFICATION INTEGRITY");
  const baseLabel =
    report.baseSha === null ? report.baseRef : `${report.baseRef} (${report.baseSha.slice(0, 7)})`;
  const candidateLabel =
    report.candidateSha === null
      ? report.candidateRef
      : `${report.candidateRef} (${report.candidateSha.slice(0, 7)})`;
  lines.push(
    `repo: ${report.repository} · base: ${baseLabel} · candidate: ${candidateLabel} · files changed: ${report.filesChanged}`,
  );
  lines.push("");
  if (report.signals.length === 0 && !report.productionChangeWithoutTestEvidence) {
    lines.push(
      "PASS  verification surface intact — CI success and verification weakening are distinct",
    );
  }
  for (const signal of report.signals) {
    const severity = signalSeverity(signal);
    lines.push(
      `FAIL  [${severity.toUpperCase()}] ${signal.kind}: ${signal.path} — ${signal.detail}`,
    );
  }
  if (report.productionChangeWithoutTestEvidence && report.verdict !== "REJECT") {
    lines.push(
      "WARN  production change lacks independent execution evidence (no test files touched)",
    );
  }
  lines.push("");
  lines.push(`VERDICT: ${report.verdict}`);
  if (report.verdict === "REJECT") {
    lines.push("This change weakened the evidence used to accept itself. CI may still be green.");
  } else if (report.verdict === "WARN") {
    lines.push("Verification surface intact, but production changed without test evidence.");
  }
  return `${lines.join("\n")}\n`;
}
