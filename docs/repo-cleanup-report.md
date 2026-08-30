# Repository cleanup report

**Date:** 2026-08-30
**Branch:** `main` (no history rewrite, no force-push, nothing pushed)
**Range:** `da0d66e` → HEAD (6 new commits; last code change at `5a3c265`)

---

## Executive summary

Rapture had accumulated five product hypotheses, all of them now answered, and a
tree that did not admit it. Four product-shaped packages sat alongside the two
maintained ones with no visible distinction; the `rapture` CLI still exposed
`deploy`, `rollback`, `change`, and `production` commands for bets that had been
killed; the README described an active product; and 27 files of mixed experiment
residue and formatting churn sat uncommitted on top of a `DEPLOYMENT_API_KILL`
commit.

This cleanup made the tree honest without discarding anything that carries a
lesson:

- **Preserved and unchanged:** `packages/kernel`, `packages/core`. 51 tests, all
  passing. No behavior changes.
- **Archived to `archive/packages/*`:** `change`, `production-change`,
  `profiler`, `verification-surface`. Moved with `git mv` (tracked as renames),
  kept as workspace members so their 135 tests still run, and marked
  `HISTORICAL` in each `package.json`.
- **Demoted:** the CLI surface is now exactly `scenario list` and `run`.
- **Documented:** `docs/closed-bets.md` records all five bets with verdicts,
  evidence pointers, and explicit do-not-revive conditions.
- **Resolved:** working tree is clean; the mixed churn was split into
  substantive-vs-format commits.

Build, typecheck, and all 191 tests pass. No new product direction was started.

---

## Git state before / after

### Before

```
HEAD      da0d66e  Deployment API V0: real mutation experiment — DEPLOYMENT_API_KILL
Branch    main, 1 commit ahead of origin/main (unpushed)
Stash     empty
Modified  27 tracked files (change, production-change, profiler, .gitignore, pnpm-lock)
Untracked .claude/, CLAUDE.md, docs/verification-surface-phase-a-b-report.md,
          packages/verification-surface/
```

### After

```
HEAD      (this report)  docs: add repo cleanup report
          5a3c265  Close five product bets: archive dead surfaces, keep kernel/core
          5ec25d4  chore(format): apply Biome formatting to change, production-change, profiler
          0380413  Deployment API V0 residue: real-wrangler Cloudflare parsing + test typecheck fixes
          8c96f50  Verification-Surface Phase A/B: 50 merged agent PRs — VERIFICATION_SURFACE_KILL
          8ad7735  chore(repo): check in Claude Code project config and repo guide
          da0d66e  (previous HEAD)
Branch    main, 7 commits ahead of origin/main — NOT PUSHED
          (6 from this cleanup + the pre-existing unpushed da0d66e)
Worktree  clean
```

No pre-existing commit was amended, rebased, or dropped, and nothing was
force-pushed. `da0d66e` and everything below it is byte-identical.

The one exception, stated for completeness: the HEAD commit carrying *this
report* was amended in place while finalizing the file (the report quotes its
own commit range, so the first two hashes went stale). It was never pushed, and
no other commit was touched.

---

## Preserved engineering

| Path | Why |
|---|---|
| `packages/kernel` | The durable asset. Shell-free argv exec, append-only fsynced JSONL journal, safe artifact paths, secret redaction, SHA-256, tree integrity manifests, Ed25519/DSSE receipts. 40 tests. |
| `packages/core` | Scenario/world lifecycle, result model, path-level state diff, registry, reference scenario. 11 tests. |
| `apps/cli` | `scenario list` and `run`. 5 tests. |
|  `docs/*-report.md` (12 files) + 2 audit notes | Experiment evidence. **Not edited** — these are the record that justifies every kill. |
| `experiments/phase0b,0c,0d` | 18 tracked manifests, task definitions, run orders, and result JSON backing the reports. |
| `HISTORY.md`, `docs/architecture.md`, `docs/migration-inventory.md` | Transition history and frozen-tag pointers; appended to, not rewritten. |

The strongest argument for keeping the kernel is in the archived code, not in the
kernel's own tests: five independent product attempts built on `sha256`,
`safeArtifactPath`, `redactSecrets`, and the durable journal, and **none of them
required the kernel to change** to accommodate a provider or a product shape.

