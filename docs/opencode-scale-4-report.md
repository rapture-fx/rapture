# Real-agent 1-vs-2-vs-4 scaling report (opencode-scale-4)

## Executive summary

The real OpenCode experiment was launched with the frozen `opencode-scale-4`
configuration: workers `{1,2,4}` × 3 repetitions, six `ledger-kit` tasks, seed
`20260817`, OpenCode CLI 1.18.18, model `opencode/deepseek-v4-flash-free`, on a
4-core/8 GiB host. The doctor passed READY, provenance was frozen in
`experiments/opencode-scale-4/pre-run-freeze.json`, and the fixture base commit
was recorded.

All 54 runs completed: 45 accepted, 9 validation failures. No provider blocks,
no timeouts, no leaked worktrees. Throughput scaled sub-linearly and then
saturated: median accepted tasks/hour rose 38.24 → 83.07 → 88.89 for workers
1 → 2 → 4. The measured speedups S(2)=2.17 and S(4)=2.32 fall far short of the
linear ideal, and parallel efficiency collapses to 0.581 at 4 workers — a
throughput wall. Acceptance held at moderate levels across all worker counts
(0.833 / 0.889 / 0.778), dominated by the known-flaky `fix-parse-money` task
(8 of 9 runs failed it; only 1 task of the other five failed, and only at 4
workers).

**Decision: `OPENCODE_SCALE_4_PASS_WALL_OBSERVED`**

## Git baseline

| Field | Value |
| --- | --- |
| Branch | `cursor/repeated-real-agent-scaling-ca4d` (tracks origin) |
| HEAD before commit | `3c6e32e` (pre-run; working tree clean) |
| Implementation commit | `7e69a6a` (adds `--dir` confinement, committed before run) |
| Working tree at freeze | clean |
| PR | DRAFT PR #2 on this branch |

## Minimal fixes applied before freezing

Two scoped commits before the run:

- `465b8b7` "Add OpenCode as a provider-neutral agent adapter": added
  `packages/core/src/adapters/opencode.ts` (runs `opencode run --format json`,
  model pinned via `--model`, cost/token fields null), CLI wiring, and adapter
  unit tests.
- `9cc1f3c` "Freeze the opencode-scale-4 experiment and its integrity sidecar":
  `experiments/opencode-scale-4.frozen.json` + `.integrity.json`, plus a
  `.gitignore` entry for `experiments/opencode-scale-4/`.
- `7e69a6a` "Confine opencode runs to the task worktree with --dir": the OpenCode
  CLI resolves its project directory from its own heuristics instead of the
  spawned cwd, so a run started in a task worktree could operate on the workspace
  root and modify tracked fixtures. The adapter now passes `--dir <worktree>`
  explicitly, and the adapter argv test asserts it.

No optimizer, dashboard, extra provider, worker-count recommender, or
changeability probe was added. `fix-parse-money` was not modified.

## Frozen configuration

See `experiments/opencode-scale-4.frozen.json` (immutable; verified unchanged
after the run) and its integrity sidecar `experiments/opencode-scale-4.integrity.json`
(aggregate `ff6e893c743f5d7d850b919149ab08c8f7dac40177f3a2743b6378a8ed2b4479`,
recomputed after the run with the same value).

| Control | Frozen value |
| --- | --- |
| Agent | OpenCode CLI (`opencode run`, agent `build`, `--format json`) |
| Agent version | opencode 1.18.18 |
| Model | `opencode/deepseek-v4-flash-free` via `--agent-model` / `--model` |
| Reasoning effort | provider default (not pinned) |
| Confinement | `--dir <worktree>` (adapter) |
| Workers | 1, 2, 4 |
| Repetitions | 3 |
| Seed | 20260817 |
| Tasks | exact `fixtures/ledger-kit/tasks.json` (6 tasks) |
| Task order | repetition-specific seeded order (identical across worker counts) |
| Validation | identical external scripts (6 baseline-reject validators) |
| Timeout | 180 s per task |
| Integration | off |
| Machine | macOS 13.7.8 Darwin 22.6.0 x86_64, Node v22.14.0, pnpm 10.12.1, git 2.49.0, 4 CPU (i5-7360U), 8 GiB |

Executed command:

```sh
node apps/cli/dist/index.js run \
  --repo /private/tmp/rapture-opencode-scale-4.1787155012/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2,4 --repetitions 3 --seed 20260817 \
  --agent opencode --agent-model opencode/deepseek-v4-flash-free \
  --output experiments/opencode-scale-4
```

