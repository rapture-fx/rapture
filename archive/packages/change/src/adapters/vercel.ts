import type { Deployment } from "../schema/change.js";
import type { NormalizedRecords, ProviderAdapter, RawSnapshot } from "./contracts.js";

export interface VercelDeploymentRaw {
  readonly id: string;
  readonly url: string;
  readonly state: string;
  readonly target: string | null;
  readonly source: string;
  readonly createdAt: number | string;
  readonly meta?: {
    readonly githubCommitSha?: string;
    readonly gitCommitSha?: string;
    readonly githubCommitRef?: string;
  };
  readonly gitSource?: {
    readonly sha: string;
    readonly ref: string;
  };
}

function mapEnv(target: string | null, _source: string): Deployment["environment"] {
  if (target === "production") return "production";
  if (target === "preview") return "preview";
  if (target === "development") return "development";
  return "unknown";
}

function deploymentId(externalId: string): string {
  return `deploy_vercel_${externalId}`;
}

export function normalizeDeployment(raw: VercelDeploymentRaw): Deployment {
  const sha = raw.meta?.githubCommitSha ?? raw.meta?.gitCommitSha ?? raw.gitSource?.sha ?? null;
  return {
    id: deploymentId(raw.id),
    provider: "vercel",
    externalId: raw.id,
    environment: mapEnv(raw.target, raw.source),
    commitSha: sha,
    status: raw.state,
    deployedAt: raw.createdAt
      ? new Date(
          typeof raw.createdAt === "number" ? raw.createdAt : Date.parse(raw.createdAt as string),
        ).toISOString()
      : null,
    url: raw.url ? `https://${raw.url}` : null,
  };
}

export const vercelAdapter: ProviderAdapter = {
  provider: "vercel",
  normalize(raw: RawSnapshot): NormalizedRecords {
    const data = raw.data as Record<string, unknown>;
    if (typeof data["id"] === "string" && typeof data["state"] === "string") {
      const dep = normalizeDeployment(data as unknown as VercelDeploymentRaw);
      return { deployments: [dep] };
    }
    if (Array.isArray((data as Record<string, unknown>)["deployments"])) {
      const deps = (data as Record<string, unknown>)["deployments"] as VercelDeploymentRaw[];
      return { deployments: deps.map(normalizeDeployment) };
    }
    return {};
  },
};
