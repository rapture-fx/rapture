import type { DeploymentRecord, ProviderAdapter, RawDeploymentSnapshot } from "./contracts.js";

export interface CloudflareDeploymentRaw {
  readonly id: string;
  readonly environment: string;
  readonly status: string;
  readonly created_on: string;
  readonly modified_on: string;
  readonly source?: {
    readonly repo: string;
    readonly branch: string;
    readonly commit: string;
  };
  readonly project_name?: string;
  readonly url?: string;
}

export const cloudflareAdapter: ProviderAdapter = {
  provider: "cloudflare",
  normalize(raw: RawDeploymentSnapshot): DeploymentRecord | null {
    const data = raw.data as Record<string, unknown>;
    if (typeof data["id"] !== "string" || typeof data["environment"] !== "string") return null;
    const d = data as unknown as CloudflareDeploymentRaw;
    const serviceId = `cloudflare:${d.project_name ?? "unknown"}`;
    const serviceName = d.project_name ?? "unknown";
    return {
      provider: "cloudflare",
      externalId: d.id,
      serviceId,
      serviceName,
      environment: d.environment,
      providerEnvironmentId: d.environment,
      status: d.status.toLowerCase(),
      startedAt: d.created_on ?? null,
      completedAt: d.modified_on ?? null,
      commitSha: d.source?.commit && /^[0-9a-f]{7,40}$/i.test(d.source.commit) ? d.source.commit : null,
      branch: d.source?.branch ?? null,
      repository: d.source?.repo ?? null,
      artifactDigest: null,
      artifactExternalId: d.id,
      raw: data,
    };
  },
};
