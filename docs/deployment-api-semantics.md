# Vercel vs Cloudflare Pages — Deploy/Status/Rollback Semantics Comparison

**Date:** 2026-08-30
**Purpose:** Phase 0 audit before implementing canonical deploy/status/rollback. Do not force commonality where semantics differ.

## 1. Deployment Creation

| Dimension | Vercel | Cloudflare Pages |
|---|---|---|
| **How deployed** | `vercel deploy` or `git push` triggers via GitHub integration. CLI `vercel deploy --prod` or `vercel --prod`. API `POST /v6/deployments` with `gitSource` or `files`. | `wrangler pages deploy <dir>` or `git push` via Pages Git integration. CLI `wrangler pages deploy ./dist --project-name=<name> --branch=<branch>` or `wrangler deploy` for Workers. API `POST /accounts/{id}/pages/projects/{name}/deployments`. |
| **Source revision input** | `gitCommitSha` via `meta.githubCommitSha` (exact 7-40 hex, from GitHub) or `gitSource.sha`. Also `githubCommitRef` branch. | `Source` is short SHA (7 hex, e.g., `277c6e8`) from `wrangler pages deployment list` `Source` field; no full SHA, no `repo` unless Pages Git-connected. For `wrangler pages deploy` local, source is local dir hash, not commit. |
| **Environment selection** | `target: production` vs `preview` (via `--target` or branch `main` → production, else preview). `providerEnvironmentId` = `target`. | `Environment: Production` vs `Preview` (capitalized, from `wrangler` JSON). Branch `main` → Production, else Preview. No `providerEnvironmentId` distinct from `Environment`. |
| **Deployment identity** | `id: <url>` (e.g., `invite-dndisek77...vercel.app` used as `id` in our adapter, or Vercel's `dpl_*` if via API). Immutable per deploy. | `Id: <uuid>` (e.g., `2e3e4f1b-922e-489f-...`), `Deployment: https://<id>.pages.dev`. Immutable. |
| **Service identity** | `projectId` or `name` → `vercel:<projectId>` (e.g., `vercel:invite`). Stable. | `project_name` (e.g., `igris`) → `cloudflare:igris` (from `project_name` param, not in deployment JSON but known). Stable. |

**Genuine common:** Both have `service` (project), `environment` (production/preview), `commitSha` (7 hex), `branch`, `status`, `timestamps`. Both create immutable deployment events.

**Provider-specific:** Vercel has `meta.githubCommitRepo` etc., Cloudflare has `Build` URL, not `meta`.

## 2. Status Lifecycle

| Provider | Canonical `ready` | Other native states | Mapping |
|---|---|---|---|
| Vercel | `READY` | `QUEUED`→`queued`, `BUILDING`→`building`, `ERROR`/`FAILED`→`failed`, `CANCELED`→`cancelled` | Deterministic, `state` field is authoritative. |
| Cloudflare Pages | `success` (implied via `Environment: Production` + no `Failure`) | `Status: "3 days ago"` (time-ago string, not status) for success, `Failure` for failed | Ambiguous: `Status` in `wrangler` JSON is time-ago, not `ready`/`failed`. Need to infer `ready` if `Status` contains `ago` or is `Success`, `failed` if `Status: Failure`. Different from Vercel's explicit `state`. |

**Genuine common:** Both have terminal `ready`/`failed`. Vercel's `state` is explicit, Cloudflare's requires heuristic (time-ago → ready). This is a leak point if we map naively.

## 3. Successful Completion Semantics

- **Vercel:** `state: READY` and `target: production` and `ready` timestamp present means successful production deployment.
- **Cloudflare Pages:** No explicit `state: READY`; `Status: "3 days ago"` plus `Environment: Production` implies success. `Failure` means failed. Need to treat `Status` containing `ago` as `ready` (as current adapter does: `if (status.includes("ago")) status="ready"`).

## 4. Failed Deployment Semantics

- **Vercel:** `state: ERROR`/`FAILED` with `target` still, but `ready` not set.
- **Cloudflare:** `Status: Failure` (seen in `igris-console` `85613f98`).

Both have failed, but Cloudflare's `Status` overloads time-ago vs failure, requiring special handling.

## 5. Rollback Semantics

| Provider | How rollback works | Creates new deployment? | Prior remains immutable? | Current-production concept |
|---|---|---|---|---|
| **Vercel** | `vercel rollback <deploymentId>` or `vercel alias set` or redeploy previous commit via `git revert` + `vercel deploy`. API `POST /v6/deployments` with `deploymentId` to rollback. Creates **new** deployment event with same `commitSha` as previous, new `id`/`url`, new `createdAt`. Prior deployment remains in history, immutable. `current` is latest `READY` `production` by `createdAt`. | **Yes**, new deployment event (new `id`, new `url`, same `commitSha`). | Yes, prior remains. | Latest `READY` production by `ready` timestamp. |
| **Cloudflare Pages** | `wrangler pages deployment list` shows history; `wrangler rollback` not a first-class command. Rollback is **redeploy** of prior commit via `wrangler pages deploy` with old `commit` or `git revert` + `wrangler pages deploy`. Also creates **new** deployment event with same `Source` (commit) but new `Id`. Some docs suggest `wrangler pages deployment create` with `branch`? No native `rollback` command. | **Yes**, new deployment event (new `Id`, same `Source`). | Yes, prior remains. | Latest `Production` by `Status` time-ago ordering (no explicit `current` flag). Need to sort by `Id` creation order or `Source` time, not ideal. |

**Genuine common:** Both create new deployment event on rollback, prior remains immutable, `previous` is prior `ready` production in `completedAt` order.

**Provider-specific:** Vercel has explicit `rollback` command; Cloudflare Pages does not—rollback is just a new deploy of old commit. Canonical `rollback --to previous` can be implemented as “redeploy `previousCommitSha`” for both, hiding the difference.

## 6. Prior Deployment Ordering

- **Vercel:** `createdAt`/`ready` timestamps are authoritative, already used in `production-builder.ts:37` (`completedAt` asc).
- **Cloudflare:** `wrangler` JSON has no `createdAt`/`ready` timestamp, only `Status: "3 days ago"` (relative). Need to fetch `created_on`/`modified_on` via API if available, or use `Id` order as proxy. Current adapter uses `created_on`/`modified_on` if present, else `null`, so ordering may be null.

**Leak:** If Cloudflare `created_on` is null, ordering by `completedAt` will be `""` for all, not deterministic. Need to ensure `created_on` is captured from `wrangler` JSON `Build` time or `Deployment` creation.

## 7. Provider-Native Current-Production Concept

- **Vercel:** Latest `READY` `production` by `ready` timestamp is authoritative `current`.
- **Cloudflare:** Latest `Production` by `Status` time-ago order, but no `ready` timestamp; need to sort by `Id` creation or fetch `created_on` via API.

## 8. Critical Output: Common vs Provider-Specific

| Semantics | Common? | Provider-specific knob |
|---|---|---|
| Create deployment from commit/branch + env | **Yes** | None—just `service`, `environment`, `sourceRevision` |
| Environment `production` vs `preview` | **Yes** (both have) | Cloudflare capitalizes `Production` vs Vercel `production` — normalize to lower |
| Deployment identity as `id`/`url` | **Yes** (both immutable) | Vercel `url` as `id`, Cloudflare `Id` as `id` — both work |
| Status `ready`/`failed` | **Partially** — Vercel explicit, Cloudflare time-ago → `ready` heuristic | Heuristic `if (status.includes("ago")) ready` is provider-specific but small |
| Source revision as 7-hex `Source` | **Yes** (both have short SHA) | Vercel `meta.githubCommitSha` (40 hex) vs Cloudflare `Source` (7 hex) — both 7-40 hex, same |
| Rollback `to previous` creates new deployment | **Yes** (both) | Vercel has `vercel rollback` command, Cloudflare is `wrangler pages deploy` with old commit — different CLI, but canonical `rollback` can hide as “deploy `previousCommitSha`” |
| Prior remains immutable | **Yes** | None |
| Current is latest `ready` | **Yes** | Both use `completedAt`/`ready` ordering |

**Conclusion:** 9/11 semantics are genuinely common; 2 require small adapter-local heuristics (`Status` time-ago → `ready`, `environment` lowercasing). No provider-specific knobs need to leak to canonical `DeployInput` (`service`, `environment`, `sourceRevision`).

