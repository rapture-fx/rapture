# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm 10.12.1 monorepo (`apps/*`, `packages/*`), TypeScript ESM only, vitest, Biome.

- `pnpm -r test` — **use this, not `pnpm test`.** The root `test` script runs only the maintained packages (kernel, core, cli); `-r` additionally covers `archive/packages/*`.
- `pnpm typecheck` — per package this is two passes: `tsc -p tsconfig.json --noEmit` then `tsc -p tsconfig.test.json --noEmit`. The build `tsconfig.json` sets `rootDir: src` and excludes `test/`, so test files are only typechecked by the second pass. Every package has a `tsconfig.test.json` for this reason.
- `pnpm check` — `biome check .` (lint + format + import assists). CI runs it.
- Single test: `pnpm --filter @rapture/profiler test -- test/phase0c.test.ts`, or `-- -t "substring"`.

`archive/packages/change` and `archive/packages/production-change` import `@rapture/kernel` at runtime and their `vitest.config.ts` has **no src alias** (unlike core/cli), resolving through `exports.import` → `dist/`. Run `pnpm build` before their tests on a clean checkout.

Archived packages sit one level deeper than `packages/*`, so their `tsconfig.json` extends `../../../tsconfig.base.json` (three levels, not two).

CI (`.github/workflows/ci.yml`, node 22): install → `pnpm build` → `pnpm typecheck` → `pnpm test` → `pnpm biome check .`.

## Code style

Biome is the only formatter/linter — no prettier, no eslint. Non-default settings in `biome.json`: `lineWidth: 100`, double quotes, always semicolons, trailing commas everywhere, and `noExplicitAny` promoted to error.

`tsconfig.base.json` is stricter than `strict` alone. The two that change how you write code:
- `verbatimModuleSyntax` — type-only imports must use `import type`, and relative imports need explicit `.js` extensions.
- `noUncheckedIndexedAccess` — index access is `T | undefined`, which is why the code reads `process.env["HOME"] ?? ""` rather than `process.env.HOME`.

Also on: `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`/`noUnusedParameters` (relaxed for tests in `change`/`production-change` only), `NodeNext` resolution.

## Packages

**Maintained:**
- `packages/kernel` — product-neutral primitives: shell-free argv exec, append-only fsynced JSONL journal, safe artifact paths + redaction + SHA-256, tree manifests, optional Ed25519/DSSE receipts.
- `packages/core` — scenario/world lifecycle (prepare/seedOrRestore/run/observe/disposeOrReset), result model, state diff, registry.
- `apps/cli` — the `rapture` binary, hand-rolled argv parsing in `apps/cli/src/cli.ts`. Surface is exactly `scenario list` and `run`.

**Historical — `archive/packages/*`, code from closed product bets.** Still pnpm workspace members (`archive/packages/*` glob), so they build, typecheck, and test — deliberately, so they do not rot. They are **not** an active direction and are not wired into the CLI. Do not add adapters, detectors, providers, or commands here.
- `archive/packages/change` — canonical `Change` object, adapters (github, github-actions, vercel, sentry, linear), deterministic joins, filesystem store. `SOFTWARE_CHANGE_API_RETHINK`.
- `archive/packages/production-change` — runtime-identity primitive with vercel/cloudflare/kubernetes adapters, plus the deployment surface. `PRODUCTION_CHANGE_BLOCKED` / `DEPLOYMENT_API_KILL`.
- `archive/packages/profiler` — deterministic profiler for OpenCode agent tasks; see @docs/profiler.md. `PHASE_0D_KILL`.
- `archive/packages/verification-surface` — verification-weakening detector for merged agent PRs. `VERIFICATION_SURFACE_KILL`.

Before reopening any archived line, read @docs/closed-bets.md — each bet has an explicit do-not-revive condition. Architecture notes live in `docs/`; @docs/architecture.md is the entry point.

## Gotchas

- **`archive/packages/production-change/src/deployment/vercel.ts` runs `git checkout <sha>` in the repo root** and checks back out afterward with `reject: false`. It mutates the live working tree — do not invoke it casually.
- Deployment config path is hardcoded: `loadConfig()` defaults to `experiments/deployment-api/config.json`.
- Some code paths shell out to external binaries that may not be installed: `opencode`, `vercel`, `wrangler`, `git`.
- `packages/core/dist/` holds stale artifacts from a previous product (`doctor`, `frozen`, `benchmark`, `attribution`, `badge`) with no `src/` counterpart. `dist/` is gitignored — grep hits there are misleading.
- `.rapture/` is gitignored but locally populated with many generated run dirs, and `biome.json` does *not* exclude it. Expect grep/glob noise and Biome diagnostics from it.
- No env vars are required anywhere. The only `process.env` use is in `packages/profiler/src/profiler.ts`. There is no `.env.example` and no credential input by design.

## Repo state

`pnpm check` currently reports ~125 errors (mostly `useLiteralKeys`, `noNonNullAssertion`, and formatter diffs, concentrated in `archive/packages/profiler`, `archive/packages/change/src/adapters`, `archive/packages/production-change/src/deployment`). It is not known whether these are tolerated or slated to be fixed — do not mass-rewrite them as a side quest; fix only what you touch.

Recent commits use research-milestone subjects with a verdict token: `ProductionChange V1C: second real runtime BLOCKED (...)`, `Phase 0D: ... (KILL - no dominant waste)`. Verdicts seen: `BLOCKED`, `KILL`, `KILL_SIGNAL`, `weak signal`. Older history mixes Conventional Commits and GitHub web-UI messages; follow the current style. Branches: `research/*`, `integration/*`. Several sibling worktrees exist (`git worktree list`) — work in the primary checkout unless told otherwise.
