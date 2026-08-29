import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../src/schema/version.js";
import type { Change } from "../src/schema/change.js";
import { githubAdapter, normalizePr, normalizeCommit } from "../src/adapters/github.js";
import { githubActionsAdapter, normalizeCheck } from "../src/adapters/github-actions.js";
import { vercelAdapter, normalizeDeployment } from "../src/adapters/vercel.js";
import { linearAdapter, extractLinearId } from "../src/adapters/linear.js";
import { sentryAdapter } from "../src/adapters/sentry.js";
import { buildChanges } from "../src/joins/builder.js";
import { JOIN_RULES } from "../src/joins/rules.js";
import { saveRaw, saveCanonical, listChanges, loadChange, changeRoot } from "../src/store/storage.js";
import { createChangeApi } from "../src/api/changes.js";

describe("Canonical schema", () => {
  it("has versioned schema and stable IDs", () => {
    expect(SCHEMA_VERSION).toBe("1");
    const pr = normalizePr("owner/repo", {
      number: 123,
      title: "Fix bug",
      state: "closed",
      html_url: "https://github.com/owner/repo/pull/123",
      merged_at: "2024-01-01T00:00:00Z",
      merge_commit_sha: "abc123",
      head: { sha: "abc123" },
      base: { repo: { full_name: "owner/repo" } },
    });
    expect(pr.id).toBe("pr_github_owner-repo_123");
    expect(pr.provider).toBe("github");
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123def456",
      commit: { message: "fix", author: { date: "2024-01-01T00:00:00Z" } },
    });
    expect(commit.id).toBe("commit_abc123def456");
    expect(commit.sha).toBe("abc123def456");
  });

  it("unknown fields remain nullable", () => {
    const pr = normalizePr("owner/repo", {
      number: 1,
      title: "t",
      state: "open",
      html_url: "https://example.com",
      merged_at: null,
      merge_commit_sha: null,
      head: { sha: "sha1" },
      base: { repo: { full_name: "owner/repo" } },
    });
    expect(pr.mergedAt).toBeNull();
    expect(pr.mergeCommitSha).toBeNull();
  });

  it("provider-specific fields do not leak into core", () => {
    // Core Change should not have raw GitHub fields like "merged_at"
    const pr = normalizePr("owner/repo", {
      number: 1,
      title: "t",
      state: "open",
      html_url: "https://example.com",
      merged_at: null,
      merge_commit_sha: null,
      head: { sha: "sha1" },
      base: { repo: { full_name: "owner/repo" } },
    });
    expect((pr as Record<string, unknown>)["merged_at"]).toBeUndefined();
    expect((pr as Record<string, unknown>)["html_url"]).toBeUndefined();
    expect(pr.url).toBe("https://example.com");
  });
});

