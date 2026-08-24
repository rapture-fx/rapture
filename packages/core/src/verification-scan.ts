import type { IntegritySignal } from "@rapture/kernel";
import { runGit } from "./git.js";
import { runVerificationIntegrity, type VerificationIntegrityReport } from "./integrity-report.js";
import { blastRadiusLabel, type SignalSeverity, signalSeverity } from "./severity.js";

export interface CommitFinding {
  readonly commit: string;
  readonly subject: string;
  readonly verdict: VerificationIntegrityReport["verdict"];
  readonly filesChanged: number;
  readonly signals: readonly (IntegritySignal & { readonly severity: SignalSeverity })[];
}

export interface VerificationScan {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly generatedAt: string;
  readonly commitsScanned: number;
  readonly findings: readonly CommitFinding[];
  readonly totalSignals: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly cleanCommits: number;
  readonly overallVerdict: "ACCEPT" | "WARN" | "REJECT";
}

async function commitsInRange(
  repository: string,
  baseRef: string,
  headRef: string,
): Promise<readonly { sha: string; subject: string }[]> {
  const result = await runGit(repository, [
    "log",
    "--format=%H%x1f%s",
    `${baseRef}..${headRef}`,
    "--reverse",
  ]);
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const separator = line.indexOf("\x1f");
      return {
        sha: line.slice(0, separator),
        subject: line.slice(separator + 1),
      };
    });
}

export async function runVerificationScan(input: {
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
}): Promise<VerificationScan> {
  const commits = await commitsInRange(input.repository, input.baseRef, input.headRef);
  const findings: CommitFinding[] = [];
  let cursor = input.baseRef;
  for (const commit of commits) {
    const report = await runVerificationIntegrity({
      repository: input.repository,
      baseRef: cursor,
      candidateRef: commit.sha,
    });
    findings.push({
      commit: commit.sha,
      subject: commit.subject,
      verdict: report.verdict,
      filesChanged: report.filesChanged,
      signals: report.signals.map((signal) => ({ ...signal, severity: signalSeverity(signal) })),
    });
    cursor = commit.sha;
  }
  const allSignals = findings.flatMap((finding) => finding.signals);
  const counts = { critical: 0, high: 0, medium: 0 };
  for (const signal of allSignals) counts[signal.severity] += 1;
  const overallVerdict: VerificationScan["overallVerdict"] =
    counts.critical > 0 || findings.some((finding) => finding.verdict === "REJECT")
      ? "REJECT"
      : counts.high > 0 || counts.medium > 0
        ? "WARN"
        : findings.length === 0
          ? "ACCEPT"
          : "ACCEPT";
  return {
    schemaVersion: 1,
    repository: input.repository,
    baseRef: input.baseRef,
    headRef: input.headRef,
    generatedAt: new Date().toISOString(),
    commitsScanned: commits.length,
    findings,
    totalSignals: allSignals.length,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    cleanCommits: findings.filter((finding) => finding.signals.length === 0).length,
    overallVerdict,
  };
}

export function formatScanMarkdown(scan: VerificationScan): string {
  const lines: string[] = [];
  lines.push("# Agent Verification Integrity Audit");
  lines.push("");
  lines.push(`**Repository:** \`${scan.repository}\`  `);
  lines.push(
    `**Window:** \`${scan.baseRef}\` → \`${scan.headRef}\` (${scan.commitsScanned} commits)`,
  );
  lines.push(`**Generated:** ${scan.generatedAt}`);
  lines.push("");
  lines.push("## Findings summary");
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|------:|`);
  lines.push(`| CRITICAL | ${scan.criticalCount} |`);
  lines.push(`| HIGH | ${scan.highCount} |`);
  lines.push(`| MEDIUM | ${scan.mediumCount} |`);
  lines.push(`| Clean commits | ${scan.cleanCommits}/${scan.commitsScanned} |`);
  lines.push("");
  if (scan.totalSignals === 0) {
    lines.push("No verification-weakening signals found in this window.");
    lines.push("");
    lines.push("**VERDICT: ACCEPT** — the merge gate's evidence surface held across the window.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("## Detailed findings");
  lines.push("");
  for (const finding of scan.findings) {
    if (finding.signals.length === 0) continue;
    lines.push(`### \`${finding.commit.slice(0, 10)}\` — ${finding.subject}`);
    lines.push("");
    for (const signal of finding.signals) {
      lines.push(`- **[${signal.severity.toUpperCase()}]** \`${signal.path}\` — ${signal.detail}`);
      lines.push(`  - ${blastRadiusLabel(signal.severity)}`);
    }
    lines.push("");
  }
  lines.push("## What this means");
  lines.push("");
  lines.push(
    "Each finding marks a place where an autonomous change altered the evidence your merge system relies on. Until addressed, checks touching these surfaces can pass without meaning what they appear to mean.",
  );
  lines.push("");
  lines.push(`**OVERALL VERDICT: ${scan.overallVerdict}**`);
  return `${lines.join("\n")}\n`;
}
