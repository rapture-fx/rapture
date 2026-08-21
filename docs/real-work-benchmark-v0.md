# Real-Work Benchmark V0

## Purpose

Real-Work Benchmark V0 is a reproducible substrate for later Rapture scaling, capacity-prediction, and execution-policy experiments. It replaces no existing ledger-kit experiment and draws no scaling conclusion. The suite is frozen as `rapture-real-work-v0@0.1.0` in `benchmarks/real-work-v0/manifest.json`.

## What the benchmark is testing

The suite tests whether an autonomous coding worker can produce changes that satisfy deterministic external acceptance across multiple repository concerns: boundary bugs, small features, concurrency repair, refactoring, repository exploration, and public type declarations. It also provides task-class and repository provenance for later throughput analysis.

## What the benchmark is not testing

V0 does not test capacity prediction, adaptive scheduling, model quality at scale, cost optimization, long-horizon maintainability, visual behavior, deployment, proprietary services, or subjective code quality. The fixture and known-good proofs validate benchmark engineering only. No full Codex or OpenCode benchmark was run while building it.

## Repository selection methodology

V0 uses two Rapture-authored minimized Node.js repositories under MIT rather than live upstream clones:

- `commerce-service` represents service-layer money, pricing, idempotency, and input-contract work.
- `config-toolkit` represents parser, recursive merge, configuration precedence, and JavaScript declaration maintenance.

Both fixtures are derived from ordinary open-source Node.js patterns but contain no copied third-party source. Their provenance points to the Rapture repository and the immutable development anchor `b220650159389a1e12fd219712f371465b139b7e`. This choice eliminates network installation and upstream drift on an 8 GiB host. It is less externally representative than full upstream repositories and is the primary V0 limitation.

## Task selection methodology

Tasks were selected before real-agent execution. Each task has one independent acceptance contract, an explicit editable scope, a failing baseline, and a protected known-good overlay. Validators were not tuned using agent outcomes. Tasks requiring credentials, internet APIs, UI interaction, visual judgment, or an LLM judge were excluded.

## Task classes

The eight tasks cover all six V0 classes:

- `bug_fix`: exact money parsing; quoted-comment parsing.
- `small_feature`: tiered discounts; immutable deep merge.
- `test_repair`: concurrent idempotency repair.
- `refactor`: structured immutable order normalization.
- `repository_exploration`: configuration precedence across loader and merge modules.
- `build_or_typecheck_heavy`: strict TypeScript consumer validation of public declarations.

## Acceptance architecture

The benchmark controller launches a validator by argv with an absolute validator path and a candidate-repository argument. The coding-agent exit status is never acceptance. A validator exit code of `0` means accepted, `1` means task rejected, and every timeout, missing/tampered asset, or other exit is an infrastructure failure. Stdout, stderr, duration, timeout state, and exit code are returned as a machine-readable `BenchmarkValidatorResult`.

Validators use Node assertions and emit one JSON status record. The declaration validator runs the pinned workspace TypeScript compiler API. Validators need no network access and have explicit timeouts.

## Validator isolation

Validators live under `benchmarks/real-work-v0/validators`, outside every materialized repository and outside every task editable scope. Their hashes, including the shared validator library, are frozen in the manifest. Materialization copies only fixture source; agent worktrees therefore cannot change validators through repository edits. Preflight fails closed on validator drift.

This is structural integrity, not a claim of same-user filesystem confidentiality. Known-good overlays are not copied into candidate repositories, prompts, or generated task definitions. For paid real-agent execution, the operator must use a sandbox whose readable roots exclude `benchmarks/real-work-v0/known-good`; the current OpenCode adapter does not itself prove that read boundary. Run benchmark preflight separately, then expose only the materialized repository and required validator runtime to the agent environment.

## Known-good proof methodology

Each known-good overlay is a versioned JSON mapping from an editable relative path to complete file content. Overlay hashes are frozen in the manifest. Doctor materializes a clean base, proves the baseline returns `rejected`, applies only paths allowed by `editableScope`, proves the validator returns `accepted`, and resets to the pinned base. Known-good content is never part of an agent prompt or candidate checkout.

## Reproducibility

Fixture materialization:

1. Validates the strict Zod manifest and semantic suite fingerprint.
2. Hashes every fixture path and content byte in sorted order.
3. Copies the vendored fixture to a new destination only.
4. Creates a Git repository with fixed author, committer, timestamp, message, and branch.
5. Requires the generated commit to equal the manifest `baseRevision`.

