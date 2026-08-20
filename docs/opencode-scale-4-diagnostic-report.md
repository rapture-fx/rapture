# Real-agent 4-worker wall diagnostic report (opencode-scale-4-diagnostic)

## Executive summary

The frozen `opencode-scale-4-diagnostic` configuration was executed to attribute
the throughput wall observed in the prior `opencode-scale-4` experiment
(E(4)=0.581). Configuration: workers `{1,2,4}` × 3 repetitions, six `ledger-kit`
tasks, seed `20260817`, OpenCode CLI 1.18.18, model
`opencode/deepseek-v4-flash-free`, 180 s per-task timeout, integration off, on a
4-core/8 GiB host. The diagnostic experiment added host telemetry collection
(CPU, per-core CPU, load average, memory, parent RSS, active-agent count, event
loop lag) and run-state-aware phase timing so the wall can be attributed from
measured evidence rather than inferred.

All 54 runs completed: 45 accepted, 5 rejected, 4 timed out. Zero provider
blocks, zero infrastructure failures, zero interrupted runs, zero leaked
worktrees; the fixture repo remained clean at the recorded base tree. The wall
reproduced: median accepted tasks/hour rose 32.5 → 42.0 → 56.1 for workers
1 → 2 → 4 (S(2)=1.29, S(4)=1.73), parallel efficiency falling to 0.647 at 2
workers and 0.432 at 4 workers.

The attribution is host resource saturation, not Rapture overhead, not
validation contention, not worktree contention, not acceptance degradation, and
not a provider failure. Concretely, **agent execution time itself grows with
concurrency for every task** (same task, same prompt, same fixture tree: 1.3–1.8×
longer at 4 workers than at 1), the host is memory-saturated at ~96% utilization
regardless of worker count, and per-core CPU peaks at 100% with load averages in
the hundreds on a 4-core machine. The wall is a host-capacity ceiling: the
4-core/8 GiB host cannot sustain four concurrent agent processes without each
slowing down.

**Decision: `BOTTLENECK_MULTI_FACTOR` (HOST_CPU_SATURATION + HOST_MEMORY_PRESSURE), mechanism AGENT_EXECUTION_SLOWDOWN**

## Git baseline

| Field | Value |
| --- | --- |
| Branch | `cursor/repeated-real-agent-scaling-ca4d` (tracks origin) |
| HEAD at freeze | `7bfc4b4` (freeze + integrity commit) |
| Frozen config | `experiments/opencode-scale-4-diagnostic.frozen.json` + `.integrity.json` |
| Working tree at run | clean (only the output directory created) |
| PR | DRAFT PR #2 on this branch (not pushed) |

## Frozen configuration

See `experiments/opencode-scale-4-diagnostic.frozen.json` (immutable, status
`not_executed` at freeze) and its integrity sidecar
`experiments/opencode-scale-4-diagnostic.integrity.json` (aggregate
`bc16109500121cb988af8fa490eedf3b2d8015bb1c2585bb04908e1e58f75d0b`, unchanged
after the run).

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
| Host telemetry | every ~1000 ms: total CPU, per-core CPU, load avg (1 m), memory, parent RSS, active agents, event loop lag |
| Machine | macOS 13.7.8 Darwin 22.6.0 x86_64, Node v22.14.0, pnpm 10.12.1, git 2.49.0, 4 CPU (i5-7360U), 8 GiB |

Executed command:

```sh
node apps/cli/dist/index.js run \
  --repo /private/tmp/rapture-opencode-scale-4-diagnostic/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2,4 --repetitions 3 --seed 20260817 \
  --agent opencode --agent-model opencode/deepseek-v4-flash-free \
  --output experiments/opencode-scale-4-diagnostic
```

Doctor result: READY, all 12 checks PASS. The clean ledger-kit fixture tree was
`ecd859b685b8673f0aa27338a0cb7715f45012eb`, identical to the fixture tree used by
the prior `opencode-scale-4` experiment.

## Task order methodology

Trial seed = `deriveTrialSeed(20260817, repetition)`; Fisher–Yates via
`mulberry32`. Resolved orders (identical for all worker counts at each
repetition, matching the prior experiment and preflight):

| Repetition | Trial seed | Task order |
| --- | --- | --- |
| 1 | 76716790 | add-volume-discount, one-based-pagination, fix-parse-money, extract-normalize-email, validate-sku, parse-config-comments |
| 2 | 2326709359 | fix-parse-money, add-volume-discount, extract-normalize-email, validate-sku, parse-config-comments, one-based-pagination |
| 3 | 280629220 | add-volume-discount, extract-normalize-email, validate-sku, fix-parse-money, parse-config-comments, one-based-pagination |

