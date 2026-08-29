import type { Artifact, Check, Commit, Deployment, Intent, ProductionEffect, PullRequest } from "../schema/change.js";

export type ProviderId = "github" | "github_actions" | "vercel" | "sentry" | "linear";

export interface RawSnapshot {
  readonly provider: ProviderId;
  readonly externalId: string;
  readonly fetchedAt: string;
  readonly data: unknown;
}

export interface NormalizedRecords {
  readonly pullRequests?: readonly PullRequest[];
  readonly commits?: readonly Commit[];
  readonly checks?: readonly Check[];
  readonly artifacts?: readonly Artifact[];
  readonly deployments?: readonly Deployment[];
  readonly productionEffects?: readonly ProductionEffect[];
  readonly intents?: readonly Intent[];
}

export interface ProviderAdapter {
  readonly provider: ProviderId;
  normalize(raw: RawSnapshot): NormalizedRecords;
}

export interface AdapterContext {
  readonly repository?: string;
}
