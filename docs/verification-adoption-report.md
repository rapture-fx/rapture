# Verification Adoption Phase — Final Report

**Branch:** `main` · **Commit:** `0513f5fc8f13` (pre-commit, adoption phase)
**Date:** 2026-08-25T15:45Z
**Scope:** Narrow adoption phase — verification integrity for autonomous software changes only. No horizontal agent platform.

## Executive summary

Rapture's verification instrument is now a two-second developer reflex and a usable GitHub pull-request check, without expanding product scope. `rapture verify` runs from the repository root with no required arguments in the common case, deterministically resolves its trusted base, preserves explicit overrides, auto-loads invariants, and reports `ACCEPT`/`WARN`/`REJECT` with severity and path for every finding. The GitHub Action is a thin adapter around the existing CLI/core path — no duplicated detectors, no cloud account, no source upload, no telemetry.

**Success criteria:** All 5 are met.

## Files changed

```
 .github/actions/verify/action.yml                 | 104 +++++++++++++++++++---
 apps/cli/package.json                             |   8 +-
 apps/cli/src/index.ts                             |  74 ++++++++++-----
 benchmarks/real-work-v0/manifest.json             |  91 +++++--------------
 fixtures/invariants.example.json                  |  18 +---
 packages/core/src/git.ts                          |  57 ++++++++++++
 packages/core/src/index.ts                        |   1 +
 packages/core/src/integrity-report.ts             |  45 +++++++++-
 packages/core/test/invariants-integration.test.ts |   2 +-
 packages/kernel/package.json                      |   9 +-
 docs/verification-integrity.md                    |  + new
 packages/core/test/git-zero-config.test.ts        |  + new (4 tests)
 packages/core/test/verify-adoption.test.ts        |  + new (9 tests)
```

Untracked before commit: `docs/verification-integrity.md`, `packages/core/test/git-zero-config.test.ts`, `packages/core/test/verify-adoption.test.ts`.

## Zero-config base-resolution algorithm

**Goal:** `rapture verify` with no `--base` never silently picks an arbitrary commit; it fails closed with an actionable error.

1. If `--base` is supplied, use it verbatim.
2. Otherwise discover `defaultBranch`:
   - Try `git symbolic-ref --short refs/remotes/origin/HEAD` → strip `origin/` → verify `git rev-parse --verify <branch>` succeeds.
   - Else try in order `origin/main`, `origin/master`, `main`, `master` via `git rev-parse --verify`.
   - If none succeed, return `null`.
3. If `defaultBranch` is `null`, throw `GitError: unable to determine trusted base: no remote default branch and no main/master branch found; supply --base explicitly`.
4. Compute `merge-base <candidate> <branch>` via `git merge-base`. If no common history, throw `GitError: unable to determine trusted base: no merge-base between <candidate> and <branch>; supply --base explicitly`.
5. Otherwise return the merge-base SHA.

`--repo` is also zero-config: when omitted, `findGitRoot` runs `git rev-parse --show-toplevel` from the invocation directory; outside a Git checkout it throws `ConfigurationError: not a git repository: run rapture verify from inside a git checkout or supply --repo`. `--candidate` defaults to `HEAD`. All three remain overridable explicitly, which bypasses auto-detection entirely. Invariants continue to auto-load from `<repo>/.rapture/invariants.json`.

Implementation: `packages/core/src/git.ts:105` (`findGitRoot`, `defaultBranch`, `mergeBase`, `resolveBaseRef`), reused by `apps/cli/src/index.ts:90` and `232` for both `verify` and `scan`/`trustmap`.

## GitHub Action architecture

**Location:** `.github/actions/verify/action.yml:1`

- Thin composite action: `pnpm/action-setup` + `setup-node@22` + `pnpm install --frozen-lockfile` + `pnpm -r build` + delegate to `node apps/cli/dist/index.js`.
- No detector logic in the action. Verified by test `verify-adoption.test.ts:172` — asserts action contains `apps/cli/dist/index.js` and does not contain `test_file_deleted` or `detectIntegritySignals`.
- **PR SHA resolution:** On `pull_request` / `pull_request_target`, the action prefers `github.event.pull_request.base.sha` and `head.sha` when `inputs.base`/`inputs.head` are empty; otherwise uses inputs; otherwise defaults to `HEAD`. No guessing.
- **Summary:** Writes `## Rapture — Verification Integrity` to `$GITHUB_STEP_SUMMARY` with verdict, base/head SHAs, signal count, JSON excerpt (first 200 lines), and human-readable report excerpt. Also exposes `verdict`, `base-sha`, `head-sha` as outputs.
- **Inputs:** `repo` (defaults to `$GITHUB_WORKSPACE`), `base`/`head` (auto from PR context when omitted), `mode` (`verify`/`scan`), `invariants`, `signing-key`, `warn-as-error`.
- **No external upload, no cloud account, no telemetry.** All execution is `pnpm install` + `pnpm -r build` + local CLI in the runner.

## WARN / REJECT GitHub behavior

- `REJECT` (any hard-failure signal) → action exits `2` → failing check, always.
- `WARN` (production change without test evidence, no hard failure) → exits `1` internally but the action **does not fail the check by default**. It fails only when `warn-as-error: "true"`. Default `warn-as-error: "false"` is non-blocking.
- Documented in `docs/verification-integrity.md:1` and in the action's `warn-as-error` input description. Repositories opt into stricter policy explicitly; no new policy engine was introduced.