describe("Provider adapter contracts", () => {
  it("github adapter normalizes PR", () => {
    const raw = {
      provider: "github" as const,
      externalId: "owner/repo#123",
      fetchedAt: new Date().toISOString(),
      data: {
        number: 123,
        title: "Fix",
        state: "closed",
        html_url: "https://github.com/owner/repo/pull/123",
        merged_at: "2024-01-01T00:00:00Z",
        merge_commit_sha: "abc",
        head: { sha: "abc" },
        base: { repo: { full_name: "owner/repo" } },
        repository: "owner/repo",
      },
    };
    const out = githubAdapter.normalize(raw);
    expect(out.pullRequests?.length).toBe(1);
    expect(out.pullRequests?.[0]?.number).toBe(123);
  });

  it("github adapter normalizes commit", () => {
    const raw = {
      provider: "github" as const,
      externalId: "abc123",
      fetchedAt: new Date().toISOString(),
      data: {
        sha: "abc123",
        commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
        repository: "owner/repo",
      },
    };
    const out = githubAdapter.normalize(raw);
    expect(out.commits?.length).toBe(1);
  });

  it("github_actions normalizes check", () => {
    const raw = {
      provider: "github_actions" as const,
      externalId: "123",
      fetchedAt: new Date().toISOString(),
      data: {
        id: 123,
        name: "CI",
        status: "completed",
        conclusion: "success",
        head_sha: "abc",
        html_url: "https://example.com",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T01:00:00Z",
      },
    };
    const out = githubActionsAdapter.normalize(raw);
    expect(out.checks?.[0]?.status).toBe("passed");
    expect(out.checks?.[0]?.commitSha).toBe("abc");
  });

  it("vercel normalizes deployment", () => {
    const raw = {
      provider: "vercel" as const,
      externalId: "dpl_123",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "dpl_123",
        url: "example.vercel.app",
        state: "READY",
        target: "production",
        source: "git",
        createdAt: Date.now(),
        meta: { githubCommitSha: "abc123" },
      },
    };
    const out = vercelAdapter.normalize(raw);
    expect(out.deployments?.[0]?.commitSha).toBe("abc123");
    expect(out.deployments?.[0]?.environment).toBe("production");
  });

  it("linear normalizes intent and extracts id", () => {
    const raw = {
      provider: "linear" as const,
      externalId: "ENG-123",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "uuid",
        identifier: "ENG-123",
        title: "Fix bug",
        description: "details",
        url: "https://linear.app/issue/ENG-123",
      },
    };
    const out = linearAdapter.normalize(raw);
    expect(out.intents?.[0]?.externalId).toBe("ENG-123");
    expect(extractLinearId("Fix ENG-123 bug")).toBe("ENG-123");
    expect(extractLinearId("feat/ENG-456")).toBe("ENG-456");
  });

  it("sentry normalizes release and issue", () => {
    const relRaw = {
      provider: "sentry" as const,
      externalId: "abc123def456",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "1",
        version: "abc123def456",
        shortVersion: "abc123",
        dateCreated: "2024-01-01T00:00:00Z",
        lastEvent: "2024-01-02T00:00:00Z",
      },
    };
    const out1 = sentryAdapter.normalize(relRaw);
    expect(out1.productionEffects?.[0]?.type).toBe("release");

    const issueRaw = {
      provider: "sentry" as const,
      externalId: "ISSUE-1",
      fetchedAt: new Date().toISOString(),
      data: {
        id: "ISSUE-1",
        title: "Error",
        firstSeen: "2024-01-01T00:00:00Z",
        lastSeen: "2024-01-02T00:00:00Z",
        permalink: "https://sentry.io/issue/1",
        shortId: "1",
      },
    };
    const out2 = sentryAdapter.normalize(issueRaw);
    expect(out2.productionEffects?.[0]?.type).toBe("issue");
  });
});

