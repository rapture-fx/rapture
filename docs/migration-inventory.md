# Product reset inventory

This inventory was recorded before the 2026-08-27 product reset. Classification is based on
the dependency graph at `83221a678178da6f5b5d099ad405af9408fb1bd2`, not on the amount of
previous engineering effort.

Historical recovery points:

- `v1.0-research` -> `321d9c00df65add0d1fd2cf35d8c1691753dc726`
- `v1.0-verification-integrity` -> `83221a678178da6f5b5d099ad405af9408fb1bd2`

## KEEP

These low-level modules are product-neutral and directly useful for scenario execution,
durable evidence, or external validation:

- `packages/kernel/src/types.ts`
- `packages/kernel/src/process/run.ts`
- `packages/kernel/src/checker/validation.ts`
- `packages/kernel/src/judge/validator.ts`
- `packages/kernel/src/evidence/artifacts.ts`
- `packages/kernel/src/evidence/integrity.ts`
- `packages/kernel/src/journal/jsonl.ts`
- `packages/kernel/src/receipts/receipt.ts` (library-only; signed receipts are not a product surface)
- Their corresponding kernel tests and package build configuration
- `LICENSE`, strict TypeScript configuration, Biome configuration, pnpm workspace configuration

## ADAPT

These package shells remain, but their active APIs change to serve the first product-state
scenario rather than research or Git verification:

- `packages/kernel/src/index.ts` and `packages/kernel/README.md`: narrow exports and positioning
- `packages/core`: replace the old public API with scenario lifecycle, state diff, result,
  registry, and the single reference world
- `apps/cli`: replace the old experiment and verification command surface with only
  `scenario list` and `run <scenario> [--json]`
- Root `package.json`, `pnpm-lock.yaml`, `.gitignore`, and `.github/workflows/ci.yml`: align scripts,
  dependencies, generated artifacts, and validation with the new product
- `README.md` and active docs: rewrite around disposable product worlds

## ARCHIVE

These assets are valuable historical or research material, but they do not belong in the active
product architecture. They are removed from main and remain byte-for-byte recoverable through
the tags above:

- All `experiments/**`, `benchmarks/**`, and the research `fixtures/**`
- `scripts/real-scale-2/**`
- Research/product modules in `packages/core/src`: `adapters/**`, `artifacts.ts`,
  `attribution.ts`, `benchmark.ts`, `capacity-report.ts`, `capacity.ts`,
  `concurrency-overlap.ts`, `config.ts`, `continuation.ts`, `counterfactual.ts`,
  `doctor-checks.ts`, `doctor.ts`, `economics-metrics.ts`, `economics.ts`, `events.ts`,
  `exec/local-worktree.ts`, `experiment.ts`, `frozen.ts`, `git.ts`, `host-state.ts`,
  `integration.ts`, `integrity.ts`, `knee.ts`, `ledger.ts`, `logical-run.ts`, `metrics.ts`,
  `models.ts`, `prediction-store.ts`, `predictors.ts`, `process-telemetry.ts`, `process.ts`,
  `provider-events.ts`, `report.ts`, `runtime-fingerprint.ts`, `telemetry.ts`, `timing.ts`,
  `trial.ts`, `validation.ts`, `worker.ts`, and `worktree.ts`
- All old `packages/core/test/**` tests that exercise those archived modules
- `packages/kernel/src/exec/**`: its `repository` and `baseCommit` contract is specifically a
  code-worktree executor, not a product-world lifecycle
- `packages/kernel/src/policy/classify.ts` and `policy/logical-run.ts`: autonomous-engineering
  run semantics
- Their corresponding kernel tests: `executor.test.ts`, `classify.test.ts`
- Research documentation: `docs/doctor-preflight-report.md`,
  `docs/engineering-economics-v0.md`, `docs/evidence-and-claims.md`,
  `docs/experimental-methodology.md`, `docs/ledger-kit-task-suite.md`,
  `docs/opencode-*.md`, `docs/product-thesis.md`, `docs/publication-outline.md`,
  `docs/real-*.md`, `docs/research-*.md`
- `.github/workflows/real-scale-2-codex.yml`

Experiment scaling remains support technology in Git history; it is deliberately not copied or
surfaced in the first new-product slice.

## DELETE_FROM_MAIN

These modules and surfaces encode the frozen verification-integrity product. Their only active
recovery contract is `v1.0-verification-integrity`:

- `packages/kernel/src/signals/**` and tests `signals.test.ts`, `invariants.test.ts`
- `packages/core/src/integrity-report.ts`, `severity.ts`, `trustmap.ts`,
  `verification-receipt.ts`, and `verification-scan.ts`
- Verification-specific core tests: `file-changes.test.ts`, `git-zero-config.test.ts`,
  `integrity-report.test.ts`, `invariants-integration.test.ts`, `trustmap.test.ts`,
  `verification-scan.test.ts`, and `verify-adoption.test.ts`
- CLI commands `verify`, `scan`, `trustmap`, `keygen`, and `receipts-verify`
- `.github/actions/verify/**`
- `fixtures/invariants.example.json`
- `docs/verification-integrity.md`, `docs/verification-adoption-report.md`, and
  `docs/market-test-protocol.md`
- `scripts/pr-retrospective.sh`
- ACCEPT/WARN/REJECT and `.rapture/invariants.json` product semantics

## Decision summary

The new vertical slice will reuse hashing and strict JSON value types from the kernel. The new
world lifecycle is implemented in core because the old executor contract would force Git
repository concepts into a product-state abstraction. No compatibility wrappers will retain the
old CLI or public core API on main.
