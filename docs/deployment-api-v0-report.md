# Deployment API V0 — Real Mutation Experiment Report

**Run ID:** `20260830T083542Z`
**Evidence:** `.rapture/experiments/deployment-api-v0/20260830T083542Z/` (gitignored, local only)
**Date:** 2026-08-30

---

## Executive summary

Unlike V1B and V1C, this run was **not blocked**. Both provider CLIs were installed and
authenticated (`vercel whoami` → `wiramahendraa`; `wrangler whoami` → `Igris Inertial`,
with `pages (write)`), and **6 real production mutations were executed** against the two
real services.

The abstraction did not survive contact with real providers. Eight defects were found, all
of them by real execution rather than by inspection, and seven were fixed with regression
tests. Two of the defects were actively dangerous: canonical `status` returned **`ready`
for a deployment ID that cannot exist**, and every `previousProductionChangeId` in the
store was a **dangling reference** — meaning ProductionChange-backed rollback had never
worked on real data at any point.

After the fixes, the picture is:

- **Deploy is worse than cosmetic.** `DeployInput` models `service + sourceRevision` but
  has no model of *where that service's source lives or how it is built*. All 3 Vercel
  deploys failed at build because the adapter can only materialize revisions from the
  Rapture repo, not from `wiramahendra/invite`. The 3 Cloudflare deploys succeeded only
  because Pages uploads static files and the "service source" happened to be this repo.
- **Status adds nothing.** Both provider CLIs block until terminal, so **zero intermediate
  state transitions were observable** across all 6 mutations. Canonical status only ever
  reports a terminal state that the native command already printed.
- **Rollback could not be executed on either provider.** On Vercel it failed because the
  previous revision belongs to the service's own repo (`0703b8c…`, not a Rapture commit).
  On Cloudflare it failed because `current` resolves to a **failed** deployment.

**Verdict: `DEPLOYMENT_API_KILL`.** The one component with demonstrated value is the
ProductionChange rollback *plan* (correct current/previous resolution with distinct
`deploymentId` and `sourceRevision` identities on Vercel) — but Vercel already ships
`vercel rollback <id> --yes`, which is one command, needs no source, and works.

---

## Starting git state

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD | `ae216a682eaf996d94a0c91624ec03b5d52be20f` |
| Upstream | `origin/main` |
| Task-declared base | `a2adf0d` — **mismatch**, actual HEAD was `ae216a6` |

Preflight (all green before any mutation): `pnpm build` 6/6, `pnpm typecheck` 6/6,
`pnpm -r test` **159 passed**. Note the root `pnpm test` script covers only kernel/core/cli
and would have run 119 of them; `-r` was used throughout.

Uncommitted Deployment API files at start:

```
packages/production-change/src/deployment/{api,cli,cloudflare,config,provider,types,vercel}.ts
docs/deployment-api-semantics.md
```

These were snapshotted (patch + tarball) before the first mutation, because both adapters
performed `git checkout` in the primary dirty worktree — see Bug 3.

---

## Calibration results

| Step | Provider | Outcome |
|---|---|---|
| 1. One forward deploy | Vercel | **FAIL** — build error; also exposed Bug 5 (`deploymentId` = `"}"`) |
| 2. Poll status to terminal | Vercel | n/a — deploy terminal-failed immediately |
| 3. Re-ingest history | Vercel | deferred |
| 4. Verify current | Vercel | correct: failed deploy did **not** become current |
| 5. One forward deploy | Cloudflare | **PASS** — `50a639ff`, `ready`, 144 files |
| 6. Poll status to terminal | Cloudflare | `ready` — but see Bug 6, it was fabricated |
| 7. Re-ingest history | Cloudflare | **FAIL** — Bugs 7 and 8 |
| 8. Verify current | Cloudflare | **FAIL** — resolves to a *failed* deployment |

Classification per `calibration_gate.if_failure`: the Vercel failure is an **unsafe/incorrect
artifact condition plus abstraction leakage** (no source model), not a provider semantic
mismatch. The Cloudflare failures are **implementation defects** (fixed) plus one
**structural abstraction gap** (`current` is not status-aware — not fixed, see below).

---

## 10-mutation execution table

Target was 10 (3 deploys + 2 rollbacks per provider). **6 real provider mutations were
executed.** No rollback mutation reached the provider.

