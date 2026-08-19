# Real-agent 1-vs-2-vs-4 scaling report (real-scale-4)

## Executive summary

The real Codex experiment was launched with the frozen `real-scale-4`
configuration: workers `{1,2,4}` × 3 repetitions, six `ledger-kit` tasks, seed
`20260817`, Codex CLI 0.147.0, model `gpt-5.6-sol`, reasoning effort medium, on
a 4-core/8 GiB host. The doctor passed READY, provenance was frozen in
`experiments/real-scale-4/pre-run-freeze.json`, and the fixture base commit was
recorded.

The run was interrupted by an account-level Codex usage limit. Repetition 1 for
workers 1 and 2 completed in full (5/6 accepted each; `fix-parse-money` failed,
consistent with the prior real-scale-2 run). Repetition 1 for workers 4 is
partial (2 of 6 tasks hit the usage limit). All 36 runs of repetitions 2 and 3
returned `ERROR: You've hit your usage limit. ... try again at Aug 20th, 2026
11:54 PM` within 5–25 s with no agent work and no file changes.

Because only one full repetition (workers 1 and 2) and a partial repetition
(workers 4) exist, no median-based `T(N)`, `S(N)`, `E(N)`, or variance estimate
is valid. The blocked runs are an account/credential infrastructure failure,
not a task failure. Per the experiment contract, missing trials are not treated
as failures or successes, and blocked tasks are not retried.

**Decision: `REAL_SCALE_4_INFRA_BLOCKED`**

## Git baseline

| Field | Value |
| --- | --- |
| Branch | `cursor/repeated-real-agent-scaling-ca4d` (tracks origin) |
| HEAD before commit | `c13595cc42033e906aca358571eea81656590936` |
| Implementation commit | `026eb7acb1ef85976ec2fa29d7a80557d68a66f3` |
| Working tree at freeze | clean |
| PR | DRAFT PR #2 on this branch |

## Minimal fixes applied before freezing

Generalized the frozen-input integrity machinery so the doctor and integrity
sidecar are computed per experiment name instead of being hardcoded to
`real-scale-2`:

- `packages/core/src/frozen.ts`: added `REAL_SCALE_4_EXPECTED` (workers
  `[1,2,4]`, 3 reps, seed `20260817`, same 6 tasks, 180 s, no integration),
  `LEDGER_KIT_TASK_IDS`, and name-based semantic mismatch dispatch.
- `packages/core/src/integrity.ts`: `frozenIntegrityPath(experimentName)`,
  `computeFrozenIntegrity` / `loadExpectedIntegrity` take the experiment name;
  sidecar file is `experiments/<name>.integrity.json`.
- `packages/core/src/doctor-checks.ts` / `doctor.ts`: `checkFrozenIntegrity`
  takes the experiment name; ledger-kit routing via `isLedgerKitExperiment`.
- `scripts/real-scale-2/write-integrity.mjs`: accepts an experiment name.
- `packages/core/test/doctor.test.ts`: added real-scale-4 semantics test.
- `.gitignore`: ignore `experiments/real-scale-4/` alongside real-scale-2.

All gates pass on the implementation commit:

| Gate | Result |
| --- | --- |
| `pnpm biome check .` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 70 vitest + 13 node-test passed |
| `pnpm build` | pass |
| `git diff --check` | pass |

No optimizer, dashboard, extra provider, worker-count recommender, or
changeability probe was added. `fix-parse-money` was not modified.

## Frozen configuration

See `experiments/real-scale-4.frozen.json` (immutable; verified unchanged after
the run) and its integrity sidecar `experiments/real-scale-4.integrity.json`
(aggregate `68bf910fa8a2521dd6b87aec6a3377e029cc51a70ef616b56b17ba991b627a3b`,
recomputed after the run with the same value).

| Control | Frozen value |
| --- | --- |
| Agent | Codex CLI (`codex exec`, sandbox workspace-write) |
| Agent version | codex-cli 0.147.0 |
| Model | `gpt-5.6-sol` via `--agent-model` / `--model` |
| Reasoning effort | medium (pinned in Codex config) |
| Workers | 1, 2, 4 |
| Repetitions | 3 |
| Seed | 20260817 |
| Tasks | exact `fixtures/ledger-kit/tasks.json` (6 tasks) |
| Task order | repetition-specific seeded order (see below) |
| Validation | identical external scripts (6 baseline-reject validators) |
| Timeout | 180 s per task |
| Integration | off |
| Machine | macOS 13.7.8 Darwin 22.6.0 x86_64, Node v22.14.0, pnpm 10.12.1, git 2.49.0, 4 CPU (i5-7360U), 8 GiB |

