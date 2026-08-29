import { SCHEMA_VERSION } from "./version.js";

export type IntentSource = "linear" | "github" | "unknown";

export interface Intent {
  readonly id: string;
  readonly source: IntentSource;
  readonly externalId: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly url: string | null;
}

export interface PullRequest {
  readonly id: string;
  readonly provider: "github";
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly mergedAt: string | null;
  readonly mergeCommitSha: string | null;
  readonly url: string;
}

export interface Commit {
  readonly id: string;
  readonly sha: string;
  readonly repository: string;
  readonly message: string | null;
  readonly authoredAt: string | null;
}

export type CheckStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "unknown";
export interface Check {
  readonly id: string;
  readonly provider: "github_actions";
  readonly name: string;
  readonly status: CheckStatus;
  readonly commitSha: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly url: string | null;
}

export type ArtifactType = "deployment_artifact" | "build" | "release" | "unknown";
export interface Artifact {
  readonly id: string;
  readonly type: ArtifactType;
  readonly provider: string;
  readonly externalId: string;
  readonly digest: string | null;
}

export type DeploymentEnvironment = "production" | "preview" | "development" | "unknown";
export interface Deployment {
  readonly id: string;
  readonly provider: "vercel";
  readonly externalId: string;
  readonly environment: DeploymentEnvironment;
  readonly commitSha: string | null;
  readonly status: string;
  readonly deployedAt: string | null;
  readonly url: string | null;
}

export type ProductionEffectType = "issue" | "error_spike" | "release" | "unknown";
export interface ProductionEffect {
  readonly id: string;
  readonly provider: "sentry";
  readonly type: ProductionEffectType;
  readonly externalId: string;
  readonly title: string | null;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly url: string | null;
}

export type RelationshipType =
  | "implements"
  | "contains"
  | "validated_by"
  | "deployed_as"
  | "observed_by"
  | "linked_to";

export interface RelationshipProvenance {
  readonly rule: string;
  readonly sourceIds: readonly string[];
  readonly constructedAt: string;
}

export interface Relationship {
  readonly from: string;
  readonly to: string;
  readonly type: RelationshipType;
  readonly provenance: RelationshipProvenance;
}

export interface Provenance {
  readonly sources: readonly string[];
  readonly constructedAt: string;
  readonly schemaVersion: typeof SCHEMA_VERSION;
}

export interface Change {
  readonly id: string;
  readonly intent: Intent | null;
  readonly pullRequests: readonly PullRequest[];
  readonly commits: readonly Commit[];
  readonly checks: readonly Check[];
  readonly artifacts: readonly Artifact[];
  readonly deployments: readonly Deployment[];
  readonly productionEffects: readonly ProductionEffect[];
  readonly relationships: readonly Relationship[];
  readonly provenance: Provenance;
}

export function changeIdFromSha(sha: string): string {
  return `chg_${sha.slice(0, 8)}`;
}

export function changeIdFromPr(repo: string, number: number): string {
  const safeRepo = repo.replace(/[^a-zA-Z0-9]/g, "-");
  return `chg_github_${safeRepo}_${number}`;
}
