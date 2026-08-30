import type { DeploymentRecord, ProviderAdapter, RawDeploymentSnapshot } from "./contracts.js";

export interface CloudflareDeploymentRaw {
  readonly id?: string;
  readonly Id?: string;
  readonly environment?: string;
  readonly Environment?: string;
  readonly status?: string;
  readonly Status?: string;
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly source?:
    | {
        readonly repo: string;
        readonly branch: string;
        readonly commit: string;
      }
    | string;
  readonly Source?: string;
  readonly Branch?: string;
  readonly Deployment?: string;
  readonly Build?: string;
  readonly project_name?: string;
  readonly ProjectName?: string;
  readonly url?: string;
}

export const cloudflareAdapter: ProviderAdapter = {
  provider: "cloudflare",
  normalize(raw: RawDeploymentSnapshot): DeploymentRecord | null {
    const data = raw.data as Record<string, unknown>;
    // Handle both fixture (id, environment) and real wrangler (Id, Environment, Source as string)
    const id = (data["id"] as string) ?? (data["Id"] as string);
    const env = (data["environment"] as string) ?? (data["Environment"] as string);
    if (typeof id !== "string" || typeof env !== "string") return null;
    const d = data as unknown as CloudflareDeploymentRaw & Record<string, unknown>;
    // Real wrangler payload: Source is short SHA string, Branch is string, Deployment is URL
    const sourceVal = (d.Source ?? d.source) as unknown;
    let commitSha: string | null = null;
    let branch: string | null = null;
    let repo: string | null = null;
    if (typeof sourceVal === "string" && /^[0-9a-f]{7,40}$/i.test(sourceVal)) {
      commitSha = sourceVal;
    } else if (sourceVal && typeof sourceVal === "object") {
      const s = sourceVal as { repo?: string; branch?: string; commit?: string };
      if (s.commit && /^[0-9a-f]{7,40}$/i.test(s.commit)) commitSha = s.commit;
      branch = s.branch ?? null;
      repo = s.repo ?? null;
    }
    // Branch may be separate field
    const branchVal = (d.Branch as string) ?? (d.branch as string) ?? branch;
    if (branchVal) branch = branchVal;
    // Environment
    const environment = env;
    // Status: real wrangler has Status like "3 days ago" which is not a status, treat as ready if Environment is Production/Preview
    let status = (d.status as string) ?? (d.Status as string) ?? "unknown";
    if (status.includes("ago") || status.includes("day") || status.includes("hour")) {
      status = "ready";
    }
    const serviceName = (d.project_name as string) ?? (d.ProjectName as string) ?? "igris";
    const serviceId = `cloudflare:${serviceName}`;
    const normalizedEnv = environment.toLowerCase();
    const startedAt = (d.created_on as string) ?? null;
    const completedAt = (d.modified_on as string) ?? (d.created_on as string) ?? null;
    // For real wrangler, use current time as completedAt if not available, but keep null for now
    // Use Deployment URL as externalId if needed, but id is already the deployment id
    return {
      provider: "cloudflare",
      externalId: id,
      serviceId,
      serviceName,
      environment: normalizedEnv,
      providerEnvironmentId: environment,
      status: status.toLowerCase(),
      startedAt,
      completedAt,
      commitSha,
      branch,
      repository: repo,
      artifactDigest: null,
      artifactExternalId: id,
      raw: data,
    };
  },
};
