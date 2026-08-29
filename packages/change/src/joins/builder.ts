import { SCHEMA_VERSION } from "../schema/version.js";
import type { Change, Commit, PullRequest, Check, Deployment, ProductionEffect, Intent, Relationship } from "../schema/change.js";
import { changeIdFromSha, changeIdFromPr } from "../schema/change.js";
import { JOIN_RULES, provenance } from "./rules.js";
import { extractLinearId } from "../adapters/linear.js";

import type { NormalizedRecords } from "../adapters/contracts.js";

export function buildChanges(store: NormalizedRecords): readonly Change[] {
  // Index by commit SHA
  const commitsBySha = new Map<string, Commit>();
  for (const c of store.commits ?? []) commitsBySha.set(c.sha, c);

  // Index PRs by mergeCommitSha
  const prsByMergeSha = new Map<string, PullRequest>();
  for (const pr of store.pullRequests ?? []) {
    if (pr.mergeCommitSha) prsByMergeSha.set(pr.mergeCommitSha, pr);
  }

  // Index checks by commitSha
  const checksBySha = new Map<string, Check[]>();
  for (const ch of store.checks ?? []) {
    const arr = checksBySha.get(ch.commitSha) ?? [];
    arr.push(ch);
    checksBySha.set(ch.commitSha, arr);
  }

  // Index deployments by commitSha
  const depsBySha = new Map<string, Deployment[]>();
  for (const d of store.deployments ?? []) {
    if (d.commitSha) {
      const arr = depsBySha.get(d.commitSha) ?? [];
      arr.push(d);
      depsBySha.set(d.commitSha, arr);
    }
  }

  // Index production effects by release version (if version looks like SHA)
  const effectsBySha = new Map<string, ProductionEffect[]>();
  for (const eff of store.productionEffects ?? []) {
    if (eff.type === "release" && /^[0-9a-f]{7,40}$/i.test(eff.externalId)) {
      const arr = effectsBySha.get(eff.externalId) ?? [];
      arr.push(eff);
      effectsBySha.set(eff.externalId, arr);
      // also short sha
      if (eff.externalId.length >= 7) {
        const short = eff.externalId.slice(0, 7);
        const arr2 = effectsBySha.get(short) ?? [];
        // avoid duplicate
        if (!arr2.includes(eff)) {
          arr2.push(eff);
          effectsBySha.set(short, arr2);
        }
      }
    }
  }

  // Index intents by externalId
  const intentsById = new Map<string, Intent>();
  for (const intent of store.intents ?? []) {
    if (intent.externalId) intentsById.set(intent.externalId, intent);
  }

  // Build changes per commit
  const changes: Change[] = [];
  const allShas = new Set<string>([...commitsBySha.keys()]);

  // Also include PR merge SHAs that may not have a commit object (still create change)
  for (const pr of store.pullRequests ?? []) {
    if (pr.mergeCommitSha && !allShas.has(pr.mergeCommitSha)) {
      allShas.add(pr.mergeCommitSha);
    }
  }

  for (const sha of allShas) {
    const commit = commitsBySha.get(sha);
    const pr = prsByMergeSha.get(sha) ?? null;
    const checks = checksBySha.get(sha) ?? [];
    const deployments = depsBySha.get(sha) ?? [];
    const effects = effectsBySha.get(sha) ?? [];

    // Find intent via Linear linkage
    let intent: Intent | null = null;
    let intentProvenance: ReturnType<typeof provenance> | null = null;
    if (pr) {
      // Branch name is not stored in PR object currently, but we can try title/body
      const titleId = extractLinearId(pr.title);
      if (titleId && intentsById.has(titleId)) {
        intent = intentsById.get(titleId)!;
        intentProvenance = provenance(JOIN_RULES.LINEAR_PR_TITLE, [pr.id, intent.id]);
      }
      // Body not stored in PR, but we could store it; for V0 we only check title
      // Also check PR number linkage if Linear issue id matches PR number? No.
    }

    const relationships: Relationship[] = [];
    const sources: string[] = [];

    const changeId = pr ? changeIdFromPr(pr.repository, pr.number) : changeIdFromSha(sha);

    if (commit) sources.push(commit.id);
    if (pr) {
      sources.push(pr.id);
      relationships.push({
        from: changeId,
        to: pr.id,
        type: "contains",
        provenance: provenance(JOIN_RULES.PR_COMMIT, [pr.id, commit?.id ?? sha]),
      });
      if (commit) {
        relationships.push({
          from: pr.id,
          to: commit.id,
          type: "contains",
          provenance: provenance(JOIN_RULES.PR_COMMIT, [pr.id, commit.id]),
        });
      }
    }
    if (commit && checks.length > 0) {
      for (const ch of checks) {
        sources.push(ch.id);
        relationships.push({
          from: changeId,
          to: ch.id,
          type: "validated_by",
          provenance: provenance(JOIN_RULES.CHECK_COMMIT, [ch.id, commit.id]),
        });
      }
    }
    for (const dep of deployments) {
      sources.push(dep.id);
      relationships.push({
        from: changeId,
        to: dep.id,
        type: "deployed_as",
        provenance: provenance(JOIN_RULES.DEPLOYMENT_COMMIT, [dep.id, sha]),
      });
      // Also link deployment to commit
      if (commit) {
        relationships.push({
          from: dep.id,
          to: commit.id,
          type: "contains",
          provenance: provenance(JOIN_RULES.DEPLOYMENT_COMMIT, [dep.id, commit.id]),
        });
      }
    }
    for (const eff of effects) {
      sources.push(eff.id);
      relationships.push({
        from: changeId,
        to: eff.id,
        type: "observed_by",
        provenance: provenance(JOIN_RULES.SENTRY_RELEASE_COMMIT, [eff.id, sha]),
      });
    }
    if (intent && intentProvenance) {
      sources.push(intent.id);
      relationships.push({
        from: intent.id,
        to: changeId,
        type: "implements",
        provenance: intentProvenance,
      });
      relationships.push({
        from: changeId,
        to: intent.id,
        type: "linked_to",
        provenance: intentProvenance,
      });
    }

    // Also add commit to change
    if (commit) {
      relationships.push({
        from: changeId,
        to: commit.id,
        type: "contains",
        provenance: provenance(JOIN_RULES.PR_COMMIT, [changeId, commit.id]),
      });
    }

    const change: Change = {
      id: changeId,
      intent,
      pullRequests: pr ? [pr] : [],
      commits: commit ? [commit] : [],
      checks,
      artifacts: [],
      deployments,
      productionEffects: effects,
      relationships,
      provenance: {
        sources,
        constructedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      },
    };
    // Only emit changes that have at least one commit or PR
    if (change.commits.length > 0 || change.pullRequests.length > 0) {
      changes.push(change);
    }
  }

  // Also handle PRs without merge commit (unmerged) — create change for them
  for (const pr of store.pullRequests ?? []) {
    if (!pr.mergeCommitSha) {
      const changeId = changeIdFromPr(pr.repository, pr.number);
      if (changes.some((c) => c.id === changeId)) continue;
      // Try to find intent
      let intent: Intent | null = null;
      const titleId = extractLinearId(pr.title);
      if (titleId && intentsById.has(titleId)) intent = intentsById.get(titleId)!;
      const relationships: Relationship[] = [];
      if (intent) {
        const prov = provenance(JOIN_RULES.LINEAR_PR_TITLE, [pr.id, intent.id]);
        relationships.push({ from: intent.id, to: changeId, type: "implements", provenance: prov });
        relationships.push({ from: changeId, to: intent.id, type: "linked_to", provenance: prov });
      }
      changes.push({
        id: changeId,
        intent,
        pullRequests: [pr],
        commits: [],
        checks: [],
        artifacts: [],
        deployments: [],
        productionEffects: [],
        relationships,
        provenance: {
          sources: [pr.id, ...(intent ? [intent.id] : [])],
          constructedAt: new Date().toISOString(),
          schemaVersion: SCHEMA_VERSION,
        },
      });
    }
  }

  return changes;
}
