# Architecture

## The vertical slice

`subscription-seat-upgrade` is the architecture proof:

```text
typed fixture -> in-memory product world -> real upgrade service -> observer
              -> path-level expected/actual diff -> PASS/FAIL/ERROR -> reset
```

The reference world is intentionally one deterministic in-memory persistence adapter. It models
application, billing, permissions, invoice, audit, and notification records in one store so the
first slice tests business-state coordination without introducing Postgres, Stripe, queues,
email, browsers, or remote infrastructure.

## Scenario API

`ScenarioDefinition<Fixture, Observation>` supplies a typed fixture, typed expected observation,
and a world factory. `ScenarioWorld` exposes exactly five operations:

- `prepare()`
- `seedOrRestore(fixture)`
- `run()`
- `observe()`
- `disposeOrReset()`

`runScenario()` owns ordering, status classification, evidence events, expectation evaluation,
and finally-style cleanup. Scenario names are validated as lowercase kebab-case.

## Result and state diff

Results use schema version `1` and distinguish:

- `PASS`: workflow and cleanup completed; all declared expectations matched.
- `FAIL`: workflow and cleanup completed; at least one business expectation did not match.
- `ERROR`: lifecycle infrastructure, workflow execution, observation, evidence, or cleanup
  failed.

State differences recurse through objects and arrays and emit focused paths. Each entry records
expected/actual presence separately, so missing, unexpected, and mismatched state cannot be
confused. Unexpected fields are ignored by default for partial observations and can be made
fail-closed per scenario.

Timestamps remain volatile metadata. `scenarioId` and `resultHash` are deterministic and exclude
timestamps, so two isolated equivalent runs compare identically.

## Retained Rapture engineering

The active kernel retains only product-neutral primitives:

- shell-free argv process execution and external validation
- append-only fsynced JSONL journals
- safe artifact paths, redaction, immutable writes, and SHA-256 hashing
- tree integrity manifests
- optional Ed25519/DSSE-compatible receipt library

The first scenario directly reuses hashing, redaction, JSON value types, and the durable journal.
Receipts remain a low-level library only; they are not exposed as a product feature.

The old Git worktree executor was not adapted. Its required `repository` and `baseCommit` fields
would force a coding-specific contract into product worlds. The new lifecycle was therefore
implemented directly from the reference workflow.

## Removed from active main

Verification weakening detectors, invariants, trust maps, commit-window scans, ACCEPT/WARN/REJECT,
Git base resolution, verification receipts/CLI, GitHub verification action, agent adapters,
experiment scheduling/scaling, benchmark fixtures, and research artifacts were removed from the
active tree. They remain recoverable through the frozen tags documented in `HISTORY.md`.

There is no compatibility layer between the frozen verification CLI and the new CLI.

## Safety boundary

The reference world cannot connect to production: it has no network adapter or credential input.
Each run creates a fresh store and drops its state in `disposeOrReset()`. Cleanup failure changes
the whole result to ERROR, even if business expectations had passed. Failure messages pass
through the retained secret redactor before entering results or CLI output.

## Closed bets

Five product hypotheses were built on top of these primitives and tested against
real data between 2026-08-28 and 2026-08-30: the agent compute profiler, the
Software Change API, ProductionChange, the Deployment API, and
verification-surface detection. All five are closed.

Their code is archived under `archive/packages/*` and their verdicts, evidence,
and do-not-revive conditions are recorded in [closed-bets.md](closed-bets.md).

The relevant architectural fact is that **none of them required the kernel to
change**. Each reused hashing, redaction, safe artifact paths, and the durable
journal as-is. The product layers were falsified; the primitives underneath them
were not.