Doctor result: READY, all 12 checks PASS (NODE_RUNTIME, PNPM_RUNTIME,
GIT_RUNTIME, EXPERIMENT_CONFIG, TASK_INTEGRITY, FIXTURE_INTEGRITY,
REPOSITORY_STATE, WORKTREE_STATE, AGENT_BINARY, AGENT_AUTH, MODEL_CONFIG,
OUTPUT_PATH).

## Task order methodology

Trial seed = `deriveTrialSeed(20260817, repetition)`; Fisher–Yates via
`mulberry32`. Resolved orders (identical for all worker counts at each
repetition, matching the preflight and real-scale-2/4):

| Repetition | Trial seed | Task order |
| --- | --- | --- |
| 1 | 76716790 | add-volume-discount, one-based-pagination, fix-parse-money, extract-normalize-email, validate-sku, parse-config-comments |
| 2 | 2326709359 | fix-parse-money, add-volume-discount, extract-normalize-email, validate-sku, parse-config-comments, one-based-pagination |
| 3 | 280629220 | add-volume-discount, extract-normalize-email, validate-sku, fix-parse-money, parse-config-comments, one-based-pagination |

## Execution timeline

- Experiment ID `exp-2026-08-19-2c4eba1a-f52`, started `2026-08-19T15:58:59Z`,
  finished `16:44:49Z` (~46 min).
- Repetition-major order: rep 1 (workers 1, 2, 4), rep 2, rep 3.
- All 54 runs completed. No provider blocks, no timeouts, no leaked worktrees.

## Trial results

Legend: `accepted` = independently validated accepted tasks; `wall` = trial
wall-clock; `tph` = accepted tasks per wall-clock hour; `agent ms` = median
agent execution time; `val-fail` = validation failures.

| Workers | Trial | Accepted | Wall ms | Tasks/hour | Agent ms (med) | Val ms (med) | Overhead ms | Val-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 5 | 593893 | 30.31 | 89313 | 184 | 393 | 1 |
| 1 | 2 | 5 | 470755 | 38.24 | 53028 | 166 | 371 | 1 |
| 1 | 3 | 5 | 424082 | 42.44 | 51034 | 171 | 349 | 1 |
| 2 | 1 | 6 | 260023 | 83.07 | 66640 | 203 | 424 | 0 |
| 2 | 2 | 5 | 168378 | 106.90 | 56783 | 176 | 471 | 1 |
| 2 | 3 | 5 | 266561 | 67.53 | 80248 | 167 | 472 | 1 |
| 4 | 1 | 5 | 176772 | 101.83 | 105010 | 266 | 581 | 1 |
| 4 | 2 | 4 | 186333 | 77.28 | 104916 | 288 | 630 | 2 |
| 4 | 3 | 5 | 202494 | 88.89 | 80644 | 245 | 587 | 1 |

## Worker aggregates

Reported by the regenerated report (`rapture report`):

| Workers | Trials | Task runs | Accepted | Median tasks/hour | Validation-fail | Integration-fail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 18 | 15 | 38.24 | 3 | 0 |
| 2 | 3 | 18 | 16 | 83.07 | 2 | 0 |
| 4 | 3 | 18 | 14 | 88.89 | 4 | 0 |

## Scaling analysis

Per-worker median accepted tasks/hour and derived speedups/efficiency:

| Workers | Acceptance | Median tasks/hour | S(N) vs w1 | Parallel efficiency E(N) |
| --- | --- | --- | --- | --- |
| 1 | 0.833 | 38.24 | 1.000 | 1.000 |
| 2 | 0.889 | 83.07 | 2.173 | 1.086 |
| 4 | 0.778 | 88.89 | 2.325 | 0.581 |

- Throughput scales 2.17× from 1→2 workers (efficiency 1.086, within noise of
  linear), then only 2.32× total from 1→4 workers (parallel efficiency 0.581).
  The marginal gain from 2→4 workers is just 5.8 tasks/hour, i.e. a clear
  throughput wall at 4 workers on this 4-core host.
- Acceptance is stable across worker counts (0.833 / 0.889 / 0.778), so the wall
  is a throughput/concurrency ceiling, not an acceptance collapse. The single
  acceptance dip at 4 workers (0.778) is one `fix-parse-money` run failing that
  passed at 2 workers — within normal variance for that task.