Executed command:

```sh
node apps/cli/dist/index.js run \
  --repo /private/tmp/rapture-real-scale-4.178714/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2,4 --repetitions 3 --seed 20260817 \
  --agent codex --agent-model gpt-5.6-sol \
  --output experiments/real-scale-4
```

Doctor result: READY, all 12 checks PASS (NODE_RUNTIME, PNPM_RUNTIME,
GIT_RUNTIME, EXPERIMENT_CONFIG, TASK_INTEGRITY, FIXTURE_INTEGRITY,
REPOSITORY_STATE, WORKTREE_STATE, AGENT_BINARY, AGENT_AUTH, MODEL_CONFIG,
OUTPUT_PATH).

## Task order methodology

Trial seed = `deriveTrialSeed(20260817, repetition)`; Fisher–Yates via
`mulberry32`. Resolved orders (identical for all worker counts at each
repetition, matching the preflight and real-scale-2):

| Repetition | Trial seed | Task order |
| --- | --- | --- |
| 1 | 76716790 | add-volume-discount, one-based-pagination, fix-parse-money, extract-normalize-email, validate-sku, parse-config-comments |
| 2 | 2326709359 | fix-parse-money, add-volume-discount, extract-normalize-email, validate-sku, parse-config-comments, one-based-pagination |
| 3 | 280629220 | add-volume-discount, extract-normalize-email, validate-sku, fix-parse-money, parse-config-comments, one-based-pagination |

## Execution timeline

- Experiment ID `exp-2026-08-19-d207ab81-20b`, started `2026-08-19T12:47:14Z`,
  marked `completed` (runner exit) `13:08:49Z`.
- Repetition-major order: rep 1 (workers 1, 2, 4), rep 2, rep 3.
- First usage-limit block observed on `workers-4-trial-1`
  (`parse-config-comments`, `validate-sku`), then every run of rep 2 and rep 3.

## Trial results

Legend: `accepted` = independently validated accepted tasks; `wall` = trial
wall-clock; `tph` = accepted tasks per wall-clock hour; `val-fail` = validation
failures (includes blocked runs, see note below).

| Workers | Trial | Accepted | Wall ms | Tasks/hour | Agent ms (med) | Val ms (med) | Overhead ms | Val-fail | Blocked by usage limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 5 | 571942 | 31.472 | 96737 | 398 | 936 | 1 | 0 |
| 1 | 2 | 0 | 37765 | 0 | 5479 | 170 | 332 | 6 | 6 |
| 1 | 3 | 0 | 39919 | 0 | 5143 | 181 | 341 | 6 | 6 |
| 2 | 1 | 5 | 389974 | 46.157 | 115072 | 160 | 329 | 1 | 0 |
| 2 | 2 | 0 | 24814 | 0 | 7437 | 224 | 400 | 6 | 6 |
| 2 | 3 | 0 | 29118 | 0 | 7620 | 255 | 603 | 6 | 6 |
| 4 | 1 | 3 | 140184 | 77.042 | 96511 | 182 | 570 | 3 | 2 |
| 4 | 2 | 0 | 24136 | 0 | 13823 | 436 | 754 | 6 | 6 |
| 4 | 3 | 0 | 36700 | 0 | 22933 | 282 | 951 | 6 | 6 |

Note: the "val-fail" counts include usage-limit-blocked runs, which exited 1
with no patch and then failed validation against the unchanged baseline. They
are not genuine task failures. Every blocked run's `agent.stderr.log` contains
`ERROR: You've hit your usage limit. Upgrade to Pro ... try again at Aug 20th,
2026 11:54 PM`, and `result.json` shows `timedOut: false`, exit code 1, empty
`filesChanged`.

## Worker aggregates

Reported by the regenerated report (`rapture report`):

| Workers | Trials | Task runs | Accepted | Median tasks/hour | Validation-fail | Integration-fail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 18 | 5 | 0.000 (only rep 1 nonzero) | 13 | 0 |
| 2 | 3 | 18 | 5 | 0.000 (only rep 1 nonzero) | 13 | 0 |
| 4 | 3 | 18 | 3 | 0.000 (only rep 1 nonzero) | 15 | 0 |