| # | Provider | Operation | Revision | Result | Deployment identity |
|---|---|---|---|---|---|
| 1 | Vercel | deploy | `ae216a6` | **failed** (build) | `invite-hfslvvb44-…vercel.app` |
| 2 | Vercel | deploy (rerun after Bug 5 fix) | `ae216a6` | **failed** (build) | `invite-cuvpajl2n-…vercel.app` |
| 3 | Cloudflare | deploy | `ae216a6` | **ready** | `50a639ff` / `50a639ff-3b78-4782-b05c-798ea28c4de6` |
| 4 | Cloudflare | deploy | `3e69e22` | **ready** | `c94631d8` / `c94631d8-8c5b-4359-94a4-260c077c0567` |
| 5 | Vercel | deploy | `a2adf0d` | **failed** (build) | `invite-l0felz1a6-…vercel.app` |
| 6 | Cloudflare | deploy | `a2adf0d` | **ready** | `60835037` |
| — | Vercel | rollback `--dry-run` | — | plan produced, **zero mutation** | — |
| — | Cloudflare | rollback `--dry-run` | — | **error** — "no previous" | — |
| — | Vercel | rollback (execute) | → `0703b8c` | **aborted before provider call** | source revision not in repo |
| — | Cloudflare | rollback (execute) | — | **unreachable** — `current` is a failed deployment | — |

Not achieved: 4 rollback mutations, and 3/3 Vercel forward deploys reaching `ready`.

---

## Vercel deploy evidence

All three Vercel deploys reached the real project — the adapter now links the throwaway
worktree to the configured `providerProject`:

```
Deploying wiramahendraa-5470s-projects/invite
Inspect     https://vercel.com/wiramahendraa-5470s-projects/invite/6yuLQ4pY25dpSfwCJrmWAS2rNte1
Production  https://invite-hfslvvb44-wiramahendraa-5470s-projects.vercel.app
Error: No Next.js version detected. Make sure your package.json has "next" in either
"dependencies" or "devDependencies".
```

The `invite` project is a Next.js project. The Rapture monorepo is not. The Deployment API
has no way to express "deploy revision X *of service S's own repository*", so it deployed
the wrong artifact and the provider correctly rejected it. Native Vercel state after the
run: `READY 17, ERROR 3` — the 3 errors are exactly mutations 1, 2 and 5.

## Cloudflare deploy evidence

```
✨ Success! Uploaded 144 files (1.82 sec)
✨ Deployment complete! Take a peek over at https://50a639ff.igris-console.pages.dev
```

Mutation 4 reported `Uploaded 0 files (143 already uploaded)` — Cloudflare deduplicates by
content, so two different revisions produced near-identical artifacts. This is worth noting
because it means a Pages "deployment" is not a reliable proxy for a source revision.

A warning surfaced on every deploy: `Your working directory is a git repo and has
uncommitted changes`. The worktree is checked out at a clean commit; the warning comes from
wrangler inspecting the linked worktree.

---

## Status lifecycle evidence

**Zero intermediate transitions were observed.** Both `vercel deploy` and `wrangler pages
deploy` block until the deployment reaches a terminal state, so there is no window in which
canonical `status` can report `queued`, `building`, or `deploying`. Every status observation
in this experiment was of an already-terminal deployment.

### Native → canonical mapping (45 real observations)

| Provider | Native value | Count | Canonical | Honest? |
|---|---|---|---|---|
| Vercel | `READY` | 17 | `ready` | yes |
| Vercel | `ERROR` | 3 | `failed` | yes |
| Cloudflare | `Failure` | 22 | `failed` | yes (after fix; was `unknown`) |
| Cloudflare | *relative time* (`40 seconds ago`) | 3 | `ready` | **inferred, lossy** |

Honest mapping: **42/45 = 93.3%**, above the 90% threshold — but with a material caveat.

**Semantic loss:** Cloudflare Pages has no success vocabulary at all. `wrangler pages
deployment list` puts a **relative timestamp** in the `Status` column for anything that did
not fail. Mapping `"40 seconds ago"` → `ready` infers success from the *absence of the word
Failure*. It cannot distinguish `ready` from `building`, and it would silently map any
future non-failure status to `ready`. Per the experiment's critical rule, this is a mapping
that hides materially important semantics.

---

## Vercel rollback evidence

Dry-run plan (correct, zero mutation):

