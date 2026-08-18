# Real-agent 1-vs-2 scaling report

## Executive summary

Rapture now supports first-class repeated trials, monotonic phase timing, seeded
task order, and trial-level report regeneration. A six-task TypeScript fixture
(`ledger-kit`) has deterministic validators that reject the incomplete baseline
and accept documented solutions.

The deterministic fake-agent preflight executed workers `{1,2}` × 3 repetitions
successfully: six isolated trials, 36 task runs, identical per-repetition task
orders, and a report that regenerates from disk. Those numbers measure
instrumentation only.

The bounded real Codex experiment did not run. This environment has no `codex`
binary and no Codex/OpenAI credentials. Installing an unauthenticated CLI would
not produce a valid comparison. No real 1-worker or 2-worker throughput,
speedup, or parallel-efficiency claim is available.

**Decision: `REAL_SCALE_2_INFRA_BLOCKED`**

## Git baseline

Recorded before any edits:

| Field | Value |
| --- | --- |
| Branch | `main` tracking `origin/main` |
| HEAD | `bb96ef29554673ee8a970ecf44e5010079e607e9` |
| Message | `basic files` |
| Working tree | clean |

## Changes made

- Extended `ExperimentConfig` with required positive `repetitions` (CLI default 1) and explicit `seed` (CLI default 0).
- Represented each worker-count/repetition pair as `workers-N-trial-R` with persisted `trial.json` / `trial-outcome.json`.
- Recorded `trialId` and `repetition` on events and `result.json`.
- Added monotonic phase timings: worktree setup, agent execution, validation, integration, worktree cleanup, total run.
- Derived trial seeds from the root seed plus repetition index; matching repetitions share task order.
- Aggregated reports from persisted events: per-trial raw values plus median/min/max throughput, paired and median speedup/efficiency, phase medians, failure counts. Missing provider metadata stays `null`.
- Added `ledger-kit`, a 6-task independent TypeScript fixture with validators stored beside the task file.
- Declared `zod` on the CLI package so the existing CLI import typechecks under pnpm isolation.

No optimizer, dashboard, extra provider, worker-count recommender, or changeability probe was added.

## Repetition architecture

Trials are the unit of comparison. Execution order is repetition-major
(`rep 1` workers 1 then 2, then `rep 2`, then `rep 3`) so matching task orders
are closer in time. A trial infrastructure failure is recorded and later trials
still run; the experiment then fails closed with `AggregateError` after
persisting completed trial artifacts.

Artifact layout:

```text
<experiment>/
  manifest.json
  events.jsonl
  outcome.json
  trials/workers-N-trial-R/
    trial.json
    trial-outcome.json
    runs/<run-id>/result.json
```

## Phase timing architecture

Durations use `performance.now()`. Wall-clock ISO timestamps remain on events
and process results. Worktree create/remove stay serialized; the wait is inside
`worktreeSetupMs` / `worktreeCleanupMs`, not agent time. A phase that does not
occur is `null`. Rapture overhead is `totalRunMs - agentExecutionMs - validationMs`
when both agent and validation timings exist. Concurrent tasks can make the sum
of per-task totals exceed trial wall time; that is expected and documented.

## Seed and task-order methodology

- Root seed `20260817` for the preflight and the frozen real experiment.
- Trial seed = `deriveTrialSeed(rootSeed, repetition)` (32-bit mix, not `Math.random`).
- Fisher–Yates shuffle via `mulberry32`.
- Observed preflight orders:

| Repetition | Trial seed | Task order |
| --- | --- | --- |
| 1 | 76716790 | add-volume-discount, one-based-pagination, fix-parse-money, extract-normalize-email, validate-sku, parse-config-comments |
| 2 | 2326709359 | fix-parse-money, add-volume-discount, extract-normalize-email, validate-sku, parse-config-comments, one-based-pagination |
| 3 | 280629220 | add-volume-discount, extract-normalize-email, validate-sku, fix-parse-money, parse-config-comments, one-based-pagination |