---

## Archived / demoted product code

Moved with `git mv` — full history preserved, tracked as renames.

| From | To | Verdict |
|---|---|---|
| `packages/change` | `archive/packages/change` | `SOFTWARE_CHANGE_API_RETHINK` |
| `packages/production-change` | `archive/packages/production-change` | `PRODUCTION_CHANGE_BLOCKED` / `DEPLOYMENT_API_KILL` |
| `packages/profiler` | `archive/packages/profiler` | `PHASE_0D_KILL` |
| `packages/verification-surface` | `archive/packages/verification-surface` | `VERIFICATION_SURFACE_KILL` |

**They remain pnpm workspace members** (`archive/packages/*` glob). This was a
deliberate choice over workspace exclusion: excluded packages rot silently, and
keeping them in costs one build step while guaranteeing the archived code still
compiles and its 135 tests still pass. `archive/README.md` and each
`package.json` description state plainly that this is not maintenance.

Supporting changes:

- Each archived `package.json` gained `"private": true` and a `HISTORICAL (...)`
  description, so none can be published by accident.
- Archived `tsconfig.json` / `tsconfig.test.json` now extend
  `../../../tsconfig.base.json` — archived packages sit one level deeper.

### CLI demotion

`apps/cli/src/cli.ts` went from 301 lines to 59. Removed: `change`,
`production`, `deploy`, `deployment status`, `rollback`, `profile opencode`,
`runs list`, `runs show`, `analyze`, `experiment run`, plus the `handleProfile`
helper and `repoRoot()`. Dropped the `@rapture/profiler`, `@rapture/change`, and
`@rapture/production-change` dependencies.

Deleted `apps/cli/test/cli.profiler.test.ts` (8 tests). Those tests covered
CLI wiring for a killed surface; they were removed with the surface rather than
left asserting behavior that no longer exists. The code is recoverable from
`5ec25d4` and earlier.

Verified behavior after the change:

```
$ rapture scenario list                      → exit 0, lists the one scenario
$ rapture run subscription-seat-upgrade      → exit 0, RESULT: PASS
$ rapture change list                        → exit 2, prints usage
$ rapture deploy foo                         → exit 2, prints usage
```

### Documentation demoted

Historical banners added to the five design docs that described killed
directions as current: `docs/profiler.md`, `docs/change-api-architecture.md`,
`docs/production-change-architecture.md`, `docs/deployment-api-semantics.md`,
`docs/instrumentation-note.md`.

The 12 `*-report.md` experiment reports and 2 audit notes were **not touched**. They are evidence,
and several of them are the only reason a `BLOCKED` verdict can be distinguished
from a failure.

---

## Closed bets summary

Full detail, with do-not-revive conditions, in `docs/closed-bets.md`.

| Bet | Thesis | Verdict | Decisive evidence |
|---|---|---|---|
| Agent compute profiling | Agent runs repeat enough work to justify a reuse layer | `PHASE_0D_KILL` | 0C: working-set treatment made things *worse* (file reads +20%, duration +15.7%) across 30 paired runs. 0D: waste <15% with no dominant class across 46 runs × 3 models; report's own recommendation was "do not productize". |
| Software Change API | A canonical cross-vendor `Change` beats a Git SHA | `SOFTWARE_CHANGE_API_RETHINK` | 5 real changes. Git SHA + PR merge SHA already gives ~80%; 3 of 5 integrated systems had no deterministic linkage. |
| ProductionChange | Runtime identity generalizes across providers | `PRODUCTION_CHANGE_BLOCKED` | Validated on 1 provider (15 real Vercel deployments, 100% source linkage). Acceptance needed 2. Four attempts (V1, V1B, V1B-retry, V1C) found no second real runtime; each reported BLOCKED rather than claiming fixture-backed validation. |
| Deployment API | A canonical deploy/status/rollback beats native CLIs | `DEPLOYMENT_API_KILL` | Not blocked — 6 real production mutations ran. 8 defects, 2 dangerous: `status` returned `ready` for a nonexistent deployment ID, and every `previousProductionChangeId` was dangling, so rollback had never worked on real data. Deploy failed 3/3 on Vercel; 0 intermediate state transitions observable; rollback impossible on both providers. |
| Verification-surface | Agent PRs measurably weaken verification | `VERIFICATION_SURFACE_KILL` | 0% prevalence across 50 merged agent PRs, 30 repos, 6 agent identities, 96 verification-relevant files. Detector: 1 FP / 0 TP, then 0 positives after tuning — precision undefined, not high. |