No npm install or network call is required for either fixture. Disposable Rapture worktrees are created from the resulting exact commit. Existing ledger-kit task files remain accepted and have null benchmark provenance.

Useful commands:

```sh
pnpm rapture benchmark-doctor --manifest benchmarks/real-work-v0/manifest.json
pnpm rapture benchmark-materialize \
  --manifest benchmarks/real-work-v0/manifest.json \
  --repository commerce-service \
  --destination /new/empty/path \
  --tasks-output /new/tasks.json
```

The destination must not exist. Reset by discarding the materialized repository or its Rapture worktree and materializing again; the controller never silently overwrites it.

## Integrity model

Identity excludes mutable absolute paths. The suite SHA-256 covers repositories, pinned revisions, task prompts and classes, editable scopes, validator and known-good hashes, size indicators, proof metadata, and protected shared assets. Fixture hashes cover sorted relative paths and file bytes. Preflight blocks on any manifest, fixture, size, validator, shared-library, known-good, generated-commit, or base-revision drift.

## Performance-research considerations

The manifest records repository file count, checkout bytes, baseline validator runtimes, cache policy, timeout hints, and baseline check commands. `EngineeringTaskRun` records `benchmarkSuiteId`, `benchmarkSuiteVersion`, `repositoryId`, and `benchmarkTaskClass`; experiment manifests aggregate the same provenance. V0 deliberately implements no task-dependent scheduling.

Validation caches are disabled for seven tasks. The TypeScript declaration task uses a new temporary consumer program and removes it after each run (`reset` cache policy). Fixture install duration is zero because no install is required. On this development host the light validators are expected near 100-150 ms and the TypeScript validator near 2.5 seconds; these are descriptive hints, not frozen performance claims.

## Benchmark inventory

| Repository | Pinned base | Files | Bytes | Tasks |
| --- | --- | ---: | ---: | ---: |
| commerce-service | `941c7457279fa1894fef6c592d70334d767ab4ba` | 7 | 2,627 | 4 |
| config-toolkit | `21626db5b6c15d5d65733766855487385ab9ab90` | 8 | 2,711 | 4 |

| Task | Class | Editable scope | Validator establishes |
| --- | --- | --- | --- |
| commerce-precise-money | bug_fix | `src/money.mjs` | exact decimal parsing and invalid-format rejection |
| commerce-tiered-discount | small_feature | `src/discount.mjs` | threshold policy, rounding, validation, immutability |
| commerce-concurrent-idempotency | test_repair | `src/idempotency.mjs` | one in-flight operation per key |
| commerce-order-normalization | refactor | `src/orders.mjs` | structured results and no input mutation |
| config-quoted-comments | bug_fix | `src/parser.mjs` | quote-aware comment parsing |
| config-deep-merge | small_feature | `src/merge.mjs` | recursive merge, array replacement, deep isolation |
| config-precedence-chain | repository_exploration | `src/load.mjs` | defaults < file < environment < CLI |
| config-public-types | build_or_typecheck_heavy | `types/index.d.ts` | strict consumer typecheck against runtime contract |

## Limitations

- Two minimized repositories and eight tasks meet the minimum corpus, not the target of three repositories and 10-12 tasks.
- The repositories are realistic representative fixtures, not frozen full upstream histories; repository size and dependency-install effects are underrepresented.
- The typecheck task is heavier than other validators but still has a small compiler graph.
- Validator assertions establish specified behavior, not broad maintainability or absence of all regressions.
- Same-user read isolation for known-good assets is an execution-sandbox responsibility, especially for OpenCode.
- Baseline runtime hints are approximate and host-specific.

## How to add a future benchmark task

1. Select a clearly licensed, pinned repository revision whose setup is deterministic and host-appropriate.
2. Add or update a vendored fixture without network-dependent execution.
3. Write the prompt, class, editable scope, validator contract, cache policy, and limitations before agent trials.
4. Put the validator outside the fixture and make it emit the documented exit/status contract.
5. Add a known-good overlay limited to editable paths; never include it in prompts or materialized repositories.
6. Recompute fixture, asset, base revision, size, and semantic suite fingerprints.
7. Prove repeated baseline rejection and known-good acceptance. Reject the task on flakiness or subjective acceptance.
8. Run benchmark doctor plus all repository quality gates before changing the frozen suite version.
