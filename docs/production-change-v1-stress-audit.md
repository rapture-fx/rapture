# ProductionChange V1 Stress Test — Pre-Implementation Audit

**Date:** 2026-08-29
**Current HEAD:** `acf275b` (ProductionChange V0, 15 Vercel prod deployments, 100% source linkage)
**Branch:** `main`

## 1. Current Architecture (from `docs/production-change-architecture.md`)

- Package `packages/production-change` with `ProductionChange` schema (22 fields), `DeploymentRecord` contract, adapters `vercel`, `kubernetes`, `cloudflare`, `store` (`.rapture/production`), `api` (current/history/trace), `consumer` (provider-independent).
- Vercel assumptions learned:
  - `meta.githubCommitSha` / `gitSource.sha` provides exact 7-40 hex `commitSha` for 100% of deployments (15/15).
  - `projectId` + `target` gives `serviceId: vercel:<projectId>` and `environment: production|preview`.
  - `id` is deployment's `url` (hashed to `pc_vercel-...`), `state: READY` maps to `ready`, `createdAt`/`ready` as `startedAt`/`completedAt`.
  - No `artifactDigest` for Vercel bundles (0/15), `artifact.type: deployment_artifact`.
  - Previous/current via `completedAt` asc, only `ready` considered.

## 2. Expected Stress Points for Container Runtimes

**Service identity:**
- Vercel: `vercel:<projectId>` stable.
- Kubernetes: `k8s:<namespace>/<name>` — may be stable, but `namespace` as environment is heuristic (e.g., `production` vs `default`). Risk: `environment` may be `default` not `production`, causing mismatch with Vercel's `production`.
- ECS: `ecs:<cluster>/<service>` — may need `cluster` + `service` to be unique.

**Environment identity:**
- Vercel: `target` is authoritative (`production`).
- Kubernetes: `metadata.namespace` is not necessarily `production` — could be `default`, `prod`, etc. No `providerEnvironmentId` standard.
- Cloudflare: `environment` field may be `production` but could be custom.

**Source commit:**
- Vercel: `meta.githubCommitSha` is explicit, deterministic.
- Kubernetes: `image` tag may be `myapp:abc123def` but tag is mutable; `imageID` digest is immutable but not commit. Commit SHA may be in `image` label `org.opencontainers.image.revision` or annotation `deployment.kubernetes.io/revision` — not guaranteed. Stress: without explicit pipeline-emitted SHA label/annotation, `commitSha` will be `null`.
- ECS: `image` tag similar, `taskDefinition` may have `revision` but not commit. Need `image` labels or `tags` with SHA.

**Artifact digest:**
- Vercel: 0% (bundle).
- Kubernetes: `imageID` `sha256:` available (1/1 fixture), but requires `imageID` not just `image`.
- ECS: `imageDigest` available via `describe-tasks` if `image` includes digest.

**Timestamps / ordering:**
- Vercel: `createdAt`/`ready` as `startedAt`/`completedAt` — reliable.
- Kubernetes: `metadata.creationTimestamp` vs `status.conditions[].lastTransitionTime` — which is authoritative for `previous`? Need to decide.
- ECS: `createdAt` vs `updatedAt` for service, `createdAt` for task.

**Previous/current:**
- Vercel: `ready` filter works.
- Kubernetes: `Available: True` `ready` filter may be similar, but rollout may have `Progressing` etc.

**Runtime observations:**
- Currently 0/15 Vercel linked (no Sentry SHA for `invite`). Expect same for K8s/ECS unless release version is SHA.

## 3. Real Runtime Availability Check

- `kubectl` not found, `~/.kube` only `cache`, no cluster.
- `docker` not found, `podman`/`kind`/`minikube`/`colima` not found, `aws` not found, `ecs-cli` not found, `/var/run/docker.sock` exists but no client.
- `vercel` CLI available and authenticated (`wiramahendraa`, 20 deployments for `invite` production) — already used.
- No authorized Kubernetes cluster or ECS service accessible in this environment.

**Conclusion:** No real container runtime (Kubernetes/ECS) dataset is accessible. Cannot perform real validation for the preferred runtime. Per task, must report `PRODUCTION_CHANGE_BLOCKED` rather than faking with fixtures.
