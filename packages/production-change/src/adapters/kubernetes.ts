import type { DeploymentRecord, ProviderAdapter, RawDeploymentSnapshot } from "./contracts.js";

export interface KubernetesDeploymentRaw {
  readonly metadata: {
    readonly name: string;
    readonly namespace: string;
    readonly uid: string;
    readonly creationTimestamp: string;
  };
  readonly spec: {
    readonly template: {
      readonly spec: {
        readonly containers: readonly {
          readonly name: string;
          readonly image: string;
          readonly imageID?: string;
        }[];
      };
    };
  };
  readonly status?: {
    readonly conditions?: readonly {
      readonly type: string;
      readonly status: string;
      readonly lastTransitionTime: string;
    }[];
    readonly observedGeneration?: number;
  };
}

function extractDigest(imageID: string | undefined, image: string): string | null {
  if (imageID) {
    const match = imageID.match(/sha256:([0-9a-f]{64})/i);
    if (match) return `sha256:${match[1]}`;
  }
  const match = image.match(/sha256:([0-9a-f]{64})/i);
  if (match) return `sha256:${match[1]}`;
  return null;
}

function extractCommitFromImage(image: string): string | null {
  // Try to extract SHA from image tag if it looks like a commit (e.g., myapp:abc123def)
  const tagMatch = image.match(/:([0-9a-f]{7,40})(?:-|$)/i);
  if (tagMatch && tagMatch[1]) return tagMatch[1];
  return null;
}

export const kubernetesAdapter: ProviderAdapter = {
  provider: "kubernetes",
  normalize(raw: RawDeploymentSnapshot): DeploymentRecord | null {
    const data = raw.data as Record<string, unknown>;
    const metadata = (data["metadata"] as Record<string, unknown>) ?? {};
    if (typeof metadata["name"] !== "string" || typeof metadata["namespace"] !== "string") return null;
    const md = data as unknown as KubernetesDeploymentRaw;
    const serviceId = `k8s:${md.metadata.namespace}/${md.metadata.name}`;
    const serviceName = md.metadata.name;
    const container = md.spec.template.spec.containers[0];
    const digest = extractDigest(container?.imageID, container?.image ?? "");
    const commitSha = extractCommitFromImage(container?.image ?? "");
    const status = md.status?.conditions?.find((c) => c.type === "Available")?.status === "True" ? "ready" : "unknown";
    return {
      provider: "kubernetes",
      externalId: md.metadata.uid,
      serviceId,
      serviceName,
      environment: md.metadata.namespace === "production" ? "production" : md.metadata.namespace,
      providerEnvironmentId: md.metadata.namespace,
      status,
      startedAt: md.metadata.creationTimestamp ?? null,
      completedAt: md.status?.conditions?.[0]?.lastTransitionTime ?? null,
      commitSha: commitSha && /^[0-9a-f]{7,40}$/i.test(commitSha) ? commitSha : null,
      branch: null,
      repository: null,
      artifactDigest: digest,
      artifactExternalId: container?.image ?? null,
      raw: data,
    };
  },
};