- Failure attribution: 8 of 9 total failures are `fix-parse-money` (the known
  flaky task; it also failed in real-scale-2 and real-scale-4). Only 1 of 45
  runs of the other five tasks failed (`add-volume-discount` at 4 workers).
- Wall-clock per trial tracks agent time: median agent execution rose from
  ~53 s at 1 worker to ~105 s at 4 workers (4 workers contend for the same
  4-core host), while per-trial wall fell from ~471 s to ~186 s.

## Integrity verification

- `experiments/opencode-scale-4.frozen.json` and `.integrity.json` unchanged
  from the implementation commit.
- Integrity sidecar recomputed after the run: same aggregate
  `ff6e893c743f5d7d850b919149ab08c8f7dac40177f3a2743b6378a8ed2b4479`.
- Manifest task set hash `db3006a82912854977b3cc37f8e7196fd6796fbfc7c7b9f6c848c816043baa01`
  matches the integrity sidecar and the real-scale-2/4 sidecars (same fixture).
- 9/9 trial directories with 54 run directories present; report regenerates
  from `events.jsonl` with the same trial IDs and orders.
- No leaked worktrees after the run; fixture repo remained clean at base commit
  `441eade3516fb11265f3235b51ddb25e1072bc89`; main repo working tree clean.
- The `--dir` confinement fix is confirmed by the run: every agent command
  targets `.../.worktrees/<runId>`, and no tracked workspace file was touched
  during the 54-run experiment.

## Methodological limitations

- Three repetitions are a variance probe, not a basis for significance tests.
- One small TypeScript fixture cannot represent coding-agent work in general.
- The host has exactly 4 cores; the wall at 4 workers may be host capacity
  rather than an agent-level scaling property.
- Token/cost fields are `null` (OpenCode adapter does not scrape CLI usage;
  the free model reports no cost).
- `fix-parse-money` contributes 8 of 9 failures and dominates the acceptance
  numbers; a different task mix could shift the acceptance curve.

## What this experiment proves

- The real 1-vs-2-vs-4 harness runs end to end with OpenCode: doctor READY,
  provenance frozen, 9 trials × 6 tasks = 54 runs executed with no provider
  blocks, no timeouts, no leaked worktrees, and a clean working tree after.
- A provider-neutral adapter plus explicit `--dir` worktree confinement keeps a
  real agent inside its task worktree across an entire experiment.
- Throughput does scale with concurrency (38 → 83 → 89 tasks/hour) but
  saturates at 4 workers on this 4-core host (S(4)=2.32, E=0.581).
- Acceptance is robust to scaling (≥0.778 across all worker counts), with
  failures dominated by the known-flaky `fix-parse-money` task.

## What this experiment does not prove

- Whether OpenCode scales useful throughput beyond 4 workers on this host.
- Whether the observed wall persists on larger or multi-core hosts.
- Anything about other providers, repositories, or worker counts.

## Recommendation

Treat 4-worker OpenCode on this 4-core/8 GiB host as wall-bound: doubling
concurrency from 2→4 yields only ~7% more accepted tasks per hour. If the goal
is throughput on this host, run at 2 workers (2.17× at ~1.09 efficiency). If
the goal is latency, 4 workers cuts median trial wall time from ~471 s (1
worker) to ~186 s but with diminishing returns.

If a higher worker count is desired, repeat the identical frozen configuration
on a host with more cores to test whether the wall is host capacity:

```sh
node apps/cli/dist/index.js run \
  --repo /private/tmp/rapture-opencode-scale-4.1787155012/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2,4 --repetitions 3 --seed 20260817 \
  --agent opencode --agent-model opencode/deepseek-v4-flash-free \
  --output experiments/opencode-scale-4
```

Do not pool results from different environment fingerprints. Do not tune the
harness mid-experiment. Do not modify `fix-parse-money`.

## Decision

`OPENCODE_SCALE_4_PASS_WALL_OBSERVED`

The frozen real OpenCode 1-vs-2-vs-4 experiment completed all 54 runs with no
provider or infrastructure failures. Throughput scaled 2.17× at 2 workers and
2.32× at 4 workers (parallel efficiency 0.581), demonstrating a throughput wall
at 4 workers on this 4-core host while acceptance held at moderate levels
(E(4)=0.778, dominated by the known-flaky `fix-parse-money` task). A scaling
wall was observed; the run itself passed end to end.