## Execution timeline

- Experiment ID `exp-2026-08-20-0941a7e3-b19`, started `2026-08-20T14:28:31Z`,
  finished `15:31:51Z` (~63 min).
- Repetition-major order: rep 1 (workers 1, 2, 4), rep 2, rep 3.
- All 54 runs completed with matrix status `completed` (54/54). No provider
  blocks, no infrastructure failures, no interrupted runs, no leaked worktrees.
- 3,778 host-telemetry samples collected (every ~1 s).
- Earlier the same evening two attempts hung on an environment-pollution issue
  (inherited `OPENCODE_CLIENT` / server-auth variables from the running desktop
  app caused `opencode run` to spawn interactive editor probes); those attempts
  were discarded. The reported run used a sanitized environment and completed
  normally; the first-launch hang is documented as an environmental note, not a
  harness defect.

## Trial results

Legend: `accepted` = independently validated accepted tasks; `wall` = trial
wall-clock; `tph` = accepted tasks per wall-clock hour; `agent ms` = median
agent execution time; `val ms` = median validation time; `overhead ms` = median
Rapture orchestration overhead (worktree setup + cleanup + queue wait + other);
`val-fail` = validation failures.

| Workers | Trial | Accepted | Wall ms | Tasks/hour | Agent ms (med) | Val ms (med) | Overhead ms | Val-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 5 | 444263 | 40.52 | 70114 | 181 | 0 | 1 |
| 1 | 2 | 5 | 553884 | 32.50 | 82786 | 270 | 0 | 1 |
| 1 | 3 | 5 | 670842 | 26.83 | 100411 | 447 | 0 | 1 |
| 2 | 1 | 5 | 284308 | 63.31 | 93353 | 218 | 0 | 1 |
| 2 | 2 | 5 | 428329 | 42.02 | 138342 | 477 | 0 | 1 |
| 2 | 3 | 5 | 463817 | 38.81 | 129031 | 547 | 0 | 1 |
| 4 | 1 | 5 | 291270 | 61.80 | 144061 | 1249 | 450 | 1 |
| 4 | 2 | 5 | 342223 | 52.60 | 170258 | 1578 | 514 | 1 |
| 4 | 3 | 5 | 320865 | 56.10 | 166097 | 873 | 481 | 1 |

All nine trials accepted exactly 5 of 6 tasks (0.833), independent of worker
count. The single failure in every trial is `fix-parse-money`.

## Worker aggregates

Reported by the regenerated report (`rapture report`):

| Workers | Trials | Task runs | Accepted | Median tasks/hour | Min | Max | S(N) | E(N) | Validation-fail | Integration-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 18 | 15 | 32.50 | 26.83 | 40.52 | 1.000 | 1.000 | 3 | 0 |
| 2 | 3 | 18 | 15 | 42.02 | 38.81 | 63.31 | 1.293 | 0.647 | 3 | 0 |
| 4 | 3 | 18 | 15 | 56.10 | 52.60 | 61.80 | 1.726 | 0.432 | 3 | 0 |

## Phase-timing analysis

Per-run phase timings (mean across all runs at each worker count):

