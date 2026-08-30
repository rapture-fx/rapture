export const DETECTOR_VERSION = "vsd-0.1.0";

export type Confidence = "high" | "medium" | "contextual";

export interface VerificationSignal {
  readonly kind: string;
  readonly confidence: Confidence;
  readonly file: string;
  readonly before: string | number | null;
  readonly after: string | number | null;
  readonly evidence: string;
  readonly ruleId: string;
}

export interface VerificationSurfaceDelta {
  readonly repo: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly signals: readonly VerificationSignal[];
  readonly highConfidenceCount: number;
  readonly mediumConfidenceCount: number;
  readonly materialWeakeningDetected: boolean;
  readonly detectorVersion: string;
}

/** One changed file, with the base/head content needed to reproduce every signal. */
export interface ChangedFile {
  readonly filename: string;
  readonly previousFilename: string | null;
  readonly status: "added" | "modified" | "removed" | "renamed" | "changed" | "copied";
  readonly baseContent: string | null;
  readonly headContent: string | null;
}

export interface PullRequestInput {
  readonly repo: string;
  readonly prNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  /** Every changed path in the PR, used for co-deletion checks. */
  readonly allChangedPaths: readonly { path: string; status: string }[];
  readonly files: readonly ChangedFile[];
}