describe("Deterministic joins", () => {
  it("PR merge SHA ↔ Commit SHA", () => {
    const pr = normalizePr("owner/repo", {
      number: 1,
      title: "Fix ENG-123",
      state: "closed",
      html_url: "https://example.com",
      merged_at: "2024-01-01T00:00:00Z",
      merge_commit_sha: "abc123",
      head: { sha: "abc123" },
      base: { repo: { full_name: "owner/repo" } },
    });
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "fix", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const changes = buildChanges({
      pullRequests: [pr],
      commits: [commit],
      checks: [],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    expect(changes.length).toBe(1);
    expect(changes[0]?.commits[0]?.sha).toBe("abc123");
    expect(changes[0]?.pullRequests[0]?.number).toBe(1);
    expect(changes[0]?.relationships.some((r) => r.provenance.rule === JOIN_RULES.PR_COMMIT)).toBe(true);
  });

  it("Check head SHA ↔ Commit SHA", () => {
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const check = normalizeCheck({
      id: 1,
      name: "CI",
      status: "completed",
      conclusion: "success",
      head_sha: "abc123",
      html_url: "https://example.com",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T01:00:00Z",
    });
    const changes = buildChanges({
      pullRequests: [],
      commits: [commit],
      checks: [check],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    expect(changes[0]?.checks[0]?.commitSha).toBe("abc123");
    expect(changes[0]?.relationships.some((r) => r.provenance.rule === JOIN_RULES.CHECK_COMMIT)).toBe(true);
  });

  it("Deployment commit SHA ↔ Commit SHA", () => {
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const dep = normalizeDeployment({
      id: "dpl_1",
      url: "example.vercel.app",
      state: "READY",
      target: "production",
      source: "git",
      createdAt: Date.now(),
      meta: { githubCommitSha: "abc123" },
    });
    const changes = buildChanges({
      pullRequests: [],
      commits: [commit],
      checks: [],
      deployments: [dep],
      productionEffects: [],
      intents: [],
    });
    expect(changes[0]?.deployments[0]?.commitSha).toBe("abc123");
    expect(changes[0]?.relationships.some((r) => r.provenance.rule === JOIN_RULES.DEPLOYMENT_COMMIT)).toBe(true);
  });

  it("Linear intent via PR title", () => {
    const pr = normalizePr("owner/repo", {
      number: 1,
      title: "Fix ENG-123 bug",
      state: "closed",
      html_url: "https://example.com",
      merged_at: "2024-01-01T00:00:00Z",
      merge_commit_sha: "abc123",
      head: { sha: "abc123" },
      base: { repo: { full_name: "owner/repo" } },
    });
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "fix", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const intent = {
      id: "intent_linear_ENG-123",
      source: "linear" as const,
      externalId: "ENG-123",
      title: "Fix bug",
      description: null,
      url: "https://linear.app/ENG-123",
    };
    const changes = buildChanges({
      pullRequests: [pr],
      commits: [commit],
      checks: [],
      deployments: [],
      productionEffects: [],
      intents: [intent],
    });
    expect(changes[0]?.intent?.externalId).toBe("ENG-123");
    expect(changes[0]?.relationships.some((r) => r.type === "implements")).toBe(true);
  });

  it("Sentry release SHA ↔ Commit SHA", () => {
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123def456abc123def456abc123def456abcd",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const eff = {
      id: "effect_sentry_abc123def456abc123def456abc123def456abcd",
      provider: "sentry" as const,
      type: "release" as const,
      externalId: "abc123def456abc123def456abc123def456abcd",
      title: "abc",
      firstSeen: "2024-01-01T00:00:00Z",
      lastSeen: "2024-01-02T00:00:00Z",
      url: null,
    };
    const changes = buildChanges({
      pullRequests: [],
      commits: [commit],
      checks: [],
      deployments: [],
      productionEffects: [eff],
      intents: [],
    });
    expect(changes[0]?.productionEffects[0]?.externalId).toBe("abc123def456abc123def456abc123def456abcd");
  });

  it("does not join on close timestamps", () => {
    const commit1 = normalizeCommit("owner/repo", {
      sha: "abc111",
      commit: { message: "a", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const commit2 = normalizeCommit("owner/repo", {
      sha: "abc222",
      commit: { message: "b", author: { date: "2024-01-01T00:00:01Z" } },
    });
    const dep = normalizeDeployment({
      id: "dpl_1",
      url: "example.vercel.app",
      state: "READY",
      target: "production",
      source: "git",
      createdAt: Date.now(),
      meta: { githubCommitSha: "abc111" },
    });
    const changes = buildChanges({
      pullRequests: [],
      commits: [commit1, commit2],
      checks: [],
      deployments: [dep],
      productionEffects: [],
      intents: [],
    });
    // dep should only link to abc111, not abc222 even though timestamps close
    const ch1 = changes.find((c) => c.commits[0]?.sha === "abc111");
    const ch2 = changes.find((c) => c.commits[0]?.sha === "abc222");
    expect(ch1?.deployments.length).toBe(1);
    expect(ch2?.deployments.length).toBe(0);
  });

  it("no false join for different SHAs", () => {
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const check = normalizeCheck({
      id: 2,
      name: "CI",
      status: "completed",
      conclusion: "success",
      head_sha: "differentSha",
      html_url: "https://example.com",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T01:00:00Z",
    });
    const changes = buildChanges({
      pullRequests: [],
      commits: [commit],
      checks: [check],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    // check should not be linked to commit abc123
    expect(changes[0]?.checks.length).toBe(0);
  });

  it("unresolved relationships remain unknown", () => {
    const pr = normalizePr("owner/repo", {
      number: 99,
      title: "No link",
      state: "open",
      html_url: "https://example.com",
      merged_at: null,
      merge_commit_sha: null,
      head: { sha: "sha99" },
      base: { repo: { full_name: "owner/repo" } },
    });
    const changes = buildChanges({
      pullRequests: [pr],
      commits: [],
      checks: [],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    expect(changes[0]?.commits.length).toBe(0);
    expect(changes[0]?.intent).toBeNull();
    expect(changes[0]?.deployments.length).toBe(0);
  });

  it("provenance recorded for every relationship", () => {
    const pr = normalizePr("owner/repo", {
      number: 1,
      title: "t",
      state: "closed",
      html_url: "https://example.com",
      merged_at: "2024-01-01T00:00:00Z",
      merge_commit_sha: "abc123",
      head: { sha: "abc123" },
      base: { repo: { full_name: "owner/repo" } },
    });
    const commit = normalizeCommit("owner/repo", {
      sha: "abc123",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const changes = buildChanges({
      pullRequests: [pr],
      commits: [commit],
      checks: [],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    for (const rel of changes[0]?.relationships ?? []) {
      expect(rel.provenance.rule).toBeDefined();
      expect(rel.provenance.sourceIds.length).toBeGreaterThan(0);
      expect(rel.provenance.constructedAt).toBeDefined();
    }
  });
});

describe("Storage and API", () => {
  it("saves and loads canonical change", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "change-test-"));
    const change: Change = {
      id: "chg_abc123",
      intent: null,
      pullRequests: [],
      commits: [
        {
          id: "commit_abc123",
          sha: "abc123",
          repository: "owner/repo",
          message: "msg",
          authoredAt: "2024-01-01T00:00:00Z",
        },
      ],
      checks: [],
      artifacts: [],
      deployments: [],
      productionEffects: [],
      relationships: [],
      provenance: { sources: ["commit_abc123"], constructedAt: new Date().toISOString(), schemaVersion: "1" },
    };
    const { saveCanonical, loadChange, listChanges } = await import("../src/store/storage.js");
    await saveCanonical(tmp, change);
    const loaded = await loadChange(tmp, "chg_abc123");
    expect(loaded?.id).toBe("chg_abc123");
    const listed = await listChanges(tmp);
    expect(listed.length).toBe(1);
    const { createChangeApi } = await import("../src/api/changes.js");
    const api = createChangeApi(tmp);
    expect((await api.get("chg_abc123"))?.id).toBe("chg_abc123");
    expect((await api.findByCommit("abc123"))?.id).toBe("chg_abc123");
    expect(await api.findByCommit("nonexistent")).toBeNull();
    await rm(tmp, { recursive: true, force: true });
  });

  it("trace lookup finds by commit, PR, deployment, intent", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "change-trace-"));
    const pr = normalizePr("owner/repo", {
      number: 42,
      title: "Fix",
      state: "closed",
      html_url: "https://example.com",
      merged_at: "2024-01-01T00:00:00Z",
      merge_commit_sha: "abc1234",
      head: { sha: "abc1234" },
      base: { repo: { full_name: "owner/repo" } },
    });
    const commit = normalizeCommit("owner/repo", {
      sha: "abc1234",
      commit: { message: "msg", author: { date: "2024-01-01T00:00:00Z" } },
    });
    const changes = buildChanges({
      pullRequests: [pr],
      commits: [commit],
      checks: [],
      deployments: [],
      productionEffects: [],
      intents: [],
    });
    const { saveCanonical } = await import("../src/store/storage.js");
    for (const ch of changes) await saveCanonical(tmp, ch);
    const { createChangeApi } = await import("../src/api/changes.js");
    const api = createChangeApi(tmp);
    expect((await api.trace("abc1234"))?.id).toBeDefined();
    expect((await api.trace("42"))?.id).toBeDefined();
    expect((await api.trace("owner/repo#42"))?.id).toBeDefined();
    expect(await api.trace("nonexistent-sha-xyz")).toBeNull();
    await rm(tmp, { recursive: true, force: true });
  });

  it("stable JSON output", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "change-json-"));
    const change: Change = {
      id: "chg_test",
      intent: null,
      pullRequests: [],
      commits: [],
      checks: [],
      artifacts: [],
      deployments: [],
      productionEffects: [],
      relationships: [],
      provenance: { sources: [], constructedAt: "2024-01-01T00:00:00Z", schemaVersion: "1" },
    };
    const { saveCanonical, loadChange } = await import("../src/store/storage.js");
    await saveCanonical(tmp, change);
    const loaded1 = await loadChange(tmp, "chg_test");
    const loaded2 = await loadChange(tmp, "chg_test");
    expect(JSON.stringify(loaded1)).toBe(JSON.stringify(loaded2));
    await rm(tmp, { recursive: true, force: true });
  });
});
