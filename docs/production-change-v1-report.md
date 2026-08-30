# ProductionChange V1 Validation — Real Container Runtime Stress Test — Final Report

## Executive Summary
Stress test of `ProductionChange` against a real container/runtime where source SHA, artifact digest, and previous/current ordering are less conveniently exposed than Vercel was **blocked**: no authorized Kubernetes or ECS real dataset is accessible in this environment (`kubectl`/`aws`/`docker` not found, no cluster). The existing Vercel validation (15 real production deployments, 100% source linkage, 93% previous, 0 branching) remains the only real runtime evidence. Per task instructions, must report `PRODUCTION_CHANGE_BLOCKED` rather than claim validation from fixtures.

## Branch / HEAD / Working-Tree Status
- Branch: `main`
- HEAD: `acf275b` (`ProductionChange V0: narrow runtime identity primitive`, 15 Vercel prod, 100% source, 93% previous)
- Working tree clean except `docs/production-change-v1-stress-audit.md` (new) and `.rapture/production` (ignored, 15 Vercel canonical)
- No code changes to `ProductionChange` schema for this stress test (per task: do not modify unless cross-provider flaw proven; none proven because no real K8s/ECS data).

## Runtime Provider Selected and Why
**Preferred order:** Kubernetes → ECS. **Selected:** Neither — no real authorized runtime available. `vercel` CLI authenticated (`wiramahendraa`, 20 `invite` production deployments) but is the already-validated provider. `kubectl`, `aws`, `docker`, `kind`, `minikube`, `colima` not found; `~/.kube` only `cache`; `env` shows no `AWS`/`K8S` credentials. Per `selection_rule`, use whichever real runtime is available first — none is. Fallback: `PRODUCTION_CHANGE_BLOCKED`.

## Real Dataset Description
- **Vercel (already validated, real):** 15 sequential `invite` production deployments (`wiramahendraa-5470s-projects/invite`, `target: production`, `state: READY`, `createdAt` 2026-08-23T01:50–09:32, `meta.githubCommitSha` 7-40 hex, `githubCommitRepo: invite`, `branch: main`). 2 duplicates due to redeploy of same SHA (`b0e8cfe`, `2a284b9` twice) — correctly represented as distinct `ProductionChange` events with same `commitSha` but different `externalId` (hashed `url`), `previousId` points to prior event, `previousSha` may equal `resultingSha` for redeploy (tested).
- **Kubernetes (attempted):** Inspected `Deployment`/`ReplicaSet`/`Pod`/`image`/`imageID`/`labels`/`annotations` via fixtures only (`k8s:production/api` with `image: myapp:abc123def456`, `imageID: sha256:...`). No real cluster, so 0 real events.
- **Cloudflare (attempted):** `wrangler` not found, 0 real.
- **Total real container/runtime events for this V1 stress:** 0 new beyond Vercel 15 already counted. Target was 15-20 real container events, stronger 20+ — not met.

## Vercel Assumptions Identified Before Implementation
From `docs/production-change-v1-stress-audit.md:1`:
- Assumed Vercel's `meta.githubCommitSha` always present — true for 15/15.
- Assumed `projectId`+`target` gives stable `serviceId`/`environment` — true (`vercel:invite`|`production`).
- Assumed `createdAt`/`ready` as `startedAt`/`completedAt` for ordering — true.
- Assumed `artifactDigest` null for bundles — true (0/15).
- Assumed `ready` filter for previous — true.
- **Fragile fields for containers:** `serviceId` as `k8s:namespace/name` (namespace may be `default` not `production`), `environment` as `namespace`, `commitSha` from `image` tag (mutable) vs `imageID` digest (immutable) vs `image` label `org.opencontainers.image.revision`, `artifactDigest` from `imageID`, timestamps from `creationTimestamp` vs `lastTransitionTime`.

## Provider-Native Identity Model
- **Vercel:** `id: <url>`, `meta.githubCommitSha`, `meta.githubCommitRepo`, `target`, `state`, `createdAt`/`ready`, `projectId`.
- **Kubernetes (fixture):** `metadata.uid`, `metadata.name`/`namespace`, `spec.template.spec.containers[0].image`/`imageID`, `status.conditions[].lastTransitionTime`, `labels`/`annotations`.
- **Cloudflare (fixture):** `id`, `environment`, `source.repo/branch/commit`, `project_name`.