`medianAcceptedTasksPerHour`, `speedup`, and `parallelEfficiency` are `null`
because two of three repetitions per worker count contain no accepted work; the
median over the three values is 0 for every worker count, which is not a
meaningful scaling estimate.

## Repetition-1 only (usable partial evidence)

Repetition 1 is the only repetition with real agent work for all three worker
counts, but workers-4-trial-1 is incomplete (2 of 6 tasks blocked). Paired
repetition-1 values (reported by the tooling, not used for a scaling decision):

| Workers | Accepted | Tasks/hour | S(N) vs w1 | E(N) |
| --- | --- | --- | --- | --- |
| 1 | 5 | 31.472 | 1.000 | 1.000 |
| 2 | 5 | 46.157 | 1.467 | 0.733 |
| 4 | 3 | 77.042 | 2.448 | 0.612 |

`fix-parse-money` failed validation in every completed trial (workers 1 and 2
rep 1, and workers-4 rep 1), consistent with real-scale-2. These numbers are
single-repetition, non-benchmark evidence: workers-4-trial-1 throughput is
distorted because two tasks were never attempted (blocked), and no variance is
available.

## Infrastructure failures

- Account-level Codex usage limit hit during `workers-4-trial-1` and every run
  of repetitions 2 and 3: 38 of 54 runs blocked.
- No worktree, git, validator, or Rapture infrastructure failures. Fixture repo
  remained clean at base commit `05b334152799d386776c9f5c59c68b705a3e9541`; no
  leaked worktrees; main repo working tree clean after the run.
- No timeouts occurred (all blocked runs returned immediately rather than
  timing out).

## Integrity verification

- `experiments/real-scale-4.frozen.json` and `.integrity.json` unchanged from
  the implementation commit.
- Integrity sidecar recomputed after the run: same aggregate
  `68bf910fa8a2521dd6b87aec6a3377e029cc51a70ef616b56b17ba991b627a3b`.
- Manifest task set hash `db3006a82912854977b3cc37f8e7196fd6796fbfc7c7b9f6c848c816043baa01`
  matches the integrity sidecar.
- 9/9 trial directories with 54 run directories present; report regenerates
  from `events.jsonl` with the same trial IDs and orders.

## Methodological limitations

- Three repetitions are a variance probe, not a basis for significance tests.
- One small TypeScript fixture cannot represent coding-agent work in general.
- Only one full repetition (workers 1 and 2) completed; workers-4 rep 1 is
  partial. Median-based scaling statistics are invalid on this data.
- Token/cost fields are `null` (Codex adapter does not scrape undocumented CLI
  usage text).
- The usage limit is account-level and transient; it does not constrain the
  methodology, only the available quota.

## What this experiment proves

- The real 1-vs-2-vs-4 harness runs end to end: doctor READY, provenance
  frozen, 9 trials × 6 tasks launched, artifacts persisted, report regenerated.
- `ledger-kit` validators still distinguish the buggy baseline from documented
  solutions (`fix-parse-money` fails exactly as in real-scale-2).
- An account quota exhaustion is classified as an infrastructure block
  (`REAL_SCALE_4_INFRA_BLOCKED`), not as a scaling result, and missing trials
  are not treated as agent failures or successes.

## What this experiment does not prove

- Whether 2- or 4-worker Codex scales useful throughput relative to 1 worker.
- Whether a scaling wall exists at 4 workers on this host.
- Anything about other providers, repositories, or worker counts.

## Recommendation

Wait for the Codex usage quota to reset (reported reset: Aug 20th, 2026
11:54 PM, i.e. after the run's error message), then re-run the identical frozen
`real-scale-4` configuration without code changes:

```sh
node apps/cli/dist/index.js run \
  --repo /private/tmp/rapture-real-scale-4.178714/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2,4 --repetitions 3 --seed 20260817 \
  --agent codex --agent-model gpt-5.6-sol \
  --output experiments/real-scale-4
```

Do not pool results from different environment fingerprints. Do not tune the
harness mid-experiment. Do not modify `fix-parse-money`.

## Decision

`REAL_SCALE_4_INFRA_BLOCKED`

The frozen real Codex 1-vs-2-vs-4 experiment could not complete because the
Codex account hit its usage limit mid-run, blocking all of repetitions 2 and 3
and part of workers-4 repetition 1. No real scaling conclusion is justified
from this data.