import type { ProductionEffect } from "../schema/change.js";
import type { NormalizedRecords, ProviderAdapter, RawSnapshot } from "./contracts.js";

export interface SentryReleaseRaw {
  readonly id: string;
  readonly version: string;
  readonly shortVersion: string;
  readonly dateCreated: string;
  readonly lastEvent: string | null;
  readonly commitCount?: number;
  readonly lastCommit?: { readonly id: string } | null;
}

export interface SentryIssueRaw {
  readonly id: string;
  readonly title: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly permalink: string;
  readonly shortId: string;
}

function effectId(_provider: string, externalId: string): string {
  return `effect_sentry_${externalId}`;
}

export function normalizeSentryRelease(raw: SentryReleaseRaw): ProductionEffect {
  return {
    id: effectId("sentry", raw.version),
    provider: "sentry",
    type: "release",
    externalId: raw.version,
    title: raw.shortVersion ?? raw.version,
    firstSeen: raw.dateCreated ?? null,
    lastSeen: raw.lastEvent ?? null,
    url: null,
  };
}

export function normalizeSentryIssue(raw: SentryIssueRaw): ProductionEffect {
  return {
    id: effectId("sentry", raw.id),
    provider: "sentry",
    type: "issue",
    externalId: raw.id,
    title: raw.title,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    url: raw.permalink ?? null,
  };
}

export const sentryAdapter: ProviderAdapter = {
  provider: "sentry",
  normalize(raw: RawSnapshot): NormalizedRecords {
    const data = raw.data as Record<string, unknown>;
    if (typeof data["version"] === "string" && typeof data["dateCreated"] === "string") {
      const eff = normalizeSentryRelease(data as unknown as SentryReleaseRaw);
      return { productionEffects: [eff] };
    }
    if (typeof data["id"] === "string" && typeof data["title"] === "string" && typeof data["firstSeen"] === "string") {
      const eff = normalizeSentryIssue(data as unknown as SentryIssueRaw);
      return { productionEffects: [eff] };
    }
    return {};
  },
};