The `VERIFICATION_SURFACE_KILL` caveat is preserved deliberately: the corpus can
only observe PR-submitting bots, while the motivating incidents came from
interactive local sessions. The bet is closed; the underlying question is not
refuted, and reopening it would need a different observation surface rather than
a better detector.

---

## Working tree / formatting / unpushed commit resolution

27 modified files sat uncommitted on top of the `DEPLOYMENT_API_KILL` commit,
mixing real experiment code with Biome reflow from the project's format-on-edit
hook. Rather than guess, each file was classified mechanically — reformat the
committed version with the repo's own Biome config and compare to the working
copy:

- **23 files: format-only.** Byte-identical to `biome format` applied to their
  previous contents.
- **4 files: substantive.**

The churn was then split so neither commit hides the other:

| Commit | Contents |
|---|---|
| `8ad7735` | `.claude/` project config (format-on-edit hook, verify skill), `CLAUDE.md`, `.gitignore` rule for `settings.local.json` |
| `8c96f50` | `packages/verification-surface` + its report + lockfile entry — the killed bet's code and evidence |
| `0380413` | The 4 substantive files: real-wrangler Cloudflare parsing, plus unused-import/cast/`noUnusedLocals` fixes in two test files |
| `5ec25d4` | The 23 format-only files, stated as such |
| `5a3c265` | The archive restructure |

The one real logic change — `cloudflare.ts` learning the actual
`wrangler pages deployment list` payload shape (PascalCase keys, `Source` as a
bare short SHA, relative-time `Status` strings) — was committed rather than
reverted, because it is the artifact of the Deployment API experiment making
contact with a real provider. Reverting it would have left the report asserting
a finding the tree could no longer reproduce.

**Nothing was pushed.** `main` is 7 commits ahead of `origin/main` — the 6 above plus the pre-existing unpushed `da0d66e`.

---

## Secrets and experiment artifact handling

**Secret scan.** Swept the full tree (excluding `node_modules`, `.git`,
`.rapture`, `dist`) for GitHub PATs, OpenAI keys, Slack tokens, AWS access key
IDs, PEM private keys, and bearer tokens. **Six matches, all benign:** four are
redaction *test fixtures* in `packages/kernel/test/artifacts.test.ts` and
`archive/packages/profiler/test/profiler.test.ts` (asserting that `ghp_…` and
`sk-…` are redacted), and two are documentation describing the redaction
regexes. No live credential is committed.

This is consistent with the repo's design: no env vars are required anywhere,
there is no `.env.example`, and no credential input path exists.

**Artifacts.**

- `.rapture/` (59 MB of generated run directories, ingested provider payloads,
  and experiment output) was already gitignored and remains untracked. It is the
  raw material; `docs/*-report.md` is the durable record.
- `.claude/settings.local.json` (personal MCP config) is now gitignored; the
  shared `.claude/settings.json` is tracked.
- `experiments/` keeps its existing allowlist gitignore: phase0b/0c/0d manifests
  and results are tracked (18 files, 84 KB max); everything else — including
  `experiments/deployment-api/config.json` and `experiments/manifest.example.json`
  — stays local. The deployment config contains only public project and repo
  names, no credentials.
- `biome.json` now excludes `.rapture/**`, which was generated output being
  linted as if it were source.

---

## Build / typecheck / test results

All run from a clean tree at `5a3c265` (the last commit to touch code).

| Step | Result |
|---|---|
| `pnpm build` | **Pass** — 7 projects |
| `pnpm typecheck` | **Pass** — 7 projects, both `tsconfig.json` and `tsconfig.test.json` passes each |
| `pnpm test` (root: maintained only) | **Pass** — 56 tests |
| `pnpm -r test` (all, incl. archive) | **Pass** — 191 tests, 15 files, 0 failures |
| `pnpm check` (`biome check .`) | **30 errors — pre-existing, see below** |

