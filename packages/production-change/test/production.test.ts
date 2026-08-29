import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../src/schema/version.js";
import { vercelAdapter } from "../src/adapters/vercel.js";
import { kubernetesAdapter } from "../src/adapters/kubernetes.js";
import { cloudflareAdapter } from "../src/adapters/cloudflare.js";
import { buildProductionChanges } from "../src/joins/production-builder.js";
import { saveProductionChange, loadProductionChange, listProductionChanges, saveRaw, listRaw } from "../src/store/storage.js";
import { createProductionApi } from "../src/api/production.js";
import { currentVersion, previousVersion, artifactForChange } from "../src/consumer.js";
import type { ProductionChange } from "../src/schema/production-change.js";

describe("ProductionChange schema", () => {
  it("has versioned schema", () => {
    expect(SCHEMA_VERSION).toBe("1");
  });
  it("unknown fields remain null", async () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl_1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: null,
          branch: null,
          repository: null,
          artifactDigest: null,
          artifactExternalId: "dpl_1",
          raw: {},
        },
      ],
    });
    expect(changes[0]?.source.commitSha).toBeNull();
    expect(changes[0]?.source.repository).toBeNull();
  });
  it("provider-specific fields do not leak", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl_1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123def456",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl_1",
          raw: { meta: { githubCommitSha: "abc123" }, extra: "should not leak" },
        },
      ],
    });
    const pc = changes[0] as unknown as Record<string, unknown>;
    expect(pc["meta"]).toBeUndefined();
    expect(pc["raw"]).toBeUndefined();
  });
});

describe("Provider adapters", () => {
  it("vercel normalizes", () => {
    const raw = {
      provider: "vercel",
      externalId: "dpl_123",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "dpl_123",
        url: "example.vercel.app",
        state: "READY",
        target: "production",
        source: "git",
        createdAt: Date.now(),
        meta: { githubCommitSha: "abc123def456abc123def456abc123def456abcd" },
      },
    };
    const rec = vercelAdapter.normalize(raw as never);
    expect(rec?.commitSha).toBe("abc123def456abc123def456abc123def456abcd");
    expect(rec?.environment).toBe("production");
  });
  it("kubernetes normalizes", () => {
    const raw = {
      provider: "kubernetes",
      externalId: "uid-123",
      fetchedAt: new Date().toISOString(),
      data: {
        metadata: { name: "api", namespace: "production", uid: "uid-123", creationTimestamp: "2024-01-01T00:00:00Z" },
        spec: { template: { spec: { containers: [{ name: "api", image: "myapp:abc123def456", imageID: "docker-pullable://myapp@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd" }] } } },
        status: { conditions: [{ type: "Available", status: "True", lastTransitionTime: "2024-01-01T01:00:00Z" }] },
      },
    };
    const rec = kubernetesAdapter.normalize(raw as never);
    expect(rec?.serviceId).toBe("k8s:production/api");
    expect(rec?.artifactDigest?.startsWith("sha256:")).toBe(true);
    expect(rec?.artifactDigest?.length).toBe(71); // sha256: + 64
  });
  it("cloudflare normalizes", () => {
    const raw = {
      provider: "cloudflare",
      externalId: "dep-1",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "dep-1",
        environment: "production",
        status: "success",
        created_on: "2024-01-01T00:00:00Z",
        modified_on: "2024-01-01T01:00:00Z",
        source: { repo: "owner/repo", branch: "main", commit: "abc123def456" },
        project_name: "my-site",
      },
    };
    const rec = cloudflareAdapter.normalize(raw as never);
    expect(rec?.commitSha).toBe("abc123def456");
  });
});

