---
name: verify
description: Run the full verification sequence for this repo (build, typecheck, all package tests, biome check). Use when asked to verify changes, before committing, or to confirm the workspace is green.
---

Run these in order from the repo root, stopping at the first failure:

1. `pnpm build` — required before the archived `change`/`production-change` tests, which resolve `@rapture/kernel` through `dist/`.
2. `pnpm typecheck` — runs both the src and the `tsconfig.test.json` pass per package.
3. `pnpm -r test` — **`-r`, not the root `test` script**, which covers only the maintained packages (kernel, core, cli).
4. `pnpm check` — `biome check .`.

Reporting:

- State pass/fail per step with the actual output for failures. Do not describe a step as passing if you skipped it.
- Step 4 has a large pre-existing backlog (~125 errors, mostly `useLiteralKeys` and `noNonNullAssertion` in `archive/packages/*`), plus noise from generated `.rapture/**` JSON that `biome.json` does not exclude. Report only diagnostics in files touched by the current change; note the pre-existing total separately rather than folding it into the verdict.
- Do not fix unrelated lint findings as part of verification.