```json
{
  "service": "invite",
  "environment": "production",
  "currentDeploymentId": "invite-dndisek77-wiramahendraa-5470s-projects.vercel.app",
  "currentSourceRevision": "ced2dfcbf27f1b41def06a76e10aae3691f4249d",
  "previousDeploymentId": "invite-f0icfpkfm-wiramahendraa-5470s-projects.vercel.app",
  "previousSourceRevision": "0703b8cecc363b0dfc58f9afa697384bf05bd462",
  "provider": "vercel",
  "plannedTransition": "ced2dfcbf27f1b41def06a76e10aae3691f4249d -> 0703b8cecc363b0dfc58f9afa697384bf05bd462"
}
```

Execution failed **before any provider call**:

```
Error: source revision not found in /Users/wira/Documents/rapture/rapture:
0703b8cecc363b0dfc58f9afa697384bf05bd462
```

This is the central structural finding. ProductionChange resolved *what* to roll back to
perfectly. The Deployment API cannot *obtain* it, because `0703b8c` is a commit in
`wiramahendra/invite`, and `deploy()` materializes revisions from `repoRoot`.

Note this is a loud, honest failure only because of the Bug 3 fix. The original code would
have silently failed the checkout (`reject: false`), deployed the *current* tree, and
reported `sourceRevision: 0703b8c…` — fabricated metadata.

## Cloudflare rollback evidence

Never reached execution. `rollback --dry-run igris-console` errors with `no previous for
igris-console production`, because `production current igris-console` returns:

```
ext: 3f8717d1-1123-426d-aad3-c5c1468fb920 | sha: 09d0e66 | status: failed | prev: NULL
```

A **failed** deployment, selected as current, while three genuinely `ready` deployments
(`50a639ff`, `c94631d8`, `60835037`) existed in the same store. Reproduced twice, after
independent re-ingests.

Cause: `ProductionApi.current()` applies no status filter and sorts by
`deployment.completedAt`. `wrangler pages deployment list` supplies **no timestamps**, so
every Cloudflare record has `completedAt: null`, the comparator degenerates, and an
arbitrary — here, failed — record wins.

---

## Before/after ProductionChange verification

| Check | Before fixes | After fixes |
|---|---|---|
| Resolvable `previousProductionChangeId` links | **0** | **14** |
| Dangling links | **14** | **0** |
| Cloudflare canonical status | `unknown` (all) | `failed` / `ready` correctly |
| `rollback --dry-run invite` | error: "previous not found" | correct plan |
| Canonical status for a nonexistent ID | **`ready`** | `unknown` |
| Canonical status for a known-failed deployment | `unknown` / provider `unknown` | `failed` / `cloudflare` |
| `current` returns a failed deployment (Cloudflare) | yes | **still yes** (unfixed, structural) |

---

## Deployment ID vs revision identity findings

The two identities are correctly kept separate in the *type*, and the Vercel dry-run proves
it (`previousDeploymentId` is a URL, `previousSourceRevision` is a 40-char SHA, and the
regression test asserts they are never conflated).

In *practice* the identity model is incoherent across paths:

| | Deploy path | Ingest path |
|---|---|---|
| Cloudflare deployment id | `50a639ff` (8-char subdomain) | `50a639ff-3b78-4782-b05c-798ea28c4de6` (UUID) |
| Cloudflare source revision | `ae216a682eaf…` (40 chars) | `ae216a6` (7 chars) |
| Vercel deployment id | `invite-cuvpajl2n-….vercel.app` (URL) | URL |

The same physical deployment therefore produced **two canonical records with different IDs
and different SHA representations**. Re-ingestion does not reconcile with the deploy path —
it duplicates. Every rollback verification in this experiment required manually deleting the
deploy-path records so the ingested provider truth was authoritative.

Additionally, `deploy()` builds its ProductionChange from a **single** DeploymentRecord, so
`prevSuccessful` is always null and the transition is always empty. The chain is only correct
after a full re-ingest and rebuild — meaning the canonical record written by a deploy is
never sufficient for a subsequent rollback.

---

## Provider branch audit

Scope: canonical deployment API, CLI command layer, consumer code. Adapters excluded.

| Location | Branches | Assessment |
|---|---|---|
| `deployment/api.ts:24-25` | 2 | Registry dispatch in `getProvider` — defensible; selects an implementation, does not branch on provider semantics |
| `deployment/api.ts` `getStatus` | 0 (was N) | **Was** "try Vercel, then Cloudflare" probing. Fixed to route via configured service. This probing was the direct cause of a failed Cloudflare deployment reporting `provider: "unknown"` |
| `deployment/cli.ts` | 0 | clean |
| `apps/cli/src/cli.ts` | 0 | clean |

**Result: 0 semantic provider branches** in the canonical API and CLI after the fix.

## Escape-hatch audit

