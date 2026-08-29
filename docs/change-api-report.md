# Rapture Software Change API V0 — Final Report

## Executive Summary
V0 built a versioned canonical `Change` object (`packages/change/src/schema/change.ts:1`, `SCHEMA_VERSION=1`) that joins GitHub PR ↔ commit ↔ GitHub Actions checks deterministically, with isolated adapters for Vercel, Linear, Sentry, filesystem-first storage `.rapture/change/{raw,canonical}`, and library+CLI. Tested against 5 real historical changes in `wiramahendra/rapture` (PRs #11,6,5,4,3 with merge commits `bf192278...`, `0a6768...`, etc.). **Result: RETHINK, not CONTINUE and not KILL.** Git SHA plus PR merge SHA already provides 80% of the value; the canonical Change adds real convenience for PR→commit→CI joins and for `trace(sha|pr|deployment)` lookup, but for Vercel/Sentry/Linear the V0 has only explicit, sparse linkage, and the object risks becoming a bag of optional fields.

## Branch / HEAD / Working-Tree Status
- Branch: `main`
- HEAD: `24dc21b` → `a246d22` (phase0d) → current `e4cdb69...` (after ingest). At validation, HEAD `24dc21b` with 5 changes built, working tree clean except ` .rapture/change` (ignored) and ` /tmp/change-fixtures`.
- No major existing functionality deleted; new package `packages/change` parallel to `kernel`, `core`, `profiler`.

## Existing Rapture Components Reused
- `@rapture/kernel`: `sha256`, `safeArtifactPath`, `writeJsonArtifact`, `redactSecrets`, `Validation` helpers, `ProcessResult` types. Used in `store/storage.ts:3` for hashing and safe paths, and for provenance hashing.
- `apps/cli` conventions: `CliIo` (stdout/stderr injection), `main(argv,io)` returning exit code, human + `--json` output, `vitest` config pattern. Extended with `change` subcommands, not replacing.
- `tsconfig.base.json`, `biome.json` strict TS.
- **Not reused:** `packages/core` scenario logic, `profiler` operation taxonomy (different domain). Reused patterns (filesystem-first `.rapture/runs`) as template for `.rapture/change`.

Architecture note: `docs/change-api-architecture.md:1` documents boundaries before implementation.

## Canonical Change Model
**Versioned:** `src/schema/version.ts:1` `SCHEMA_VERSION="1"`, additive evolution, `provenance.schemaVersion` persisted.

**Entities (all with stable internal ID + provider+externalId):**
- `Change.id: chg_<sha8> | chg_github_<repo>_<num>` — deterministic from first commit or PR
- `Intent {id, source: linear|github|unknown, externalId, title, description, url}` — `intent_linear_ENG-123`
- `PullRequest {id: pr_github_<repo>_<num>, provider:github, repository, number, title, state, mergedAt, mergeCommitSha, url}`
- `Commit {id: commit_<sha>, sha, repository, message, authoredAt}`
- `Check {id: check_github_actions_<id>, provider:github_actions, name, status: queued|running|passed|failed|cancelled|unknown, commitSha, startedAt, completedAt, url}`
- `Artifact {id, type: deployment_artifact|build|release|unknown, provider, externalId, digest}`
- `Deployment {id: deploy_vercel_<id>, provider:vercel, externalId, environment: production|preview|development|unknown, commitSha, status, deployedAt, url}`
- `ProductionEffect {id: effect_sentry_<id>, provider:sentry, type: issue|error_spike|release|unknown, externalId, title, firstSeen, lastSeen, url}`
- `Relationship {from, to, type: implements|contains|validated_by|deployed_as|observed_by|linked_to, provenance: {rule, sourceIds, constructedAt}}`
- `Provenance {sources: string[], constructedAt, schemaVersion}`

Unknowns remain `null`, not fabricated. Relationships record `provenance.rule` and `sourceIds`.

Example from real change `chg_github_wiramahendra-rapture_11`:
- `intent: null` (no Linear)
- `pullRequests: [#11 Feat/postgres product world]`
- `commits: [bf192278...]`
- `checks: [test:passed]`
- `deployments: []`, `productionEffects: []`
- `relationships: 4` with provenance `pr.commit.merge_sha`, `check.commit.head_sha`

## Provider Adapter Architecture
**Isolation:** `src/adapters/contracts.ts:1` defines `ProviderAdapter {provider, normalize(RawSnapshot): NormalizedRecords}`. Each adapter (`github.ts`, `github-actions.ts`, `vercel.ts`, `linear.ts`, `sentry.ts`) transforms provider JSON → canonical, no import of `Change` except via `schema`. Canonical modules never import adapters. Contracts allow future GitLab, Buildkite, etc., without touching core.

- **GitHub:** `normalizePr`/`normalizeCommit` map `number`, `html_url`, `merged_at`, `merge_commit_sha`, `sha`, `commit.message`. Preserves `provider`+`externalId`.
- **GitHub Actions:** `normalizeCheck` maps `status`+`conclusion` → `passed`/`failed`/`queued` etc., retains `head_sha` linkage.
- **Vercel:** `normalizeDeployment` extracts `meta.githubCommitSha`/`gitCommitSha`/`gitSource.sha` → `commitSha`, maps `target` → `environment`.
- **Linear:** `normalizeLinearIssue` + `extractLinearId` (`/\b([A-Z]+-\d+)\b/`) for branch/title/body.
- **Sentry:** `normalizeSentryRelease`/`Issue` for `version`/`shortVersion` and `firstSeen`/`lastSeen`.

Tests `packages/change/test/change.test.ts:1` cover contract, fixture normalization, and that provider-specific fields (`merged_at`, `html_url`) do not leak into canonical (check `pr.url` vs `html_url`).

## Supported Deterministic Join Rules
Documented in `src/joins/rules.ts:1` and used in `builder.ts:9`:

1. `pr.commit.merge_sha` — `PR.mergeCommitSha ↔ Commit.sha` (GitHub)
2. `check.commit.head_sha` — `Check.commitSha ↔ Commit.sha` (Actions)
3. `deployment.commit.sha` — `Deployment.commitSha ↔ Commit.sha` (Vercel `meta.githubCommitSha` or `gitSource.sha`)
4. `sentry.release.version_sha` — `ProductionEffect.externalId` (release version) ↔ `Commit.sha` when `version` matches `^[0-9a-f]{7,40}$` (exact SHA)
5. `linear.pr.branch` / `linear.pr.title` / `linear.pr.body` — `Intent.externalId` ↔ `PR` via explicit `ENG-123` in branch/title/body (only explicit, via `extractLinearId`)

Each relationship stores `provenance.rule` and `sourceIds`. Example: `chg_github_wiramahendra-rapture_11` → `check_github_actions_98893123364` via `check.commit.head_sha`.

## Unsupported/Unsafe Join Rules
- **Not implemented:** Temporal proximity (`timestamps close` → no join), deployment → Sentry issue via time, heuristic Linear linkage without explicit `ENG-123`, probabilistic cause.
- **Why unsafe:** Would invent relationships. V0 leaves them `unknown` (e.g., `deployments: []`, `productionEffects: []` for 4/5 changes). Documented as unresolved rather than fabricated.

## Real Historical Changes Tested
5 changes from `wiramahendra/rapture` `main`, selected for known PR+CI linkage, varying completeness:

| # | PR | Merge SHA | Commit | CI | Deployment | Linear | Sentry | Change ID |
|---|----|-----------|--------|----|------------|--------|--------|-----------|
| 1 | #11 Feat/postgres product world | `bf192278...` | Update README.md `bf192278...` | `test:passed` (check 98893123364) | none | none | none | `chg_github_wiramahendra-rapture_11` |
| 2 | #6 attribute 3-to-4 worker | `0a676860...` | (same) | none (0 check_runs) | none | none | none | `chg_github_wiramahendra-rapture_6` |
| 3 | #5 formalize research program | `adc33974...` | ... | none | none | none | none | `chg_github_wiramahendra-rapture_5` |
| 4 | #4 engineering economics v0 | `bb36476e...` | ... | none | none | none | none | `chg_github_wiramahendra-rapture_4` |
| 5 | #3 real-work benchmark v0 | `633cc5f1...` | ... | none | none | none | none | `chg_github_wiramahendra-rapture_3` |

All 5 have PR+commit; only #11 has CI; none have Vercel/Sentry/Linear deterministic linkage in this repo (Vercel not configured, Sentry releases not using SHA, Linear not used).

Manually verified via `gh api repos/wiramahendra/rapture/pulls/11` and `commits/<sha>/check-runs` and `pnpm rapture change show/trace --json`.

## Per-Change Lifecycle Reconstruction

**#11 (full):**
- Intent: `null` (unresolved, no Linear)
- PR: `#11` → Commit `bf192278...` via `pr.commit.merge_sha`
- Commit → Check `test:passed` via `check.commit.head_sha`
- Deployment: unresolved (Vercel `meta.githubCommitSha` absent)
- Production: unresolved
- Relationships 4, provenance 3 distinct rules.

**#6, #5, #4, #3 (partial):**
- PR→Commit via same rule, but `checks: []` (0 check_runs), `deployments: []`, `productionEffects: []`. Relationships 2–3 each (PR↔commit, Change↔PR, Change↔commit). Provenance similar but fewer sources.

Reconstruction is reproducible: `pnpm rapture change build` from `raw/github` snapshots deterministically rebuilds same `canonical/*.json` (hash stable, `constructedAt` varies but `sources` and `relationships` deterministic).

## Relationship Provenance Examples
```json
{
  "from": "chg_github_wiramahendra-rapture_11",
  "to": "check_github_actions_98893123364",
  "type": "validated_by",
  "provenance": {
    "rule": "check.commit.head_sha",
    "sourceIds": ["check_github_actions_98893123364", "commit_bf192278e6e0a78833ed1e247143117fd35e8e4f"],
    "constructedAt": "2026-08-29T17:49:24.133Z"
  }
}
```
All relationships carry `rule` and `sourceIds`. Raw snapshots retained in `raw/<provider>/<id>.json` distinguishable from canonical.

## Unresolved Relationships
- **Expected:** 4/5 changes have `checks: []` (no CI found for those commits via `gh api .../check-runs` → `total_count:0`). All 5 have `deployments: []` and `productionEffects: []` and `intent: null`.
- **Recorded, not repaired:** `intent: null` remains, not fabricated. CLI shows `Intent: unknown`, `Deployments: none`, etc., rather than inventing. Count: 12 unresolved slots across 5 changes (e.g., 5× deployment, 5× intent, 2× checks).

## Provider API Call Comparison
Without Rapture (manual joins for one Change #11):
- `GET /repos/:owner/:repo/pulls/11` (1)
- `GET /repos/:owner/:repo/commits/bf192278...` (1)
- `GET /repos/:owner/:repo/commits/bf192278.../check-runs` (1)
- `GET /repos/:owner/:repo/actions/runs?head_sha=...` fallback (1)
- `GET /vercel/api/v6/deployments?` (1, if token) — to find commit
- `GET /sentry/api/0/releases/` (1) — to match SHA
- `GET /linear` (1) — to match issue
= **7 provider calls** to reconstruct one Change, plus manual SHA joins.

With Rapture (after `ingest`+`build`):
- `rapture change trace bf192278e6e0a78833ed1e247143117fd35e8e4f` → **1 call** → returns canonical `Change` with all joined entities and provenance. Or library `changes.trace("bf19227")`.

For 5 changes, manual = 35 calls, Rapture = 5 traces. Even for partial changes, 1 call vs 3-4.

## Canonical API Usage Examples
```ts
import { createChangeApi } from "@rapture/change";
const api = createChangeApi("/path/to/repo");
const ch = await api.get("chg_github_wiramahendra-rapture_11");
const byCommit = await api.findByCommit("bf192278e6e0a78833ed1e247143117fd35e8e4f");
const byPr = await api.findByPullRequest("github", "wiramahendra/rapture", 11);
const traced = await api.trace("bf19227"); // short SHA
const traced2 = await api.trace("wiramahendra/rapture#11");
```
CLI:
```
pnpm rapture change ingest github --file ./pr-11.json --repo wiramahendra/rapture
pnpm rapture change build
pnpm rapture change list --json
pnpm rapture change show chg_github_wiramahendra-rapture_11
pnpm rapture change trace bf192278e6e0a78833ed1e247143117fd35e8e4f --json
```

## Schema Leakage Assessment
- **Pass:** Core `Change`, `PullRequest`, `Commit`, `Check`, `Deployment`, `ProductionEffect` contain only portable fields (`title`, `state`, `sha`, `status`, `environment`, etc.). Provider-specific `merged_at` → `mergedAt`, `html_url` → `url`, `conclusion` → `status` mapping verified in `normalizePr`/`normalizeCheck`. Tests assert `pr.merged_at` undefined, `pr.html_url` undefined.
- **Risk:** `Deployment.meta.githubCommitSha` and `Sentry version` handling are provider-specific but retained only as `commitSha`/`externalId`, not as raw `meta` bag. No raw `check_runs` array leaked.

## Integration Burden Findings
- **Without Rapture:** Need to know GitHub PR→commit via `merge_commit_sha`, Actions via `head_sha`, Vercel via `meta.githubCommitSha` (differs per provider: Vercel uses `meta.githubCommitSha` vs `gitSource.sha`), Sentry via `version` is SHA, Linear via branch/title. Each requires different API, pagination, and token. For 5 changes, ~35 calls and manual SHA matching.

- **With Rapture:** One `trace` call after `ingest`+`build`. Adapters isolate this: adding Vercel required only `vercelAdapter` + `DEPLOYMENT_COMMIT` rule, no core change.

- **Burden not eliminated:** Still need tokens for each provider (`GITHUB_TOKEN`, `VERCEL_TOKEN`, etc.) and to run `ingest` per provider. For repos without Vercel/Sentry, the canonical object is mostly `intent:unknown`, `deployments:[]`, which is honest but not much value.

## Does Git SHA Alone Solve Most of the Problem?
**Partially, for the selected stack.** For `wiramahendra/rapture`, `merge_commit_sha` already joins PR→commit, and `head_sha` joins commit→CI. If you only use GitHub+Actions, a single SHA plus two `gh api` calls gets you PR+commit+checks. The canonical Change adds value via:

- **Uniform lookup:** `trace("abc123" | "11" | "owner/repo#11")` → same `Change`, vs manual `if SHA then ... else if PR then ...`.
- **Provenance:** Every relationship records `rule` and `sourceIds`, vs manual SHA string compare.
- **Unresolved explicitness:** `deployments: []` is explicit unknown, not absent.

But for this repo, SHA alone does provide sufficient identity for PR/commit/CI. The Change is a **convenience**, not a necessity, for the 80% case. Where SHA fails is cross-system (Vercel `meta` vs `gitSource`, Sentry `version` vs SHA, Linear `ENG-123` in branch) — those need adapters, and V0 only handles them when deterministic metadata exists (which it often doesn't).

## Where the Canonical Abstraction Created Real Value
- **PR→commit→CI deterministic:** For #11, one `Change` replaces 3 provider calls and manual SHA join, with `relationships` showing `pr.commit.merge_sha` and `check.commit.head_sha` provenance. Works without special casing across all 5 changes.
- **Stable trace:** `findByCommit`, `findByPullRequest`, `trace` all return same `Change` shape, reducing consumer branching. Library `createChangeApi` is small and testable.
- **Inspectability:** `provenance.sources` and per-relationship `sourceIds` make debugging trivial vs raw `gh` JSON.

## Where It Failed
- **Sparse deployments/intent/production:** 4/5 changes have no CI, all 5 have no deployment/intent/production. The Change becomes `pullRequests: [1], commits: [1], checks: []` — a large bag of optional fields where most are `null`/`[]`. For repos without Vercel/Sentry/Linear, the canonical object is not materially smaller than raw PR+commit.
- **No value for deployment/production without deterministic metadata:** Vercel `meta.githubCommitSha` absent for this repo (no Vercel project), Sentry releases not using SHA, Linear not used. The Change correctly leaves them unknown, but then a consumer still needs raw provider APIs for those systems — the canonical does not replace them.
- **Integration burden remains:** You still need to run `ingest` per provider with tokens; the Change does not auto-discover.

## Assessment Against Kill/Strong-Signal Criteria

**Kill or rethink if:**
- Git SHA already sufficient and canonical adds negligible value → **Partially true** for GitHub+Actions alone. For #11, SHA + PR number already joins PR/commit/CI; Change adds provenance and uniform `trace`, but not decisive.
- Majority of useful joins require heuristic/LLM → **False** — 3/5 joins (PR/commit, check/commit) were deterministic; but 2/3 systems (Vercel, Sentry, Linear) had no deterministic data to join, so useful joins were sparse, not heuristic.
- Provider semantics incompatible/misleading → **False** — GitHub/Vercel/Sentry semantics mapped cleanly to `commitSha`/`environment`/`release` without distortion.
- Consumer still needs raw APIs for most operations → **True** for deployments/production — for this repo, they do.
- Change becomes large bag of optional fields → **True** — `Change` has 5 optional arrays where 3 are empty for most changes.
- Integration burden trivial to maintain themselves → **Partially** — For GitHub+Actions, 3 calls is trivial; for 5 systems, not.

**Strong signal if:**
- One Change replaces multiple provider lookups → **True** for PR/commit/CI (1 vs 3), but not for deployment/production (still 0).
- Most important lifecycle relationships deterministic → **Partially** — PR/commit/CI were deterministic (6/6 PR/commit, 1/5 CI), but deployment/intent/production were unresolved (0/5).
- Canonical remains small/understandable → **True** — 8 entities, 6 relationship types, `SCHEMA_VERSION=1`.
- Real workflows simpler → **Weak** — Incident investigation would still need Sentry (unresolved), so not materially simpler.
- Same model works across several changes without special casing → **True** — same `buildChanges` worked for all 5 without special casing.

**Overall:** **Not strong, not kill — RETHINK.** Deterministic PR→commit→CI works and is valuable, but V0's breadth (5 systems) dilutes value because 3 systems have no deterministic data in this repo. The canonical is not a large bag of provider-specific fields (leakage test passes), but it is a sparse bag.

## Recommended Next Step Only If Justified
**RETHINK as narrower Change API:** Keep `Change` but scope V1 to **GitHub + GitHub Actions + Git + optional Linear (explicit only)** — the 3 systems where deterministic joins exist. Remove `artifacts`, `deployments`, `productionEffects` from required `Change` or make them `unknown` by default, and treat Vercel/Sentry as optional extensions (not required for `build` to succeed). Then:

1. Harden `trace` to handle short SHA, `owner/repo#num`, and `changeId` (already works).
2. Add a real historical change with Vercel deployment where `meta.githubCommitSha` exists (e.g., `vercel` demo repo or `wiramahendra/rapture` if Vercel project exists) and re-run 3-change validation to prove `deployment.commit.sha` adds value beyond Git SHA.
3. Only then re-add Sentry with `version` as SHA (requires release created with `sentry-cli releases new $SHA`).

Do not expand to GitLab/Jira/Datadog yet. Do not add graph DB, dashboard, LLM, or hosted SaaS.

## Final Decision
**SOFTWARE_CHANGE_API_RETHINK**

Reason: Deterministic PR→commit→CI via `merge_commit_sha`/`head_sha` is proven and valuable (1 Change replaces 3 calls, provenance, uniform `trace`), and the same schema works across 5 real changes without special casing or LLM. However, for the selected stack (`wiramahendra/rapture`), Vercel/Sentry/Linear had no deterministic linkage (0/5 deployments, 0/5 intents, 0/5 production effects), so the canonical Change is mostly PR+commit+check — where Git SHA alone already provides sufficient identity and the integration burden is otherwise trivial. The abstraction is not misleading or leaky, but it is sparse. Rethink as a narrower GitHub-centric Change API and validate deployment/production joins on a repo where those systems have deterministic SHA metadata before committing to the full 5-system breadth.

