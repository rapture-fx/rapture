import { createHash } from "node:crypto";
import { SCHEMA_VERSION } from "./version.js";

export interface ProductionChange {
  readonly id: string;
  readonly service: {
    readonly id: string;
    readonly name: string;
  };
  readonly environment: {
    readonly name: string;
    readonly providerEnvironmentId: string | null;
  };
  readonly source: {
    readonly repository: string | null;
    readonly commitSha: string | null;
    readonly branch: string | null;
    readonly pullRequest: string | null;
  };
  readonly artifact: {
    readonly type: "container" | "bundle" | "deployment_artifact" | "release" | "unknown";
    readonly digest: string | null;
    readonly externalId: string | null;
  };
  readonly deployment: {
    readonly provider: string;
    readonly externalId: string;
    readonly status: "queued" | "building" | "deploying" | "ready" | "failed" | "cancelled" | "unknown";
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  };
  readonly transition: {
    readonly previousProductionChangeId: string | null;
    readonly previousCommitSha: string | null;
    readonly resultingCommitSha: string | null;
  };
  readonly runtimeObservations: readonly {
    readonly provider: string;
    readonly type: "release" | "error" | "issue" | "metric" | "event" | "unknown";
    readonly externalId: string;
    readonly deterministicLinkRule: string;
    readonly firstSeen: string | null;
    readonly lastSeen: string | null;
  }[];
  readonly provenance: {
    readonly schemaVersion: typeof SCHEMA_VERSION;
    readonly constructedAt: string;
    readonly sources: readonly string[];
  };
}

export function productionChangeId(serviceId: string, env: string, key: string): string {
  const safeService = serviceId.replace(/[^a-zA-Z0-9]/g, "-");
  const safeEnv = env.replace(/[^a-zA-Z0-9]/g, "-");
  // Use hash for uniqueness when key is long like URL
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `pc_${safeService}_${safeEnv}_${hash}`;
}