| Token | Occurrences |
|---|---|
| `providerOptions` | 0 |
| `nativeArgs` | 0 |
| `rawProviderConfig` | 0 |
| `providerPayload` | 0 |

`DeployInput` and `RollbackInput` expose **no** raw provider fields. This is a genuine
strength of the type design.

**However**, provider-specific knowledge leaks *around* the types rather than through them:

1. The caller must supply `--service igris-console` to `production ingest`, because
   wrangler's JSON contains no project field (Bug 8).
2. The caller must know that Cloudflare's identity field is `Id`, not `id` (Bug 7).
3. The caller must know that a Cloudflare `Status` of `"3 days ago"` means success.
4. The caller must know the service's source repository and ensure it is `repoRoot`.

The escape hatch count is zero because the API cannot do the job at all, not because the
abstraction holds.

---

## Bugs discovered during real execution

All eight were revealed by real execution or real data, never by inspection. Seven fixed
with regression tests (`packages/production-change/test/production.test.ts`, 14 new tests;
suite 14 → 30).

1. **Dangling transition links.** A record's own `id` is derived from `externalId`, but
   `previousProductionChangeId` was derived from `artifactDigest ?? commitSha ?? externalId`.
   With a non-null `commitSha` the link could never match any emitted record — **14/14 links
   dangling** on real Vercel data. *Implementation defect.* Fixed: derive from `externalId`.
   This is precisely the "previousId substituted for previousSha" failure the experiment was
   told to test for.
2. **`Failure` unmapped.** All 15 real Cloudflare deployments reported native `Status:
   "Failure"`, which fell through to `unknown`, hiding failure behind an inconclusive status.
   *Implementation defect.* Fixed in both the builder and the deployment adapter.
3. **`git checkout` in the primary dirty worktree.** Both adapters checked out the requested
   revision in `repoRoot`, then restored — with `reject: false`. Explicitly forbidden by the
   experiment's `source_revision_rule`; would have silently deployed the wrong tree while
   reporting the requested SHA, and risked the uncommitted implementation. *Implementation
   defect.* Fixed: throwaway `git worktree`, and the **resolved** SHA is now reported.
4. **No project targeting on Vercel.** The adapter never read `providerProject`, so
   `vercel deploy --yes` would have created a project named after the temp directory.
   *Implementation defect.* Fixed: `vercel link --project <providerProject>`.
5. **`deploymentId` parsed as `"}"`.** The adapter took the last stdout line; on a build
   failure stdout is a JSON error object. A canonical record was written with `externalId:
   "}"`. *Implementation defect.* Fixed: parse the `Production` URL from provider output.
   Preserved at `BUG-corrupt-deploymentid-record.json`.
6. **Fabricated status.** Cloudflare `getStatus` fell back to `exitCode === 0 → "ready"`
   whenever the deployment was not found in the list — so **any** ID returned `ready`,
   including `totally-bogus-id-does-not-exist-0000`. It also looked up the project via
   `deploymentId.split("-")[0]`. *Implementation defect, and the most dangerous one found.*
   Fixed: not-found is `unknown`; project comes from config; subdomain-vs-UUID both match.
7. **Ingest destroyed 24 of 25 records.** `production ingest` stored a JSON **array** as one
   opaque blob, and keyed raw records by `data.id || data.uid || filePath` — Cloudflare uses
   `Id`, so every record fell back to the file path, which `saveRaw` sanitizes and truncates
   to 100 chars. Sibling files under a long directory collapsed onto **one** filename. 25
   ingests produced 1 raw record. *Implementation defect.* Fixed: iterate arrays, recognize
   `Id`/`ID`/`deploymentId`, and refuse to key on a path.
8. **Service misattribution.** With no project field in wrangler output, the Cloudflare
   adapter fell back to a hardcoded `"igris"` — which is a *different real Pages project* in
   this account. Every re-ingested deployment was filed under the wrong service. *Abstraction
   leak.* Worked around with `ingest --service <name>`; recorded as a leak, not a clean fix.

**Not fixed — structural, and reported rather than redesigned** (the brief forbids redesigning
the API):

- `ProductionApi.current()` is not status-aware and depends on provider-supplied timestamps.
  Where a provider omits them, `current` is arbitrary and can be a failed deployment.
- `deploy()` builds its ProductionChange in isolation, so transitions are always null.
- Deploy and ingest paths mint different identities for the same deployment.
- `DeployInput` has no model of service source acquisition or build.

---

## Native Vercel workflow measured

Using the commands actually run:

