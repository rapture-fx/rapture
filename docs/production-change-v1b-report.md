# ProductionChange V1B — Real Kubernetes Validation — Final Report

## Executive Summary
Attempted to stress-test `ProductionChange` against a real container runtime (Kubernetes preferred, ECS fallback) as required. **Blocked:** no authorized real Kubernetes or ECS cluster is accessible, and a disposable local cluster could not be created safely in this environment within the task window. Vercel 15 real production deployments remain the only real runtime evidence (100% source linkage, 93% previous). Per task `blocked_rule`, must report `PRODUCTION_CHANGE_BLOCKED` rather than faking with fixtures.

## Branch / HEAD / Working-Tree Status
- Branch: `main`
- HEAD: `acf275b` (ProductionChange V0) → `533afd8` (V1 stress audit, BLOCKED) → current `a246d22` (Phase 0D) plus new `production-change` package and `docs/production-change-v1-stress-audit.md`/`v1-report.md`
- Working tree: clean except new audit/report and `packages/production-change` (now committed at `acf275b` and updated for V1B attempt)
- No code changes to `ProductionChange` schema for this V1B attempt (per `canonical_schema_rule`: do not modify before encountering concrete real-data incompatibility — none encountered because no real K8s data).

## Cluster/Runtime Used and Versions
- **Attempted:** `kind` 0.33.0 via `brew install kind` (Homebrew 6.0.20, macOS 13). `brew` started at 09:15, still running at 09:20 (portable-ruby building `go` 1.27.0, locked `/usr/local/Cellar/kind`). `kind` still not found after 5 minutes.
- **Checked:** `kubectl` not found, `~/.kube` only `cache`, `docker` not found, `podman`/`kind`/`minikube`/`colima` not found, `aws` not found, `env` shows no `AWS`/`K8S` credentials, `/var/run/docker.sock` exists but no client.
- **Result:** No real cluster created. `vercel` CLI still available (`58.9.5`, `wiramahendraa`, 20 `invite` deployments), but Vercel is already validated and does not count as the required second runtime for this V1B (needs K8s or ECS).

## Why This Runtime Qualifies as Real Validation
- A locally running real Kubernetes cluster (e.g., `kind`, `k3d`, `minikube` with real `Deployment`/`ReplicaSet`/`Pod`/`imageID`) counts as real per task, because it uses actual Kubernetes API objects, scheduling, and rollout semantics. Fixtures alone do not count.
- Since no cluster could be created, **no new real validation was achieved** for this V1B.

## Experiment Service Architecture
- **Intended:** Minimal `rapture-production-validation` Node.js service with `/health` and `/version` (`{service, version, commitSha, buildId}`), TypeScript, `Dockerfile` with `org.opencontainers.image.revision` label for commit provenance.
- **Not deployed** due to blocked cluster.

## Container Provenance Mechanism
- **Intended:** Build `docker` image per revision with `docker build --label org.opencontainers.image.revision=$SHA` and capture `imageID` `sha256:` digest from `docker images --digests` or `kubectl get pods -o json` `containerStatuses[].imageID`. Do not rely on mutable tag `myapp:$SHA` alone.
- **Not executed** due to blocked cluster/docker.

## Deployment Sequence Executed
- **Intended:** 15 events (8 normal, 2 same-artifact redeploy, 2 rollback, 2 rapid sequential, 1 failed rollout) — same as `docs/production-change-v1-stress-audit.md` plan.
- **Actual:** 0 new real Kubernetes deployments. Vercel 15 already exists but not new for this V1B.

## Real Kubernetes Dataset Summary
- **Real deployment attempts:** 0 (blocked)
- **Successful production events:** 0
- **Failed rollouts:** 0
- **Canonical ProductionChange records from real K8s:** 0

## Provider-Native Kubernetes Identity Model
- From fixtures (not real): `metadata.uid`, `metadata.name`/`namespace`, `spec.template.spec.containers[0].image`/`imageID`, `status.conditions[]`, `labels`/`annotations`, `generation`/`observedGeneration`, `creationTimestamp`.
- **Expected real:** Same, plus `rollout revision` annotation `deployment.kubernetes.io/revision`.

## DeploymentRecord Mapping
- Already implemented in `packages/production-change/src/adapters/kubernetes.ts:1`:
  - `serviceId: k8s:<namespace>/<name>`
  - `environment: namespace` (with `production` heuristic)
  - `commitSha: image tag SHA (if 7-40 hex) or null`
  - `artifactDigest: imageID sha256`
  - `status: Available True → ready`
- No change needed before real data; would be validated against real `kubectl get deployment -o json` payloads.

## Canonical Schema Changes, If Any
**None.** Existing `ProductionChange` 22-field schema already handles Vercel 15/15 without additions, and the expected K8s mapping (above) fits it. No cross-provider concept missing proven, per `canonical_schema_rule`.

## Service/Environment Identity Results
- **Vercel (real, prior):** 15/15 `serviceId` (`vercel:invite`), 15/15 `environment` (`production`) — 100%.
- **Kubernetes (real, this V1B):** 0/0 — not measured.

## Source Revision Coverage
- **Vercel:** 15/15 (100%) via `meta.githubCommitSha` (verified).
- **Kubernetes (expected):** Would be 0-100% depending on whether pipeline emits `org.opencontainers.image.revision` label — not measured.

## Artifact Digest Coverage
- **Vercel:** 0/15 (bundle, `artifact.type: deployment_artifact`) — expected.
- **Kubernetes (expected):** 1/1 via `imageID` if `imageID` present.