describe("Deterministic joins", () => {
  it("exact source-revision join", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123def456",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
    });
    expect(changes[0]?.source.commitSha).toBe("abc123def456");
  });

  it("previous deployment ordering", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "aaa111",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
        {
          provider: "vercel",
          externalId: "dpl2",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-02T00:00:00Z",
          completedAt: "2024-01-02T01:00:00Z",
          commitSha: "bbb222",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl2",
          raw: {},
        },
      ],
    });
    const second = changes.find((c) => c.deployment.externalId === "dpl2");
    expect(second?.transition.previousCommitSha).toBe("aaa111");
    expect(second?.transition.previousProductionChangeId).toBeDefined();
  });

  it("no timestamp-only join", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "aaa111",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
        {
          provider: "vercel",
          externalId: "dpl2",
          serviceId: "vercel:proj2",
          serviceName: "proj2",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:01Z",
          completedAt: "2024-01-01T01:00:01Z",
          commitSha: "bbb222",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl2",
          raw: {},
        },
      ],
    });
    // Different service, should not link
    const second = changes.find((c) => c.deployment.externalId === "dpl2");
    expect(second?.transition.previousCommitSha).toBeNull();
  });

  it("runtime observation deterministic link", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123def456",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
      sentryReleases: [{ externalId: "abc123def456", commitSha: "abc123def456", firstSeen: "2024-01-01T00:00:00Z", lastSeen: "2024-01-02T00:00:00Z" }],
    });
    expect(changes[0]?.runtimeObservations.length).toBe(1);
    expect(changes[0]?.runtimeObservations[0]?.deterministicLinkRule).toBe("sentry.release.version_sha");
  });

  it("unknown fields remain", () => {
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: null,
          completedAt: null,
          commitSha: null,
          branch: null,
          repository: null,
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
    });
    expect(changes[0]?.source.commitSha).toBeNull();
    expect(changes[0]?.transition.previousCommitSha).toBeNull();
  });
});

describe("Storage and consumer", () => {
  it("saves and loads", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "prod-test-"));
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
    });
    const { saveProductionChange, listProductionChanges } = await import("../src/store/storage.js");
    for (const pc of changes) await saveProductionChange(tmp, pc);
    const listed = await listProductionChanges(tmp);
    expect(listed.length).toBe(1);
    const api = (await import("../src/api/production.js")).createProductionApi(tmp);
    expect((await api.get(changes[0]!.id))?.id).toBe(changes[0]!.id);
    expect((await api.findByCommit("abc123"))?.length).toBe(1);
    expect((await api.current("vercel:proj", "production"))?.id).toBe(changes[0]!.id);
    await rm(tmp, { recursive: true, force: true });
  });

  it("provider-independent consumer", async () => {
    const vercelChanges = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
    });
    const k8sChanges = buildProductionChanges({
      deployments: [
        {
          provider: "kubernetes",
          externalId: "uid1",
          serviceId: "k8s:default/api",
          serviceName: "api",
          environment: "production",
          providerEnvironmentId: "default",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123",
          branch: null,
          repository: null,
          artifactDigest: "sha256:abc",
          artifactExternalId: "myapp:abc123",
          raw: {},
        },
      ],
    });
    const v1 = vercelChanges[0]!;
    const k1 = k8sChanges[0]!;
    // Same consumer functions work for both without branching on provider
    expect(currentVersion(v1)).toBe("abc123");
    expect(currentVersion(k1)).toBe("abc123");
    expect(artifactForChange(v1)).toBe("dpl1");
    expect(artifactForChange(k1)).toBe("sha256:abc");
    expect(previousVersion(v1)).toBeNull();
  });

  it("stable JSON", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "prod-json-"));
    const changes = buildProductionChanges({
      deployments: [
        {
          provider: "vercel",
          externalId: "dpl1",
          serviceId: "vercel:proj",
          serviceName: "proj",
          environment: "production",
          providerEnvironmentId: "production",
          status: "ready",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T01:00:00Z",
          commitSha: "abc123",
          branch: "main",
          repository: "owner/repo",
          artifactDigest: null,
          artifactExternalId: "dpl1",
          raw: {},
        },
      ],
    });
    const { saveProductionChange, loadProductionChange } = await import("../src/store/storage.js");
    await saveProductionChange(tmp, changes[0]!);
    const a = await loadProductionChange(tmp, changes[0]!.id);
    const b = await loadProductionChange(tmp, changes[0]!.id);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    await rm(tmp, { recursive: true, force: true });
  });
});