| Task | Native | Commands |
|---|---|---|
| Deploy an exact revision | `vercel link --project invite` then `vercel deploy --prod --yes` in the service checkout | 2 |
| Find current production deployment | `vercel list invite --json` → first `state: READY` | 1 |
| Find previous production revision | same output, next `READY` entry | 0 |
| Inspect deployment status | `state` field in the same list, or `vercel inspect <id>` | 0–1 |
| Choose rollback target | deployment URL from the same list | 0 |
| **Execute rollback** | **`vercel rollback <url> --yes`** — no source, no rebuild | **1** |
| Verify the rollback | `vercel rollback status` or re-list | 1 |

Concepts required: project linking, `--prod`, deployment URL vs ID, scope. **Total ≈ 3–4
commands, all first-party, and rollback needs no source at all.**

## Native Cloudflare workflow measured

| Task | Native | Commands |
|---|---|---|
| Deploy an exact revision | `wrangler pages deploy <dir> --project-name X --branch main --commit-hash <sha>` (caller must produce the asset dir) | 1 |
| Find current production deployment | `wrangler pages deployment list --project-name X --json`, filter `Environment: Production`, pick the first non-`Failure` | 1 + manual inference |
| Find previous production revision | same output, next Production entry | 0 |
| Inspect deployment status | same list — there is no per-deployment status command | 0 |
| Choose rollback target | manual | 0 |
| **Execute rollback** | **not available in wrangler** (`pages deployment` offers only list/create/tail/delete) — dashboard only | **n/a** |
| Verify the rollback | re-list | 1 |

Concepts required: `Id` vs subdomain, Production vs Preview, that `Status` is a relative
time, that there are no timestamps, and that the list paginates at 25.

## Rapture workflow measured

| Task | Rapture | Reality |
|---|---|---|
| Deploy | `rapture deploy <svc> --revision <sha> --env <env>` | 1 call — but requires `experiments/deployment-api/config.json`, and the service source must be `repoRoot`. Failed on 3/3 Vercel attempts. |
| Status | `rapture deployment status <id>` | 1 call — terminal states only; nothing to poll |
| Find current | `rapture production current <svc>` | 1 call — **wrong on Cloudflare** |
| Find previous | included in the transition | 0 calls — correct on Vercel, null on Cloudflare |
| Choose rollback target | automatic | **genuine value on Vercel** |
| Execute rollback | `rapture rollback <svc> --to previous` | failed on both providers |
| Verify | native fetch → `production ingest --service` → `production build` → `production current` | **4 steps, including a native provider command and a provider-specific flag** |

---

## Provider concepts removed

- Deployment URL vs deployment ID selection at the call site.
- "Which of these list entries is the current production one" — on Vercel.
- The relative-time-means-success convention — once mapped.
- Provider-specific rollback target selection — on Vercel.

## Provider concepts still exposed

- The service's source repository and its location (fatal for rollback).
- `providerProject` per service, in a config file.
- `--service` on ingest, because wrangler omits the project.
- Cloudflare's `Id` capitalization and lack of timestamps.
- That Vercel supplies timestamps and Cloudflare does not — which silently determines
  whether `current` works at all.

---

## Deploy value verdict

**Negative.** Not merely command renaming — the canonical deploy is *less* capable than
native, because it cannot express which repository a service is built from. 3/3 Vercel
deploys failed. The 3 Cloudflare successes only demonstrate that Pages will upload whatever
directory it is given.

## Status value verdict

**Negative.** No intermediate states are observable, so canonical status reports only what
the deploy command already printed. Before the fix it actively fabricated `ready`. A status
API whose failure mode is confident wrongness is worse than no status API.

## Rollback value verdict

**Mixed, and net negative as implemented.** The *plan* is genuinely good: it resolves
current and previous, keeps `deploymentId` and `sourceRevision` distinct, and prints an
explicit transition before mutating. That is real safety value, and it is the only part of
this experiment that worked as advertised.

But execution failed on both providers, and the comparison is unforgiving: Vercel already
has one-command rollback that needs no source. Cloudflare has no CLI rollback — the one
place a canonical rollback would add real value — and that is exactly where `current`
returns a failed deployment. Rapture also implements rollback as *redeploy the previous
commit*, which is not a rollback: it rebuilds an artifact rather than reactivating a
known-good one.

---

## Scores

Scale 1–5, 5 best. "Abstraction leakage" scored so that 5 = no leakage.