## Current-State Accuracy
- **Vercel:** 15/15 `production.current` returns latest `ced2dfc...` correctly (tested).
- **Kubernetes:** Not tested (0).

## Previous-State Accuracy
- **Vercel:** 14/15 (93%) with previous, correctly handling redeploy same SHA (distinct `id` hashed from `externalId` `url`, `previousCommitSha` may equal `resultingCommitSha`).
- **Kubernetes:** Not tested.

## Same-Artifact Redeploy Findings
- **Vercel:** 2 pairs with same `commitSha` (`b0e8cfe` twice, `2a284b9` twice) correctly represented as distinct `ProductionChange` events with same `commitSha` but different `externalId`/`id` and `previousId` chain — validated in prior report.
- **Kubernetes:** Not tested.

## Rollback Findings
- Not observed in Vercel dataset (no rollback). Would be new event with older `commitSha`, `previousId` points to immediate prior.

## Failed Rollout Findings
- **Vercel:** 0 failed (all 15 `ready`). Not tested.
- **Kubernetes:** Would test by deploying `image: myapp:invalid` (non-existent digest) and verifying it never becomes `current` — not executed due to blocked.

## Rapid Deployment Ordering Findings
- **Vercel:** 15 sequential, ordered by `completedAt` (`ready` filter) — validated, no timestamp-only join.

## Manual Validation Results
- **Vercel:** 10 canonical records vs `vercel inspect --json` and `gh api repos/.../commits/<sha>` — all `service`, `environment`, `commitSha`, `previous` matched (prior report).
- **Kubernetes:** 0 real records to validate.

## Provider-Independent Consumer Branch Count
- **Existing:** 0 branches for `currentVersion`, `previousVersion`, `history`, `trace` across Vercel/K8s/Cloudflare fixtures (test `provider-independent consumer` passes).
- **New real K8s:** Not tested, but expected 0 as mapping stays in adapter.

## Null Density: Kubernetes vs Vercel
- **Vercel (15 real):** `source.repository` 0% null, `source.commitSha` 0% null, `artifact.digest` 100% null, `transition.previous` 7% null, `runtimeObservations` 100% empty, overall ~25% null.
- **Kubernetes (real):** Not measured (0 real). Fixture: `source.repository` 100% null, `artifact.digest` 0% null, overall ~20% — but fixture not real.

## Schema Leakage Findings
- No new provider-specific fields required for Vercel. K8s would need `observedGeneration` not in canonical, but it's kept in `raw` and not added to canonical (correctly).

## Native Lookup vs Canonical Lookup Counts
- **Vercel current:** Without Rapture: `vercel ls --json` (1) + `vercel inspect <url> --json` (1) + `gh api repos/.../commits/<sha>` (1) = 3. With `production.current("vercel:invite","production")` = 1. **3→1**.
- **Vercel history (15):** Without: 15 `vercel inspect` + 15 `gh api` = 30. With `history` = 1. **30→1**.
- **Kubernetes (expected):** Without: `kubectl get deployments -o json` (1) + `kubectl get pods -o json` (1) + `kubectl get rs -o json` (1) = 3. With `current` = 1. **3→1**.
- **Not measured for K8s real due to blocked.**

## Where ProductionChange Generalized Cleanly
- For Vercel, already proven: `service`+`environment`+`commitSha`+`previous` via `completedAt` and `ready` filter.

## Where It Failed or Leaked
- No failure proven on real K8s — blocked before test. The expected leak point remains `environment` as `namespace` (`default` vs `production`) and `commitSha` from `image` tag vs `imageID` label.

## Assessment Against CONTINUE/RETHINK/KILL/BLOCKED Thresholds
**Continue requires:** 15 real K8s attempts, ≥80% fit same schema without provider additions, service/env ≥90%, current ≥90%, previous ≥80%, source OR artifact ≥80%, consumer 0 branches, rollback/redeploy correct, lookup compression. **Not met** — 0 real K8s attempts, so cannot assess 80%.

**Rethink:** Would be if abstraction works but narrower primitive emerges — not tested.

**Kill:** Would be if consumer needs branching, or previous/current unreliable, or null density high — not tested.

**Blocked:** **True** — no authorized real Kubernetes/ECS runtime was available and a disposable local cluster could not be created safely in this environment (`brew install kind` still building `go` 1.27 after 5 min, `docker` not found, macOS 13 old). Per task, report `PRODUCTION_CHANGE_BLOCKED` rather than fake with fixtures.

## If RETHINK, Identify Exactly One Narrower Primitive
Not applicable — blocked, not rethink. If forced to narrow based on Vercel alone, the narrower primitive would be `DeploymentIdentity` (`serviceId`, `environment`, `commitSha`, `previousCommitSha`), but this was already identified in prior `PRODUCTION_CHANGE_CONTINUE` report and not challenged by new real data.

## Final Decision
**PRODUCTION_CHANGE_BLOCKED**

Reason: No real Kubernetes or ECS deployment history could be generated — `kubectl`, `aws`, `docker`, `kind`, `k3d`, `minikube`, `colima` not found, and `brew install kind` did not complete within the task window on macOS 13. Vercel 15 real deployments remain the only real runtime evidence (100% source linkage, 93% previous, 0 branching), but cross-runtime validation requires at least 15 real container events from K8s or ECS. Per `critical_rule`, do not fake with fixtures. The existing `ProductionChange` abstraction shows no leakage on Vercel and handles redeploy correctly, but its container-runtime generalisation is unproven. A disposable `kind`/`k3d` cluster with 15 sequential deployments (including same-artifact redeploy, rollback, failed rollout) is the next step when tooling is available.

