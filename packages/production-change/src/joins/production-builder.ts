import { SCHEMA_VERSION } from "../schema/version.js";
import type { ProductionChange } from "../schema/production-change.js";
import { productionChangeId } from "../schema/production-change.js";
import type { DeploymentRecord } from "../adapters/contracts.js";

export interface ProductionStore {
  readonly deployments: readonly DeploymentRecord[];
  readonly sentryReleases?: readonly {
    externalId: string;
    commitSha: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
  }[];
  readonly sentryIssues?: readonly {
    externalId: string;
    title: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
    releaseVersion: string | null;
  }[];
}

function normalizeStatus(status: string): ProductionChange["deployment"]["status"] {
  const s = status.toLowerCase();
  if (s === "queued") return "queued";
  if (s === "building") return "building";
  if (s === "deploying") return "deploying";
  if (s === "ready" || s === "succeeded" || s === "success") return "ready";
  // Cloudflare Pages reports "Failure"; without this it fell through to "unknown",
  // hiding a failed deployment behind an inconclusive status.
  if (s === "failed" || s === "error" || s === "failure") return "failed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "unknown";
}

export function buildProductionChanges(store: ProductionStore): readonly ProductionChange[] {
  // Group by service+environment
  const byServiceEnv = new Map<string, DeploymentRecord[]>();
  for (const dep of store.deployments) {
    const key = `${dep.serviceId}|${dep.environment}`;
    const arr = byServiceEnv.get(key) ?? [];
    arr.push(dep);
    byServiceEnv.set(key, arr);
  }

  const changes: ProductionChange[] = [];

  for (const [, deps] of byServiceEnv) {
    // Sort by completedAt (or startedAt) asc, only successful ready deployments
    const sorted = [...deps].sort((a, b) => {
      const aTime = a.completedAt ?? a.startedAt ?? "";
      const bTime = b.completedAt ?? b.startedAt ?? "";
      return aTime.localeCompare(bTime);
    });

    for (let i = 0; i < sorted.length; i++) {
      const dep = sorted[i]!;
      const prev = i > 0 ? sorted[i - 1]! : null;
      // For transition, find previous successful
      let prevSuccessful: DeploymentRecord | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const cand = sorted[j]!;
        if (normalizeStatus(cand.status) === "ready") {
          prevSuccessful = cand;
          break;
        }
      }

      const serviceId = dep.serviceId;
      const serviceName = dep.serviceName;
      const envName = dep.environment;
      const providerEnvId = dep.providerEnvironmentId;
      const commitSha = dep.commitSha;
      const repo = dep.repository;
      const branch = dep.branch;

      const idKey = dep.externalId;
      const id = productionChangeId(serviceId, envName, idKey);

      // Runtime observations: Sentry releases/issues linked via exact SHA
      const runtimeObservations: {
        provider: string;
        type: "release" | "error" | "issue" | "metric" | "event" | "unknown";
        externalId: string;
        deterministicLinkRule: string;
        firstSeen: string | null;
        lastSeen: string | null;
      }[] = [];
      if (commitSha) {
        // Sentry releases where version == commitSha
        for (const rel of store.sentryReleases ?? []) {
          if (rel.commitSha && rel.commitSha.toLowerCase() === commitSha.toLowerCase()) {
            runtimeObservations.push({
              provider: "sentry",
              type: "release",
              externalId: rel.externalId,
              deterministicLinkRule: "sentry.release.version_sha",
              firstSeen: rel.firstSeen,
              lastSeen: rel.lastSeen,
            });
          } else if (rel.externalId && rel.externalId.toLowerCase() === commitSha.toLowerCase()) {
            runtimeObservations.push({
              provider: "sentry",
              type: "release",
              externalId: rel.externalId,
              deterministicLinkRule: "sentry.release.version_sha",
              firstSeen: rel.firstSeen,
              lastSeen: rel.lastSeen,
            });
          }
        }
        for (const issue of store.sentryIssues ?? []) {
          if (
            issue.releaseVersion &&
            issue.releaseVersion.toLowerCase() === commitSha.toLowerCase()
          ) {
            runtimeObservations.push({
              provider: "sentry",
              type: "issue",
              externalId: issue.externalId,
              deterministicLinkRule: "sentry.issue.release_version_sha",
              firstSeen: issue.firstSeen,
              lastSeen: issue.lastSeen,
            });
          }
        }
      }

      const sources: string[] = [dep.externalId];
      if (commitSha) sources.push(commitSha);
      if (dep.artifactDigest) sources.push(dep.artifactDigest);

      const pc: ProductionChange = {
        id,
        service: { id: serviceId, name: serviceName },
        environment: { name: envName, providerEnvironmentId: providerEnvId },
        source: {
          repository: repo,
          commitSha,
          branch,
          pullRequest: null,
        },
        artifact: {
          type: dep.artifactDigest
            ? "container"
            : dep.artifactExternalId
              ? "deployment_artifact"
              : "unknown",
          digest: dep.artifactDigest,
          externalId: dep.artifactExternalId,
        },
        deployment: {
          provider: dep.provider,
          externalId: dep.externalId,
          status: normalizeStatus(dep.status),
          startedAt: dep.startedAt,
          completedAt: dep.completedAt,
        },
        transition: {
          // The id key MUST match how a record's own id is derived above
          // (productionChangeId(serviceId, envName, dep.externalId)). Deriving it
          // from artifactDigest/commitSha instead produces an id that matches no
          // emitted record, leaving every transition link dangling.
          previousProductionChangeId: prevSuccessful
            ? productionChangeId(
                prevSuccessful.serviceId,
                prevSuccessful.environment,
                prevSuccessful.externalId,
              )
            : null,
          previousCommitSha: prevSuccessful?.commitSha ?? prev?.commitSha ?? null,
          resultingCommitSha: commitSha,
        },
        runtimeObservations,
        provenance: {
          schemaVersion: SCHEMA_VERSION,
          constructedAt: new Date().toISOString(),
          sources,
        },
      };
      changes.push(pc);
    }
  }

  return changes;
}
