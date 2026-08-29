# ProductionChange Canonical Runtime Identity — Architecture Note

**Date:** 2026-08-29
**Status:** Pre-implementation
**Goal:** Validate whether a narrow `ProductionChange` primitive (current/previous deployment, source commit, artifact, environment) collapses cleanly across Vercel/Kubernetes/Cloudflare + Sentry + GitHub.

## 1. Existing Change V0 Audit — Reuse

**Reusable:**
- `@rapture/kernel`: `sha256`, `safeArtifactPath`, `writeJsonArtifact`, `redactSecrets`, `Validation` — for storage, hashing, provenance.
- `@rapture/change` `packages/change/src/schema/change.ts`: `SCHEMA_VERSION`, `Provenance`, `Relationship` pattern (rule + sourceIds + constructedAt) — reuse helpers, not the broad `Change` schema itself (which is sparse, 5/5 deployments null in prior report).
- `@rapture/change` `store/storage.ts`: filesystem-first `.rapture/change/{raw,canonical}` + `index.json` pattern — reuse for `ProductionChange` storage (separate dir `.rapture/production` to allow kill).
- `@rapture/change` `adapters/contracts.ts`: `ProviderAdapter`, `RawSnapshot`, `NormalizedRecords` — reuse interface, extend for `DeploymentRecord`.
- `apps/cli` `CliIo` and `handleChange` pattern for `production` subcommands.

**Not reused / Isolated:**
- Broad `Change` with 8 entities (PR, commit, check, artifact, deployment, productionEffect) — too sparse (Vercel/Sentry 0/5). New `ProductionChange` is separate, small, and can be killed without touching `Change`.
- `profiler` operation taxonomy — different domain.

**New boundary:** `packages/production-change/` (separate package) so hypothesis can be killed cleanly. It reuses `kernel` helpers only where genuinely fit, and may import `change` helpers for `sha256`/`provenance` but not the `Change` schema.

## 2. ProductionChange Canonical Model (V0, small)

```
ProductionChange {
  id: string // pc_<service>_<env>_<shortSha|digest8>
  service: { id: string, name: string } // e.g., "invite" or "k8s:default/api"
  environment: { name: production|preview|staging|development|custom, providerEnvironmentId: string|null }
  source: { repository: string|null, commitSha: string|null, branch: string|null, pullRequest: string|null }
  artifact: { type: container|bundle|deployment_artifact|release|unknown, digest: string|null, externalId: string|null }
  deployment: { provider: string, externalId: string, status: queued|building|deploying|ready|failed|cancelled|unknown, startedAt: string|null, completedAt: string|null }
  transition: { previousProductionChangeId: string|null, previousCommitSha: string|null, resultingCommitSha: string|null }
  runtimeObservations: [{ provider, type: release|error|issue|metric|event, externalId, deterministicLinkRule, firstSeen, lastSeen }]
  provenance: { schemaVersion, constructedAt, sources: string[] }
}
```

- Unknowns remain `null`, not `unknown` string where not needed.
- Every `ProductionChange` retains `deployment.provider` + `externalId` and `service.id`.
- Relationships are implicit via `transition.previousProductionChangeId` with provenance `ordered_successful_production_deployments`.

## 3. Provider-Neutral DeploymentRecord Contract

```ts
interface DeploymentRecord {
  provider: string // "vercel" | "kubernetes" | "cloudflare"
  externalId: string
  serviceId: string // e.g., "vercel:invite" or "k8s:default/api"
  serviceName: string
  environment: string // normalized: production|preview|...
  providerEnvironmentId: string|null
  status: string // normalized
  startedAt: string|null
  completedAt: string|null
  commitSha: string|null // exact 7-40 hex, or null
  branch: string|null
  repository: string|null
  artifactDigest: string|null
  artifactExternalId: string|null
  raw: unknown // native payload retained separately, not in canonical
}
```

Adapters `vercel`, `kubernetes`, `cloudflare` map native → `DeploymentRecord`. Native payloads stay in `raw/<provider>/` for debugging, not in canonical.

## 4. Deterministic Join Rules (V0)

- `deployment.git.commit_sha -> GitHub commit` (Vercel `meta.githubCommitSha` / `gitSource.sha`, K8s `image` digest → `artifact` not commit, Cloudflare `trigger` branch not commit)
- `container image digest -> deployment artifact` (K8s `imageID` sha256)
- `Sentry release version == exact commit SHA` or `release.commit` metadata explicitly containing SHA
- `ordered successful production deployments for same service/environment -> previous deployment` (by `completedAt` asc, only `ready`/`succeeded`)

Forbidden: timestamp proximity, similar names, branch without SHA, LLM.

## 5. Real Data Plan

- **Vercel:** 15-20 production deployments from `wiramahendraa-5470s-projects/invite` (real, via `vercel ls` + `vercel inspect <url> --json` or `vercel api` with token from `vercel` CLI). Each has `commitSha` in `meta` if Git-connected.
- **Kubernetes:** No real cluster accessible (`kubectl` not found). Use fixtures based on `kubectl get deployments -o json` shape, mark as fixture not real, do not count toward 15-20 real.
- **Cloudflare:** No `wrangler` / token. Use fixtures, mark as not real.
- **Sentry:** Try `sentry-cli releases list` if `SENTRY_AUTH_TOKEN` set; else fixtures, mark as not real.
- **GitHub:** Source commits for Vercel SHAs via `gh api repos/.../commits/<sha>`.

Target: 15-20 real events from Vercel (1 provider) + GitHub source = 1 runtime provider real, 1 source real. To reach 2 runtime providers real, need at least one more: attempt Vercel + one fixture provider but document as `BLOCKED` if not enough.

## 6. Storage & API

- Root: `.rapture/production/{raw/<provider>,canonical/<id>.json,index.json}` — separate from `change`.
- `index.json` maps `byServiceEnv`, `byCommit`, `byDeployment`, `byCurrent` (service+env → latest ready).
- Library: `production.current(service,env)`, `history(service,env)`, `get(id)`, `findByCommit`, `findByDeployment`, `trace(identifier)` — provider-independent, no branching on `provider` in consumer (tested).
- CLI: `rapture production current <service> --env production`, `history`, `trace`, `show` — human + `--json`, explicit `null` for unresolved.

## 7. Consumer Test

One function per primary query (e.g., `currentVersion(service,env)` returns `commitSha` or `digest`). Run same function against Vercel, K8s, Cloudflare records; assert no `if (provider==="vercel")` branching. Record leakage if required.

## 8. Metrics & Leakage

- Measure % with `commitSha`, `serviceId`, `environment`, `artifactDigest`, `previousDeployment`, `runtimeObservations` per provider and overall.
- Measure `optional/null` density per provider (`null` count / total fields).
- Measure raw lookups without Rapture (e.g., `vercel ls` + `vercel inspect` + `gh api`) vs 1 `production.current`.

## 9. Risks

- Vercel `meta` may not contain SHA for all deployments (gap → unresolved).
- K8s/Cloudflare fixtures will be sparse, but real validation limited to Vercel.

