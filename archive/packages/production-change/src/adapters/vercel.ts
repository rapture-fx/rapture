import type { DeploymentRecord, ProviderAdapter, RawDeploymentSnapshot } from "./contracts.js";

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
    readonly githubCommitRepo?: string;
  };
  readonly gitSource?: {
    readonly sha: string;
    readonly ref: string;
    readonly repo?: string;
  };
  readonly projectId?: string;
  readonly name?: string;
}

function normalizeStatus(state: string): string {
  const s = state.toLowerCase();
  if (s === "queued") return "queued";
  if (s === "building") return "building";
  if (s === "deploying") return "deploying";
  if (s === "ready") return "ready";
  if (s === "error" || s === "failed") return "failed";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  return "unknown";
}

function normalizeEnv(target: string | null): string {
  if (target === "production") return "production";
  if (target === "preview") return "preview";
  if (target === "development") return "development";
  return target ?? "unknown";
}

export const vercelAdapter: ProviderAdapter = {
  provider: "vercel",
  normalize(raw: RawDeploymentSnapshot): DeploymentRecord | null {
    const data = raw.data as Record<string, unknown>;
    if (typeof data["id"] !== "string" || typeof data["state"] !== "string") return null;
    const d = data as unknown as VercelDeploymentRaw;
    const sha = d.meta?.githubCommitSha ?? d.meta?.gitCommitSha ?? d.gitSource?.sha ?? null;
    const repo = d.meta?.githubCommitRepo ?? d.gitSource?.repo ?? null;
    const branch = d.meta?.githubCommitRef ?? d.gitSource?.ref ?? null;
    const serviceId = d.projectId ? `vercel:${d.projectId}` : `vercel:${d.name ?? "unknown"}`;
    const serviceName = d.name ?? d.projectId ?? "unknown";
    return {
      provider: "vercel",
      externalId: d.id,
      serviceId,
      serviceName,
      environment: normalizeEnv(d.target),
      providerEnvironmentId: d.target,
      status: normalizeStatus(d.state),
      startedAt: d.createdAt
        ? new Date(
            typeof d.createdAt === "number" ? d.createdAt : Date.parse(d.createdAt as string),
          ).toISOString()
        : null,
      completedAt: d.createdAt
        ? new Date(
            typeof d.createdAt === "number" ? d.createdAt : Date.parse(d.createdAt as string),
          ).toISOString()
        : null,
      commitSha: sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null,
      branch,
      repository: repo,
      artifactDigest: null,
      artifactExternalId: d.id,
      raw: data,
    };
  },
};