## DeploymentRecord Mapping
- **Vercel → `DeploymentRecord`:** `externalId: id (url)`, `serviceId: vercel:<projectId>`, `environment: target`, `commitSha: meta.githubCommitSha` (exact hex), `branch: meta.githubCommitRef`, `repository: meta.githubCommitRepo`, `artifactDigest: null`, `status: READY→ready`.
- **Kubernetes → `DeploymentRecord`:** `externalId: metadata.uid`, `serviceId: k8s:<namespace>/<name>`, `environment: namespace`, `commitSha: image tag SHA (if 7-40 hex) or null`, `artifactDigest: imageID sha256`, `status: Available True→ready`.
- **Cloudflare → `DeploymentRecord`:** `externalId: id`, `serviceId: cloudflare:<project_name>`, `environment: environment`, `commitSha: source.commit` (exact hex), `branch: source.branch`.

All keep `raw` outside canonical.

## Canonical Schema Changes, If Any, and Justification
**None.** Existing `ProductionChange` 22-field schema (`service`, `environment`, `source`, `artifact`, `deployment`, `transition`, `runtimeObservations`, `provenance`) already represents Vercel 15/15 without additions. No cross-provider concept missing was proven because no real K8s/ECS data to test. Per task: do not modify unless cross-provider flaw proven — none.

## Current-State Resolution Results
- **Vercel `invite` production:** `production.current("vercel:invite","production")` returns latest `ced2dfc...` (`2026-08-23T09:32:11.659Z`) correctly. Tested via `pnpm rapture production current invite --env production --json` — 1/1, single `ready` filter, ordered by `completedAt` descending.
- **Kubernetes/Cloudflare fixtures:** 1/1 each, same function without branching (consumer test).

## Previous-State Resolution Results
- **Vercel `invite` production:** 14/15 have deterministic previous (first has `null`), ordered by `completedAt` asc, only `ready`. Tested 10+ transitions (e.g., `ced2dfc`→`0703b8c`, `0703b8c`→`1e4d105`, ...). For redeploy same artifact `b0e8cfe` twice, `previousId` points to prior event (distinct `id` hashed from `url`), `previousSha` equals `resultingSha` for second `b0e8cfe` (correct: event distinct, revision same).

## Source Revision Coverage
- **Vercel:** 15/15 (100%) via `meta.githubCommitSha` exact hex.
- **Kubernetes fixture:** 1/1 via `image` tag `abc123def456` (if explicit, deterministic)
- **Cloudflare fixture:** 1/1 via `source.commit`

Overall real: 15/15 Vercel (100%) — but only 1 provider real.

## Artifact Digest Coverage
- **Vercel:** 0/15 (bundle, `artifact.type: deployment_artifact`, `digest: null`) — expected.
- **Kubernetes fixture:** 1/1 `sha256:...` via `imageID`
- **Cloudflare:** 0/1 (bundle)

Overall real: 0/15 Vercel, 1/1 K8s fixture — separate from source revision, correctly not conflated.

## Redeploy/Rollback Findings
- **Redeploy same artifact:** Vercel has 2 pairs with same `commitSha` (`b0e8cfe` and `2a284b9` each twice) — represented as distinct `ProductionChange` events with same `commitSha` but different `externalId`/`id` and `completedAt`, `previousId` points to prior event, `previousSha` may equal `resultingSha` — correct per `transition_semantics` (event identity separate from revision identity).
- **Rollback:** Not observed in dataset (no `commitSha` revert to older). Would be represented similarly: new event with older `commitSha`, `previousId` points to immediate prior event.

## Runtime Observation Findings
- **Vercel real:** 0/15 linked (Sentry releases for `invite` not using SHA, no `SENTRY_AUTH_TOKEN` for this repo) — correctly 0, no heuristic.
- **Fixture with explicit `sentry.release.version_sha`:** 1/1 linked deterministically (test `runtime observation deterministic link`).

Optional, not blocking.

## Manual Validation Results
- Inspected 10 canonical `invite` production records vs Vercel native `vercel inspect <url> --json` and `gh api repos/.../commits/<sha>`: all `service`, `environment`, `commitSha`, `previous` matched. Verified current (latest `ced2dfc`) and 5 sequential previous transitions manually.

## Provider-Independent Consumer Branch Count
- 5 functions (`currentVersion`, `previousVersion`, `artifactForChange`, `timeRangeChanges`, `observationsForChange`) run against Vercel, K8s, Cloudflare `ProductionChange` — **0 branches** (`if (provider==="vercel")` count 0). Test `provider-independent consumer` passes for all 3 providers.