| Dimension | Full Deployment API | Universal Rollback |
|---|---|---|
| Pain removed | 2 | 3 |
| Workflow compression | 2 | 3 |
| Provider knowledge removed | 2 | 3 |
| Safety gained | 2 | 3 |
| Agent usability | 2 | 3 |
| Human / platform-team usability | 2 | 3 |
| Abstraction leakage | 2 | 2 |
| Advantage over native workflow | 1 | 2 |
| **Mean** | **1.9** | **2.75** |

The rollback-only wedge scores materially higher than the full API — but it does not clear
the `RETHINK_ROLLBACK` bar, which requires rollback **verified on both providers**. It was
verified on neither.

---

## Strongest evidence supporting the product

The Vercel rollback plan, produced from real data after the link fix:

```
current:  invite-dndisek77-…vercel.app  @ ced2dfcbf27f1b41def06a76e10aae3691f4249d
previous: invite-f0icfpkfm-…vercel.app  @ 0703b8cecc363b0dfc58f9afa697384bf05bd462
```

Two distinct identity types, correctly resolved across 15 real deployments, with zero
provider-specific input at the call site and zero escape hatches in the type. A platform
engineer would have had to read a deployment list and reason about it manually; here it is
one command with an auditable plan. This primitive is real.

## Strongest evidence against the product

```
$ rapture deployment status totally-bogus-id-does-not-exist-0000 --json
{ "deploymentId": "totally-bogus-id-does-not-exist-0000", "status": "ready", ... }
```

A canonical API that reports `ready` for a deployment that has never existed is worse than
having no abstraction, because it is trusted. Alongside it: 14/14 dangling transition links,
24 of 25 records destroyed on ingest, and every re-ingested deployment filed under the wrong
service. None of this was visible from the code or the passing test suite — the tests were
green with fixtures throughout. **The abstraction was validated against fixtures that
encoded the same misunderstandings as the implementation.**

---

## Mandatory answers

**1. Would I use `rapture deploy` instead of native Vercel/Cloudflare deployment commands if
rollback did not exist? — NO.**
It cannot deploy the actual services. All 3 Vercel mutations failed because `DeployInput`
has no model of the service's source repository. Native deploy works today; this does not.

**2. Would I use canonical `status` alone? — NO.**
Zero intermediate transitions were observable across 6 real mutations, so it reports only
the terminal state the deploy command already printed. It fabricated `ready` for
nonexistent IDs until fixed, and Cloudflare's underlying signal is a relative timestamp with
no success vocabulary.

**3. Would I use `rapture rollback <service> --to previous` because it materially reduces
operational work/risk? — NO, as implemented.**
It failed on both providers. On Vercel, `vercel rollback <id> --yes` is one command, needs
no source, and works. The dry-run *plan* is worth keeping; the execution path is not.

**4. If deploy/status are removed, is rollback + deterministic state verification
independently strong enough to continue engineering? — NO.**
The planning primitive is the one thing that worked, but making it trustworthy requires:
a status-aware `current`; a deterministic ordering key that does not depend on
provider-supplied timestamps; one identity per physical deployment across the deploy and
ingest paths; and a source-acquisition model. That is a rebuild of the foundation, not a
wedge on top of it — and on the provider where it would matter most (Cloudflare), the
provider supplies neither timestamps, nor a project name, nor a rollback command.

---

## Final mechanical verdict

### `DEPLOYMENT_API_KILL`

Against the criteria:

- deploy/status are cosmetic-or-worse, and rollback is low-value where native already
  solves it and non-functional where it would not — **met**
- provider-specific caller knowledge remains substantial (source repo, `providerProject`,
  `--service`, `Id` casing, relative-time semantics) — **met**
- rollback cannot normalize honestly: `current` returns a **failed** deployment on
  Cloudflare, reproducibly — **met**
- Rapture adds as much or more operational complexity than it removes: verification requires
  a native fetch plus a provider-specific ingest flag plus a rebuild plus manual deletion of
  duplicate deploy-path records — **met**

`DEPLOYMENT_API_BLOCKED` was explicitly considered and **rejected**: real safe mutations
*were* completed. Six of them. The failures are inside the abstraction, not outside it.

`DEPLOYMENT_API_RETHINK_ROLLBACK` was considered and **rejected**: it requires rollback
verified on both providers, and rollback executed on neither.

### Final checks

`pnpm build` 6/6 · `pnpm typecheck` 6/6 · `pnpm -r test` **175 passed** (159 + 16 new) ·
no credentials or secrets in tracked files · evidence sanitized and confined to gitignored
`.rapture/`.
