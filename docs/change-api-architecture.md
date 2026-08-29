# Rapture Software Change API V0 — Architecture Note

**Date:** 2026-08-29
**Status:** Pre-implementation, Phase 0 audit
**Goal:** Smallest real V0 that proves/disproves canonical Change object across GitHub, Actions, Vercel, Sentry, Linear.

## 1. Repository Audit

**Current packages:**
- `packages/kernel` — generic, reusable: `checker/validation`, `evidence/artifacts` (safe paths, sha256, redact, immutable writes), `evidence/integrity`, `journal/jsonl`, `process/run`, `receipts`, `types`. No product assumptions. **Reuse:** validation, hashing, redact, safeArtifactPath, writeJsonArtifact, jsonl.
- `packages/core` — product-specific: scenario/world lifecycle for subscription-seat-upgrade. Not relevant to Change API. **Do not reuse** for new product; keep isolated, don't delete.
- `packages/profiler` — agent compute profiler: `schema`, `storage` (.rapture/runs), `normalize`, `analysis`, `artifact`, `economics`, `trajectoryExperiment`. Contains useful patterns for filesystem-first storage and deterministic joins, but domain is agent ops, not software changes. **Reuse pattern** (storage layout, runId, provenance) not code.
- `apps/cli` — `scenario list`/`run`, `profile`, `runs`, `analyze`, `experiment`. Conventions (human + --json output, exit codes, `CliIo` for testing) reusable. Will extend, not replace.
- `experiments/*` — phase0b/c/d manifests and results. Historical, keep but not reused.

**Obsolete assumptions to isolate:**
- Subscription business-state diff, scenario registry — not dragged into Change API.
- Agent-specific `profiler` operation taxonomy — not reused for Change domain.
- No deletion of major functionality; new product lives in parallel.

## 2. Proposed Package/Module Boundaries

```
packages/change/                 # NEW — Software Change API V0
  src/
    schema/                      # Canonical domain model, versioned, strict TS
      change.ts                  # Change, Intent, PullRequest, Commit, Check, Artifact, Deployment, ProductionEffect, Relationship, Provenance
      version.ts                 # SCHEMA_VERSION = "1"
    adapters/
      contracts.ts               # ProviderAdapter interface, CanonicalRecord, RawSnapshot
      github.ts                  # Repos, PRs, commits, mergeCommitSha
      github-actions.ts          # Workflow runs, check runs, headSha
      vercel.ts                  # Deployments, env, commit/source metadata
      linear.ts                  # Issue id/title/description, branch/PR linkage
      sentry.ts                  # Releases/issues where deterministic
    joins/
      rules.ts                   # Deterministic join rules, provenance per relationship
      builder.ts                 # ChangeBuilder: from stored provider records → Change[]
    store/
      storage.ts                 # Filesystem-first .rapture/change/{raw,canonical}, reproducible
      index.ts                   # list/get/findBy* , trace()
    api/
      changes.ts                 # Library API: get, findByCommit, findByPR, findByDeployment, findByIntent, trace
    cli/
      change-cli.ts              # ingest, build, list, show, trace (human + --json)
  test/
    schema.test.ts
    adapter-*.test.ts
    join-*.test.ts
    storage.test.ts
    api.test.ts
    cli.test.ts
```

**Alternative considered:** Separate packages `change-core`, `change-adapters`, `change-store`. Rejected for V0 — single package `packages/change` is smallest that still isolates provider from canonical (adapters import schema, not vice versa; store imports schema; CLI imports api/store). Allows future split without breaking.

**Existing reuse:**
- `@rapture/kernel` for `sha256`, `safeArtifactPath`, `writeJsonArtifact`, `redactSecrets`, `Validation` helpers
- `apps/cli` conventions (`CliIo`, `main(argv,io)`, `vitest.config.ts` pattern)
- `tsconfig.base.json`, `biome.json` strict TS

**New dependencies:** None (use `node:fs`, `node:crypto`, `execa` already in kernel). No Postgres/Redis, no graph DB, no LLM.

## 3. Canonical Model Isolation

- Core schema lives in `schema/` with no `import` from `adapters/`.
- Adapters export `toCanonical(raw): CanonicalRecord[]` and never import `Change` directly except via `schema`.
- Relationships carry `provenance: { rule: string, sourceIds: string[], constructedAt: string }`.
- Unknowns remain `null`/`undefined`, never fabricated.
- `SCHEMA_VERSION` additive, backward-compatible.

## 4. Storage Strategy

- Root: `.rapture/change/` (parallel to `.rapture/runs/`, not overlapping)
- `raw/<provider>/<id>.json` — raw provider snapshots, distinguishable from canonical
- `canonical/<changeId>.json` — reproducible Change objects, with `provenance.sources[]` and `schemaVersion`
- `index.json` — lightweight index for `list`/`trace` lookups (commit→change, pr→change, etc.)
- Use `writeJsonArtifactIfAbsent` / `writeJsonArtifactOverwrite` from kernel for immutability where needed; `SCHEMA_VERSION` persisted.

## 5. CLI & Library

- Library `packages/change/src/api/changes.ts` is primary interface; CLI is thin wrapper.
- CLI commands `rapture change ingest <provider>`, `build`, `list`, `show <id>`, `trace <identifier>` — human + `--json`, non-zero only on error, unknown links shown explicitly.
- API `changes.get(id)`, `findByCommit(sha)`, `findByPullRequest(provider, repo, number)`, `findByDeployment(provider, id)`, `findByIntent(provider, externalId)`, `trace(identifier)` — small surface, no network server.

## 6. Join Rules (deterministic)

- `PR.mergeCommitSha ↔ Commit.sha` (GitHub)
- `Check.headSha ↔ Commit.sha` (Actions)
- `Deployment.commitSha` (Vercel `source.gitCommitSha` or `meta.githubCommitSha`) `↔ Commit.sha`
- `Sentry release` `commit`/`version` ↔ `Commit.sha` or `Deployment.commitSha` where deterministic
- `Linear issue` ↔ `PR` via branch name `feat/ENG-123` or PR title/body `Fixes ENG-123` or explicit link — only explicit, no timestamp proximity.

Each rule documented in `joins/rules.ts` with `provenance.rule`.

## 7. Testing Strategy

- Schema validation, adapter contract, fixture normalization
- Join tests per rule + no-false-join (close timestamps but different SHAs must not join)
- Provenance tests, unresolved tests, JSON stability
- No LLM

## 8. Validation Plan

- Use `wiramahendra/rapture` (or other authorized repo) with GitHub+Vercel+Sentry+Linear where available.
- Pick 3-5 historical changes with known PR+CI+deployment linkage, manually verify each relationship, record unresolved.

## 9. Risks & Non-Goals

- Not building graph DB, dashboard, billing, hosted SaaS, GitLab/Jira adapters, AI reasoning.