Test breakdown:

| Package | Tests | Status |
|---|---|---|
| `packages/kernel` | 40 | pass |
| `packages/core` | 11 | pass |
| `apps/cli` | 5 | pass (was 13; 8 removed with the killed CLI surface) |
| `archive/packages/profiler` | 60 | pass |
| `archive/packages/production-change` | 30 | pass |
| `archive/packages/verification-surface` | 24 | pass |
| `archive/packages/change` | 21 | pass |
| **Total** | **191** | **pass** |

### Lint

`biome check .` was already failing before this cleanup and still fails, but the
surface shrank substantially:

| | Files checked | Errors |
|---|---|---|
| Before | 741 | 296 |
| After | 122 | 30 |

The reduction came from excluding generated `.rapture/**` output, not from
rewriting code. Of the 30 remaining, **all are `lint/complexity/useLiteralKeys`
in four archived `change` adapter files**. They were left alone deliberately:
the rule wants `data.version` where this repo writes `data["version"]` as a
convention forced by `noUncheckedIndexedAccess`, Biome marks the fix "unsafe",
and rewriting frozen archived code is exactly the side quest `CLAUDE.md` warns
against.

The **maintained tree is lint-clean**: `biome check apps packages .claude`
reports zero diagnostics across 42 files. The two findings in files this cleanup
touched (`apps/cli/src/cli.ts` formatting, a `useTemplate` in the format hook)
were fixed.

---

## Residual risks and follow-ups

1. **CI is red on its last step, as it was before.** `.github/workflows/ci.yml`
   ends with `pnpm biome check .`, which exits non-zero on the 30 archived
   `useLiteralKeys` errors. This predates the cleanup. Two clean options, both
   needing a decision this cleanup did not have standing to make: apply Biome's
   unsafe autofix to the four archived adapter files, or add a `biome.json`
   override disabling `useLiteralKeys` under `archive/**`. Suppressing the rule
   is more consistent with the repo's deliberate bracket-access convention.

2. **`archive/` is linted and built but not maintained.** If a future TypeScript
   or Biome upgrade breaks archived code, CI will fail on code nobody intends to
   fix. The escape hatch is dropping `archive/packages/*` from
   `pnpm-workspace.yaml`, which freezes it completely at the cost of silent rot.

3. **`archive/packages/production-change/src/deployment/vercel.ts` still runs
   `git checkout <sha>` in the repo root** and mutates the live working tree. It
   is no longer reachable from the CLI, but it is reachable from a test or an
   import. Noted in `archive/README.md` and `CLAUDE.md`. It was left as-is
   because it is part of the `DEPLOYMENT_API_KILL` evidence.

4. **`docs/deployment-api-semantics.md` hardcodes
   `experiments/deployment-api/config.json`**, which is gitignored and exists
   only locally. A fresh clone cannot reproduce that experiment. Acceptable for
   archived code; worth knowing before anyone tries.

5. **Nothing is pushed.** `main` is 7 commits ahead of `origin/main` (6 from this
   cleanup, plus `da0d66e` which was already unpushed). Pushing was not requested
   and was not done.

6. **The `SOFTWARE_CHANGE_API_RETHINK` verdict is recorded as closed, not
   pending.** The original report proposed a narrower V1 scope. That narrowing
   was never pursued and the vendor-normalization line is closed, so
   `docs/closed-bets.md` files it under closed bets with a do-not-revive
   condition. If the intent was to keep it open, that entry is the one to
   revisit.

---

## Confirmation: no new product direction started

No new product thesis was invented. No features, adapters, detectors, providers,
or commands were added. No killed bet was revived. No experiment report was
edited or deleted, and no history was rewritten or force-pushed.

The only net-new files are documentation — `docs/closed-bets.md`,
`archive/README.md`, and this report — plus a rewritten `README.md`. Every code
change was a move, a deletion of a dead surface, a path fix required by a move,
or a lint fix in a file this cleanup touched.

The repository now presents itself as what it is: a small set of tested
integrity primitives, one reference scenario, and an honest record of five
product bets that were tried against real data and closed.