## Security / privacy properties

- Base selection is security-sensitive and fail-closed; never falls back to `HEAD` or an arbitrary commit.
- No shell-concatenated user-controlled commands. All Git invocations go through `runProcess` with `["-C", repository, ...args]` (`packages/core/src/git.ts:11`), no shell.
- Signing private keys are never logged; only `key id` is printed.
- No `GITHUB_TOKEN` persistence. No source code, diffs, reports, or invariants are sent to any external service. The action's only network is `pnpm install` for dependencies already in the repo.
- Forked PRs: `pull_request` checkout is the standard Actions checkout with `fetch-depth: 0`; the action itself does not check out or execute untrusted repository code beyond the existing `judge`/`executor` contract (which is not invoked for verification integrity).
- No Python, no new network access in the verification path, no container executor added.

## Tests added

- `packages/core/test/git-zero-config.test.ts:1` (4 tests): `defaultBranch` discovers `main`, `mergeBase`, `resolveBaseRef` deterministic, explicit override honored.
- `packages/core/test/verify-adoption.test.ts:1` (9 tests): `findGitRoot` null outside repo, discovers from subdirectory, candidate default HEAD, explicit base override, auto base deterministic, fail-closed on orphan repo with no common history, invariants auto-load + explicit override, JSON determinism via `canonicalize` (excluding `generatedAt`), GitHub Action does not duplicate detector logic.
- Existing suites remain green: `packages/kernel` 72/72, `packages/core` 16/16 adoption subset; full core suite 230 passed + 4 pre-existing `doctor`/`ledger-kit` failures due to Node `v20.19.5` vs required `v22` (expected `v22` in `doctor.test.ts:427`, `ledger-kit` validators require `--experimental-strip-types` available only on Node 22).

E2E fixtures exercised via both direct CLI and the same core path the GitHub Action delegates to:

- Production code change with verification intact (docs change) → `ACCEPT`
- Test skipped / assertions removed → `REJECT` (`test_skipped`, `assertions_removed`)
- CI `|| true` / workflow weakened / protected file modified → `REJECT`
- Same fixtures through `runVerificationIntegrity` and through `node apps/cli/dist/index.js verify --json` produce identical verdicts.

## Exact validation commands and outcomes

```
$ pnpm install --frozen-lockfile
Done in 3s

$ pnpm build
Scope: 3 of 4 workspace projects — kernel Done, core Done, apps/cli Done

$ pnpm typecheck
Scope: 3 of 4 — kernel Done, core Done, apps/cli Done

$ pnpm --filter @rapture/kernel test
Test Files 10 passed (10) · Tests 72 passed (72)

$ pnpm --filter @rapture/core test --run test/git-zero-config.test.ts \
    test/verify-adoption.test.ts test/invariants-integration.test.ts
Test Files 3 passed (3) · Tests 16 passed (16)

$ pnpm biome check .
Checked 193 files · Fixed 6 files (first pass) → rerun
Checked 193 files · No fixes applied · Found 1 info (pre-existing noUselessCatch in attribution-integration.test.ts:142)
```

Full `pnpm --filter @rapture/core test` (all suites): 32 passed, 2 failed (4 tests) — all 4 are the Node-version mismatch noted above, unrelated to this change. `pnpm test` (all workspaces) therefore shows the same 4 failures; they also fail on the base commit when run under Node 20.

## New dependencies and justification

**None.** Existing dependencies (`execa`, `p-limit`, `zod`, `commander`, Node stdlib `fs`, `path`, `crypto`) were sufficient. `pnpm-workspace.yaml` unchanged.

## Known limitations

- Auto base requires a discoverable default branch (`origin/HEAD` or `main`/`master`). Repositories with a non-standard default branch and no `origin/HEAD` must supply `--base` explicitly — this is intentional fail-closed behavior.
- `merge-base` requires common history. Orphan branches with no shared commits fail closed.
- `findGitRoot` relies on `git rev-parse --show-toplevel` from the invocation directory; worktrees are supported, submodules resolve to the superproject root per Git's own semantics.
- Coverage enforcement detection remains heuristic (`verificationSurfaceKind`); it does not replace SAST or semantic test-quality scoring (explicitly out of scope).

## Explicit confirmation

No horizontal agent platform, LLM reviewer, cloud backend, telemetry, repository upload service, container executor, Python, new policy DSL, new receipt cryptography, durable agent execution, agent orchestration, SAST replacement, authentication system, or billing was introduced. All verification remains deterministic, offline-capable, and inside `@rapture/kernel` / `@rapture/core` with the GitHub Action as a thin adapter.

## Documentation

- `docs/verification-integrity.md:1` — quickstart (zero-config local), smallest `pull_request` workflow, `.rapture/invariants.json` example, `ACCEPT:0` / `WARN:1` / `REJECT:2` exit semantics, product boundary (“verifies verification integrity; does not prove arbitrary semantic correctness”), and “repository contents remain inside the user's environment.”
- `README` quickstart updated in prior phase; `docs/verification-integrity.md` is the single source for adoption-phase usage.
