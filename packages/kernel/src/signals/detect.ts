export type FileChangeStatus = "added" | "modified" | "deleted";

export interface FileChange {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly before?: string | null;
  readonly after?: string | null;
}

export const integritySignalKinds = [
  "test_file_deleted",
  "test_skipped",
  "assertions_removed",
  "verification_config_modified",
  "ci_workflow_modified",
  "ci_workflow_deleted",
  "exit_code_handling_weakened",
  "protected_file_modified",
] as const;

export type IntegritySignalKind = (typeof integritySignalKinds)[number];

export interface IntegritySignal {
  readonly kind: IntegritySignalKind;
  readonly path: string;
  readonly detail: string;
}

export interface SignalDetectorOptions {
  readonly protectedPaths?: readonly string[];
  readonly testFilePatterns?: readonly RegExp[];
}

const DEFAULT_TEST_FILE_PATTERNS: readonly RegExp[] = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
  /(?:^|\/)__tests__\/[^/]+\.[cm]?[jt]sx?$/i,
  /(?:^|\/)(?:tests?|spec)(?:\/|$)/i,
  /(?:^|\/)test_[^/]+\.py$/,
  /_test\.(?:go|[cm]?js)$/i,
];

const VERIFICATION_CONFIG_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)jest\.config\.[cm]?[jt]s$/i,
  /(?:^|\/)vitest\.config\.[cm]?[jt]s$/i,
  /(?:^|\/)vitest\.workspace\.[cm]?[jt]s$/i,
  /(?:^|\/)\.nycrc(?:\.json)?$/i,
  /(?:^|\/)\.codecov\.ya?ml$/i,
  /(?:^|\/)codecov\.ya?ml$/i,
  /(?:^|\/)karma\.conf\.[cm]?[jt]s$/i,
  /(?:^|\/)playwright\.config\.[cm]?[jt]s$/i,
];

const CI_WORKFLOW_PATTERNS: readonly RegExp[] = [
  /^\.github\/workflows\/.+/,
  /(?:^|\/)\.gitlab-ci\.yml$/i,
  /(?:^|\/)azure-pipelines\.yml$/i,
  /(?:^|\/)\.circleci\/config\.yml$/i,
  /(?:^|\/)Jenkinsfile$/i,
];

const SKIP_MARKERS: readonly RegExp[] = [
  /\b(?:it|test|describe|suite)\.skip\s*\(/g,
  /\bx(?:it|test|describe)\s*\(/g,
  /\b(?:it|test)\.todo\s*\(/g,
  /\bthis\.skip\s*\(/g,
  /@pytest\.mark\.skip\b/g,
  /\bskip(?:if)?\s*\(\s*(?:true|condition)/gi,
];

const ASSERTION_TOKENS: readonly RegExp[] = [
  /\bexpect\s*\(/g,
  /\bassert\s*\(/g,
  /\bassert\.\w+/g,
  /\bt\.(?:ok|equal|deepEqual|strictEqual|notEqual|throws|doesNotThrow|match|rejects|resolves)\s*\(/g,
  /\brequire\(\s*['"](?:node:)?assert['"]\s*\)/g,
];

const EXIT_IGNORE_MARKERS: readonly RegExp[] = [
  /\|\|\s*true\b/g,
  /\|\|\s*:(?:\s|$)/g,
  /\bset\s*\+e\b/gi,
  /continue-on-error['"]?\s*[:=]\s*true/gi,
];

function countMatches(content: string, patterns: readonly RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    total += (content.match(global) ?? []).length;
  }
  return total;
}

function isTestFile(path: string, options: SignalDetectorOptions): boolean {
  const patterns = options.testFilePatterns ?? DEFAULT_TEST_FILE_PATTERNS;
  return patterns.some((pattern) => pattern.test(path));
}

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function normalizePath(path: string): string {
  return path.split("\\").join("/").replace(/^\.\//u, "");
}

export function detectIntegritySignals(
  changes: readonly FileChange[],
  options: SignalDetectorOptions = {},
): readonly IntegritySignal[] {
  const signals: IntegritySignal[] = [];
  const protectedPaths = new Set((options.protectedPaths ?? []).map(normalizePath));

  for (const change of changes) {
    const path = normalizePath(change.path);
    const before = change.before ?? "";
    const after = change.after ?? "";

    if (protectedPaths.has(path) && change.status === "modified") {
      signals.push({
        kind: "protected_file_modified",
        path,
        detail: "protected verification file modified",
      });
    }

    if (change.status === "deleted" && (isTestFile(path, options) || protectedPaths.has(path))) {
      signals.push({ kind: "test_file_deleted", path, detail: "test file deleted" });
      continue;
    }

    if (matchesAny(path, CI_WORKFLOW_PATTERNS)) {
      signals.push({
        kind: change.status === "deleted" ? "ci_workflow_deleted" : "ci_workflow_modified",
        path,
        detail: `CI workflow definition ${change.status}`,
      });
    }

    if (change.status !== "deleted" && matchesAny(path, VERIFICATION_CONFIG_PATTERNS)) {
      signals.push({
        kind: "verification_config_modified",
        path,
        detail: "verification/coverage configuration touched",
      });
    }

    if (change.status === "modified" || change.status === "added") {
      const skipDelta = countMatches(after, SKIP_MARKERS) - countMatches(before, SKIP_MARKERS);
      if (skipDelta > 0) {
        signals.push({
          kind: "test_skipped",
          path,
          detail: `${skipDelta} skip marker(s) added`,
        });
      }

      const assertionDelta =
        countMatches(after, ASSERTION_TOKENS) - countMatches(before, ASSERTION_TOKENS);
      if (isTestFile(path, options) && assertionDelta < 0) {
        signals.push({
          kind: "assertions_removed",
          path,
          detail: `assertion count changed by ${assertionDelta}`,
        });
      }

      const exitIgnoreDelta =
        countMatches(after, EXIT_IGNORE_MARKERS) - countMatches(before, EXIT_IGNORE_MARKERS);
      if (exitIgnoreDelta > 0) {
        signals.push({
          kind: "exit_code_handling_weakened",
          path,
          detail: `${exitIgnoreDelta} exit-code suppression marker(s) added`,
        });
      }
    }
  }

  return signals;
}

export function hasWeakeningSignals(signals: readonly IntegritySignal[]): boolean {
  return signals.length > 0;
}