## Null Density Comparison: Vercel vs Real Container Runtime
- **Vercel (15 real):** `source.repository` 0% null, `source.commitSha` 0% null, `artifact.digest` 100% null (expected), `transition.previous` 7% null (1/15 first), `runtimeObservations` 100% empty, overall ~25% null.
- **Kubernetes/Cloudflare (fixtures, not real):** `source.repository` 100% null for K8s (no repo in image), `artifact.digest` 0% null for K8s, ~20% overall. Real container runtime null density cannot be measured without real data.

No evidence of sparse bag for Vercel; K8s/Cloudflare would be sparse if `commitSha` not explicitly emitted.

## Schema Leakage Findings
- Requested canonical fields all expressible: `service`, `environment`, `commitSha`, `branch`, `repository`, `artifactDigest`, `deployment` status/timestamps, `previous` — no provider-specific field required.
- Tempting to add: Vercel `lambdaRuntimeStats`, `branchAlias`, K8s `observedGeneration` — rejected, kept in `raw`.
- Leakage test `provider-specific fields do not leak` (`pc["meta"]` undefined) passes.

## Raw-Provider vs Canonical Lookup Counts
- **Current:** Without Rapture: `vercel ls --json` (1) + `vercel inspect <url> --json` (1) + `gh api repos/.../commits/<sha>` (1) = 3. With `production.current("vercel:invite","production")` = 1. **3→1**.
- **History (15):** Without: 15 `vercel inspect` + 15 `gh api` = 30. With `history("vercel:invite","production")` = 1. **30→1**.
- **Trace by deployment:** Without: `vercel ls --json` + filter `meta.githubCommitSha == sha` (1). With `trace(sha)` = 1. Similar.

## Where ProductionChange Generalized Cleanly
- `service`+`environment` + `commitSha` via explicit metadata (`meta.githubCommitSha` vs `image` tag) maps to same `DeploymentRecord` fields.
- `current`/`previous`/`history`/`trace` consumer functions work unchanged for Vercel and fixture K8s/Cloudflare.
- Ordering by `completedAt` and `ready` filter works for Vercel; K8s fixture uses `Available` similarly.

## Where It Leaked
- No leak proven on real container data because none accessible. Fixture K8s `environment` as `namespace` (`production` vs `default`) is heuristic and would leak if namespace is not `production`. This is the expected stress point but not validated on real.

## Does ProductionChange Remain a Useful Provider-Independent Primitive?
**For Vercel alone, yes** (15/15 clean, 1 vs 3 lookups). **For container runtimes, unknown** — no real data to prove. The abstraction has not been shown to leak, but also not proven to generalize beyond Vercel's convenient `meta.githubCommitSha`.

## Assessment Against CONTINUE/RETHINK/KILL/BLOCKED Criteria

**Continue requires:** ≥80% fit same schema without provider additions — **True for Vercel (15/15, 100%)**, but only 1 real provider, so cross-provider not proven.
- service/environment ≥90% — **True** (15/15 Vercel)
- current ≥90% — **True** (1/1 Vercel)
- previous ≥80% — **True** (14/15, 93%)
- source OR artifact ≥80% — **True** (15/15 source, 0/15 artifact but that's provider-appropriate)
- consumer branching 0 — **True** (0)
- lookup reduction — **True** (3→1, 30→1)

But **at least 2 real runtime providers** is an acceptance criterion, and we have only 1 (Vercel). The task explicitly says if neither Kubernetes nor ECS real data is accessible, report `PRODUCTION_CHANGE_BLOCKED` rather than claiming validation from fixtures.

## If RETHINK, Identify Exactly One Narrower Primitive
If we were to rethink, the narrower primitive justified by Vercel evidence is **`DeploymentIdentity`** — `serviceId`, `environment`, `commitSha`, `previousCommitSha` — which is the core that worked 100%. `ProductionChange` without `artifact` and `runtimeObservations` would be even leaner, but `ProductionChange` as defined is already minimal and not sparse for Vercel.

## Final Decision
**PRODUCTION_CHANGE_BLOCKED**

Reason: No authorized real Kubernetes or ECS dataset is accessible in this environment (`kubectl`/`aws`/`docker` not found, no cluster). Vercel alone validates the core (15 real production changes, 100% source linkage, 93% previous, 0 branching), but cross-provider validation requires at least 2 real runtime providers per acceptance criteria. Per task instructions, do not fake real validation with fixtures — report blocked. The abstraction shows no leakage on Vercel and handles redeploy correctly, but container-runtime generalisation remains unproven.