Workers 1 and 2 received the same order at each repetition. The order is in
`trial.json` and `events.jsonl`.

## Real-agent task suite

See [ledger-kit-task-suite.md](ledger-kit-task-suite.md). Six independent
TypeScript modules: money bug fix, volume-discount feature, SKU validation,
1-based pagination, email helper refactor, and config-comment parsing.
Validators live in `fixtures/ledger-kit/validation/` and are resolved to
absolute paths so the agent cannot edit them. Each validator fails on the
committed baseline and passes the documented solution.

## Tests and quality gates

Required new coverage is present:

- Unit: repetitions schema, stable trial IDs, seeded order, trial aggregation,
  median throughput, repeated-trial speedup/efficiency, phase timing
  serialization, incomplete-phase handling.
- Integration: 1×3 and 1,2×3 fake-agent matrices, matching seeded orders,
  report regeneration, one-trial unexpected failure isolation, phase timing
  attribution.
- Fixture: baseline reject / solution accept for all six tasks.

Quality gates on the implementation revision:

| Gate | Result |
| --- | --- |
| `pnpm biome check .` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 53 passed |
| `pnpm build` | pass |
| `git diff --check` | pass |

`pnpm install --frozen-lockfile` was used to install the workspace.

## Deterministic preflight result

These results validate instrumentation only. They are not evidence about real
coding-agent scaling. The fake adapter writes known-correct files after a 40 ms
delay; acceptance is therefore nearly certain and wall times are hundreds of
milliseconds.

- Experiment ID: `exp-2026-08-17-a588a753-574`
- Status: `completed`
- 6 trials, 36 runs, 0 validation failures, 0 integration failures, 0 infrastructure failures
- Report regeneration from `events.jsonl` reproduced the same trial IDs, orders, and aggregates
- Compact artifacts: `experiments/fake-preflight-1v2x3/`

Fake-agent aggregates:

| Workers | Trials | Accepted | Median tasks/hour | Min | Max | Speedup | E(N) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 18 | 23606.557 | 23200.859 | 23710.209 | 1.000 | 1.000 |
| 2 | 3 | 18 | 43902.439 | 43548.387 | 44081.633 | 1.860 | 0.930 |

The 0.93 fake-agent efficiency only shows that two short concurrent file writes
plus serialized worktree setup can still look efficient. It does not estimate
Codex.

## Frozen real Codex experiment configuration

See `experiments/real-scale-2.frozen.json`.

| Control | Frozen value |
| --- | --- |
| Agent | Codex CLI (`rapture --agent codex`) |
| Agent version | not recorded; binary absent |
| Model | not pinned; would be recorded from `--agent-model` or adapter default |
| Workers | 1, 2 |
| Repetitions | 3 |
| Seed | 20260817 |
| Tasks | exact `fixtures/ledger-kit/tasks.json` (6 tasks) |
| Task order | same repetition-specific seeded order as the preflight |
| Validation | identical external scripts |
| Timeout | 180 s per task |
| Integration | off |
| Machine | linux 6.12.94+, Node v22.14.0, git 2.43.0, 4 CPUs |

Intended command:

```sh
node fixtures/ledger-kit/create.mjs /tmp/ledger-kit-real
node apps/cli/dist/index.js run \
  --repo /tmp/ledger-kit-real \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2 \
  --repetitions 3 \
  --seed 20260817 \
  --agent codex \
  --output experiments/real-scale-2
```

## 1-worker raw trial results

No real Codex 1-worker trials exist.

## 2-worker raw trial results

No real Codex 2-worker trials exist.

## Aggregated throughput

Real-agent median accepted tasks per hour: not available.

## Speedup

Real-agent `S(2) = median T(2) / median T(1)`: not available.

## Parallel efficiency

Real-agent `E(2) = median T(2) / (2 * median T(1))`: not available.

## Trial variance

Real-agent trial spread: not available. Fake-agent throughputs were tightly
clustered (instrumentation noise only).

## Phase timing comparison

