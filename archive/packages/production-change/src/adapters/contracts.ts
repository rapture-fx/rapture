export interface DeploymentRecord {
  readonly provider: string;
  readonly externalId: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly environment: string;
  readonly providerEnvironmentId: string | null;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly repository: string | null;
  readonly artifactDigest: string | null;
  readonly artifactExternalId: string | null;
  readonly raw: unknown;
}

export interface RawDeploymentSnapshot {
  readonly provider: string;
  readonly externalId: string;
  readonly fetchedAt: string;
  readonly data: unknown;
}

export interface ProviderAdapter {
  readonly provider: string;
  normalize(raw: RawDeploymentSnapshot): DeploymentRecord | null;
}
