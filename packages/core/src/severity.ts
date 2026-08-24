import type { IntegritySignal, IntegritySignalKind } from "@rapture/kernel";

export type SignalSeverity = "critical" | "high" | "medium";

const BASE_SEVERITY: Record<IntegritySignalKind, SignalSeverity> = {
  test_file_deleted: "critical",
  ci_workflow_deleted: "critical",
  exit_code_handling_weakened: "critical",
  assertions_removed: "high",
  test_skipped: "high",
  error_handling_suppressed: "high",
  verification_config_modified: "high",
  static_analysis_suppressed: "high",
  ci_workflow_modified: "high",
  protected_file_modified: "medium",
};

const HIGH_STAKES_PATHS: readonly RegExp[] = [
  /(?:^|\/)(?:auth|security|payment|billing|permissions?)(?:\/|$|[-_.])/i,
  /(?:^|\/)(?:middleware|session|token|credential|secret)/i,
  /(?:^|\/)migrations?\//i,
];

export function signalSeverity(signal: IntegritySignal): SignalSeverity {
  let severity = BASE_SEVERITY[signal.kind];
  if (severity !== "critical") {
    const path = signal.path.toLowerCase();
    if (HIGH_STAKES_PATHS.some((pattern) => pattern.test(path))) {
      severity = severity === "medium" ? "high" : "critical";
    }
  }
  return severity;
}

export function blastRadiusLabel(severity: SignalSeverity): string {
  return severity === "critical"
    ? "merge gate now trusts self-authored evidence on a sensitive surface"
    : severity === "high"
      ? "verification power reduced; failures can pass silently"
      : "protected-surface drift; review intent";
}