No real-agent phase timings. Fake-agent medians, for instrumentation checkout
only: 1-worker agent 58 ms, validation 49 ms, overhead 36 ms; 2-worker agent
57.5 ms, validation 50 ms, overhead 45 ms. Integration was not requested.

## Validation failures

Real Codex: not run. Fake preflight: 0.

## Integration failures

Not requested. Fake preflight: 0. Real experiment: not run.

## Rapture infrastructure failures if any

None during fake preflight. Real experiment blocked before launch: Codex CLI
missing, no credentials in the environment, no Codex MCP server.

## Methodological limitations

- Three repetitions are a variance probe, not a basis for significance tests.
- One small TypeScript fixture cannot represent coding-agent work in general.
- Fake-agent wall times are too short to estimate contention under real inference.
- Codex model/reasoning settings could not be pinned because the CLI was absent.
- Per-trial timeout is not implemented; only per-task timeouts exist.
- Token and cost fields stay `null` unless an adapter reports them. The Codex
  adapter still does not scrape undocumented CLI usage text.

## What the experiment does prove

- Repeated trials, phase timings, seeded order, and report regeneration work.
- `ledger-kit` validators distinguish the buggy baseline from the documented
  solutions.
- A missing real-agent runtime can be classified as an infrastructure block
  instead of an agent-scaling result.

## What the experiment does not prove

- Whether 2-worker Codex produces more accepted work than 1-worker Codex.
- Whether a scaling wall exists.
- Whether any future efficiency loss would come from the model, validation,
  Git/worktrees, or Rapture.
- Anything about other providers, repositories, or worker counts above 2.

## Recommendation: scale to 4 workers, investigate a bottleneck, improve methodology, or stop

Do not scale to 4 workers. Do not optimize Rapture. Run `rapture doctor --config
experiments/real-scale-2.frozen.json` or the GitHub Actions workflow with
`preflight_only=true` until authentication is READY. Then re-run the frozen
1-vs-2 Codex configuration on an authenticated host (GitHub Actions Environment
`real-scale-2` or equivalent). Keep seed `20260817`, the same six tasks, and
three repetitions. Only after those six real trials exist should efficiency,
variance, or a 4-worker follow-up be discussed. GitHub-hosted fingerprints must
not be pooled with other environments.

## Required trial table

Real Codex cells are empty because the run was blocked. Fake-agent rows are
instrumentation-only and must not be read as Codex results.

| Workers | Trial | Accepted | Wall time | Tasks/hour | Agent time | Validation time | Integration time | Rapture overhead | Failures | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 6 | 931 ms | 23200.859 | 59 ms | 51 ms | n/a | 35 ms | 0 | fake preflight |
| 1 | 2 | 6 | 915 ms | 23606.557 | 58 ms | 49 ms | n/a | 37 ms | 0 | fake preflight |
| 1 | 3 | 6 | 911 ms | 23710.209 | 58 ms | 49 ms | n/a | 36 ms | 0 | fake preflight |
| 2 | 1 | 6 | 496 ms | 43548.387 | 58 ms | 51 ms | n/a | 45 ms | 0 | fake preflight |
| 2 | 2 | 6 | 492 ms | 43902.439 | 58 ms | 50 ms | n/a | 46 ms | 0 | fake preflight |
| 2 | 3 | 6 | 490 ms | 44081.633 | 58 ms | 50 ms | n/a | 43 ms | 0 | fake preflight |
| 1 | 1–3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | real Codex not run |
| 2 | 1–3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | real Codex not run |

## Git branch

`cursor/repeated-real-agent-scaling-ca4d`

## HEAD

Implementation commit: `c5e52bf8742ff5dea7a2590b5a49e4120fc63fa4`.
This report is a follow-up commit on the same branch.

## Working-tree status

Clean after the report commit, aside from this documentation and copied
preflight summaries.

## Decision

`REAL_SCALE_2_INFRA_BLOCKED`

The experiment machinery and fixture are ready, but this environment cannot
execute authenticated Codex CLI trials. No real scaling conclusion is justified.