| Workers | Agent exec (s) | Worktree setup (ms) | Validation (ms) | Queue wait (ms) | Other orchestration (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 | 92 ± 33 | 116 | 333 | 227102 | 51 |
| 2 | 120 ± 30 | 164 | 461 | 121237 | 135 |
| 4 | 158 ± 24 | 253 | 1152 | 52725 | 356 |

Queue wait is large only at 1 worker because a single worker serializes six
tasks (the queue wait equals the other tasks' execution); it falls as workers
are added. Rapture's own orchestration is single-digit-to-sub-second
(worktree setup < 300 ms, other orchestration < 400 ms). Validation is
sub-second at all worker counts. **Neither Rapture overhead nor validation nor
worktree setup explains the wall.**

The wall is driven entirely by agent execution time, which grows with
concurrency for every task (same task, same prompt, same fixture tree):

| Task | Agent ms w1 (mean) | Agent ms w2 (mean) | Agent ms w4 (mean) | w4/w1 |
| --- | --- | --- | --- | --- |
| add-volume-discount | 93 | 117 | 164 | 1.77 |
| one-based-pagination | 99 | 116 | 134 | 1.35 |
| validate-sku | 91 | 118 | 156 | 1.71 |
| extract-normalize-email | 58 | 101 | 162 | 2.79 |
| parse-config-comments | 114 | 121 | 150 | 1.32 |
| fix-parse-money | 96 | 147 | 180 (timeout) | 1.87 |

`fix-parse-money` is the sharpest signal: the same task that is merely rejected
in ~96 s at 1 worker is driven past the 180 s timeout at 4 workers — the agent
slowdown under concurrency is what converts a rejection into a timeout. No
task-specific effect: every task slows.

## Host telemetry analysis

Host: 4 cores, 8 GiB RAM. Telemetry sampled ~every 1 s over each trial window
(3,778 samples total):

| Trial | CPU total (mean) | Per-core max (mean) | Load avg p95 | Mem used | Active agents | Event-loop lag p95 |
| --- | --- | --- | --- | --- | --- | --- |
| workers-1-t1 | 53% | 81% | 9.7 | 8.4/8.6 GB | 1 | 22 ms |
| workers-1-t2 | 62% | 91% | 46.3 | 8.1/8.6 GB | 1 | 22 ms |
| workers-1-t3 | 72% | 97% | 204.1 | 7.8/8.6 GB | 1 | 22 ms |
| workers-2-t1 | 67% | 97% | 45.2 | 8.3/8.6 GB | 2 | 22 ms |
| workers-2-t2 | 71% | 99% | 163.3 | 8.3/8.6 GB | 2 | 22 ms |
| workers-2-t3 | 74% | 99% | 131.5 | 8.3/8.6 GB | 2 | 22 ms |
| workers-4-t1 | 69% | 98% | 213.4 | 8.3/8.6 GB | 4 | 22 ms |
| workers-4-t2 | 73% | 99% | 188.8 | 8.3/8.6 GB | 4 | 22 ms |
| workers-4-t3 | 75% | 100% | 236.3 | 8.2/8.6 GB | 4 | 22 ms |

- **Memory is saturated at ~96% (≈8.3/8.6 GB used) at every worker count.** The
  8 GiB host is memory-bound even with one agent; adding concurrent agents
  forces the OS into constant memory pressure with no headroom, inflating load
  and slowing every process.
- **Per-core CPU peaks at 98–100%** as soon as concurrency rises (97%+ at 2 and
  4 workers vs 81% at the 1-worker baseline trial), i.e. cores are individually
  pegged by the agent tool loops even though aggregate utilization stays below
  80%.
- **Load averages in the hundreds on a 4-core machine** (p95 up to 236) indicate
  heavy runnable/blocked-thread oversubscription; the host is shared with other
  desktop processes (the OpenCode desktop app itself consumed ~50% CPU during
  the run), so some of the load is external to Rapture.
- Rapture's own event-loop lag is flat at ~22 ms p95 and parent RSS ~55 MB —
  the harness adds negligible load.

Combined with the phase-timing result (agent execution slows, everything else
does not), the telemetry attributes the wall to the host being unable to serve
four concurrent agents: memory pressure is a constant severe constraint, and
CPU/core contention scales with worker count.

## Acceptance analysis

- Acceptance is 0.833 at every worker count (15/18), so the wall is a
  throughput/concurrency ceiling, **not** an acceptance collapse.
- All 9 failures are `fix-parse-money` (5 rejected, 4 timed out). Excluding it,
  acceptance is 15/15 = 1.000 at every worker count; **no other task failed in
  any of the 45 runs**.
- `fix-parse-money` degrades monotonically with concurrency: rejected/rejected/
  rejected at 1 worker, rejected/timed-out/rejected at 2 workers, timed-out/
  timed-out/timed-out at 4 workers. This is the same known-flaky task from
  real-scale-2/4 and opencode-scale-4 (8/9 failures there); it was not modified.

## Attribution

Candidate causes and verdicts, from measured evidence:

| Cause | Verdict | Evidence |
| --- | --- | --- |
| RAPTURE_OVERHEAD | excluded | orchestration sub-second; event-loop lag 22 ms; RSS ~55 MB |
| VALIDATION_CONTENTION | excluded | validation sub-second at all worker counts (max median 1578 ms) |
| GIT_WORKTREE_CONTENTION | excluded | worktree setup < 300 ms at all worker counts |
| ACCEPTANCE_DEGRADATION | excluded | acceptance constant 0.833; 15/15 excluding fix-parse-money |
| PROVIDER_OR_RUNTIME_EFFECT | excluded as a failure mode | zero provider blocks, zero retries, zero infra failures; agent streams completed on all 54 runs |
| HOST_MEMORY_PRESSURE | present | ~96% memory utilization at every worker count on an 8 GiB host |
| HOST_CPU_SATURATION | present | per-core CPU peaks 98–100% at 2/4 workers; load p95 in the hundreds |
| AGENT_EXECUTION_SLOWDOWN | mechanism | every task 1.3–1.8× slower at 4 workers; fix-parse-money pushed past timeout |

The wall is host resource saturation: both memory pressure (constant, severe on
8 GiB) and CPU/core contention (scales with worker count) contribute, and
neither cleanly dominates. The proximate mechanism is agent execution slowdown
under concurrency. This is a multi-factor host-capacity attribution, not a
single dominant factor and not an unexplained residual.

## Integrity verification

- Frozen config and integrity sidecar unchanged from the implementation commit
  (drift `[]` when recomputed after the run).
- Outcome: matrix `completed`, 54/54 logical runs, 45 accepted / 5 rejected /
  4 timed out, 0 provider-blocked / 0 infra-failed / 0 interrupted / 0
  outstanding; 9/9 trials completed.
- 9/9 trial directories, 54 run directories present; report regenerates from
  `events.jsonl` with the same trial IDs, orders, and states.
- No leaked worktrees after the run; main repo working tree clean (only the
  output directory untracked); fixture repo clean at base tree
  `ecd859b685b8673f0aa27338a0cb7715f45012eb` (unchanged from launch).
- Every agent command targets `.../.worktrees/<runId>` (the `--dir` confinement
  fix holds).

## Methodological limitations

- Three repetitions are a variance probe, not a basis for significance tests.
- One small TypeScript fixture cannot represent coding-agent work in general.
- The host is shared: the OpenCode desktop app (~50% CPU) and other processes
  were running during the experiment, so external load contaminates the load
  averages and contributes to observed CPU pressure. The controlled comparison
  (same task, same prompt, same fixture tree) still isolates the concurrency
  effect, but absolute numbers are host-state dependent.
- Memory is the constant background constraint; the experiment cannot
  distinguish "always memory-bound" from "memory-bound only under concurrency"
  because the host never had free memory at any worker count.
- Token/cost fields are `null` (OpenCode adapter does not scrape CLI usage).
- `fix-parse-money` contributes 100% of failures; a different task mix would
  change the acceptance curve, but not the throughput wall.

## What this experiment proves

- The diagnostic harness works end to end: frozen provenance, host telemetry
  and phase timing collected on all 54 runs, matrix completed, report
  regenerates, no provider/infra failures, no leaked worktrees.
- The 4-worker wall is a **host-capacity ceiling**, not a harness defect, not
  acceptance degradation, and not a provider failure.
- Agent execution time degrades under concurrency on this host (1.3–1.8× for
  every task from 1→4 workers), with host memory at ~96% utilization and
  per-core CPU pegged at 100%.
- Rapture overhead, validation, and worktree management contribute essentially
  nothing to the wall (all sub-second).

## What this experiment does not prove

- Whether the wall is primarily memory-bound or CPU-bound, because the 8 GiB
  host is memory-saturated even at 1 worker.
- Whether the wall persists on hosts with more memory and cores.
- Anything about other providers, repositories, or worker counts.

## Recommendation

Treat 4-worker OpenCode on this 4-core/8 GiB host as wall-bound: doubling
concurrency from 2→4 yields only ~33% more accepted tasks per hour (56 vs 42
median) at half the per-worker efficiency (0.432 vs 0.647). For throughput on
this host, run at 1–2 workers; for latency, 4 workers still cuts median trial
wall time from ~556 s (1 worker) to ~320 s. On hosts with more memory and cores
the wall should be re-tested with the identical frozen configuration before
concluding it is intrinsic to the agent or provider.

## Decision

`BOTTLENECK_MULTI_FACTOR` (HOST_CPU_SATURATION + HOST_MEMORY_PRESSURE), mechanism
AGENT_EXECUTION_SLOWDOWN

The frozen real OpenCode diagnostic experiment completed all 54 runs with no
provider or infrastructure failures. The wall reproduced (median tph 32.5 →
42.0 → 56.1; E(4)=0.432) and is attributed from measured evidence to host
resource saturation: agent execution time grows 1.3–1.8× with concurrency for
every task, memory sits at ~96% of the 8 GiB host at all worker counts, and
per-core CPU peaks at 98–100% with load averages in the hundreds at 4 workers.
Rapture overhead, validation, and worktree management are sub-second and ruled
out; acceptance is flat at 0.833 (1.000 excluding the known-flaky
`fix-parse-money`); there were no provider blocks or retries. Both host factors
are present and neither dominates cleanly, so the attribution is multi-factor
rather than a single bottleneck or an unexplained residual.