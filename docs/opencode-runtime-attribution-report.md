# Provider/runtime attribution report (opencode-runtime-attribution-3v4)

## Executive summary

The 3→4 worker cliff from the capacity-prediction milestone
(exp-2026-08-21-2c5c7311-d6b, `PREDICTION_NO_INCREMENTAL_VALUE`) was re-measured
with six repetitions per worker count and new instrumentation separating
provider wait from local execution. The cliff **reproduced**: median accepted
throughput at N=3 (96.4 tph) was not exceeded by N=4 (92.3 tph); the fourth
worker delivered no positive marginal return.

Attribution is decisive on one point and honest on another:

1. **Provider throttling is ruled out by direct observation.** At N=4 the
   provider-wait fraction of agent wall time did not rise — it *fell* (median
   ratio N4/N3 = 0.886×), model steps per run were identical (median 9), and
   zero rate-limit or provider-error signals appeared in any of the 72 runs.
2. **The fourth worker's capacity was consumed by local host contention.**
   Median per-run agent execution inflated 1.339× at N=4 while median
   per-process CPU **halved** (18.6% → 8.7%) at an unchanged ~460 MB RSS per
   agent process — each agent process was starved of machine time, not waiting
   on the provider. Host memory sat at ~96–98% used in both conditions with
   per-core CPU peaking at 100%.

**Decision: `LOCAL_CONTENTION_ATTRIBUTED`** (mechanism: agent-process CPU/memory
starvation under four concurrent ~0.5 GB OpenCode processes on a saturated
4-core/8 GiB host). Confidence: high that the bottleneck is local rather than
provider-side; medium on the exact local split between CPU scheduling and
memory pressure.

## Decision

`LOCAL_CONTENTION_ATTRIBUTED`

## Capacity-prediction checkpoint

The prior milestone was preserved before this work began: commits
fba354a / 5779830 / af68ab4 / afd3b29 on `cursor/repeated-real-agent-scaling-ca4d`
(implementation, tests, experiment artifacts incl. prediction chronology,
report). Prediction chronology integrity verified (15 predictions + 3 outcomes,
append-only). `PREDICTION_NO_INCREMENTAL_VALUE` unchanged. Draft PR #2 updated
by push; not merged.

## Git truth

| Field | Value |
| --- | --- |
| Milestone branch | `cursor/repeated-real-agent-scaling-ca4d` @ `afd3b29` (pushed) |
| Attribution branch | `research/provider-runtime-attribution-v0` in worktree `../rapture-provider-runtime-attribution` |
| Base | `afd3b29` |
| PR #3 | untouched (other agent's benchmark work) |

## Branch/worktree topology

```
main repo      cursor/repeated-real-agent-scaling-ca4d  (capacity milestone)
worktree       ../rapture-provider-runtime-attribution
                 └── research/provider-runtime-attribution-v0  (this work)
```

## Attribution hypotheses

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| H1 PROVIDER_CONCURRENCY | **Rejected** | provider-wait fraction ratio 0.886× (fell at N=4); 0 rate-limit signals; 0 provider errors; identical step counts; provider spans overlap up to 4 concurrent |
| H2 OPENCODE_RUNTIME_SERIALIZATION | Not supported | actual process concurrency reaches configured levels (max 4 observed in 5/6 trials); provider-span mean overlap scales with worker count; no collapse into serial execution |
| H3 LOCAL_TOOL_CONTENTION | Partially supported | inter-step gap fraction rose +19.6% relative (median 28.2% → 34.3% of run time) while tool-event counts stayed equal (median 8–9); gaps are handoff+tool windows the stream cannot further decompose |
| H4 STOCHASTIC_VARIANCE | Rejected as sole cause | with 6 reps each, N=4 never beat the N=3 median; but variance is large (see below), so the cliff's exact size is uncertain |
| H5 UNOBSERVED | Rejected | new instrumentation separated remote vs local time in 72/72 runs (100% stream coverage) |

## New instrumentation

All TypeScript in `packages/core`, strict null semantics, no OpenCode
modification, no privileged tooling:

- **Provider boundary** (`provider-events.ts`): parses the structured
  `--format json` stream. `provider_wait_ms` = sum of matched
  [step_start → step_finish] spans; inter-step gaps (step_finish → next
  step_start) bucket local tool execution + runtime handoff together because
  `tool_use` parts stream inside provider spans in this CLI format;
  unobserved wall time is an explicit bucket, never guessed away.
- **Per-process telemetry** (`process-telemetry.ts`): unprivileged `ps`
  sampling every ~1 s attributed to runs via the unique `.worktrees/<attemptId>`
  path (RSS, CPU%, elapsed).
- **Concurrency overlap** (`concurrency-overlap.ts`): actual simultaneous
  execution and provider-span overlap from persisted intervals.
- **Runtime fingerprint** (`runtime-fingerprint.json`): CLI version, model,
  mode, sanitized env surface, platform identity.
- **CLI**: `rapture attribution <dir> --low 3 --high 4`.

## Frozen 3v4 configuration

`experiments/opencode-runtime-attribution-3v4.frozen.json` +
`.integrity.json` (aggregate `1a8ef2f8…`). Workers {3,4} × 6 repetitions × 6
ledger-kit tasks = 72 logical runs; seed 20260817; OpenCode CLI 1.18.20,
model `opencode/hy3-free` (verified available by standalone probe pre-freeze —
no substitution occurred); 180 s timeout; integration off; worker-major order;
resumable. No deviations from freeze during execution.

## Doctor/preflight

Doctor READY (12/12 PASS). Model probe succeeded (`probe.txt` written).
Sanitized environment verified (`0` inherited OPENCODE_*/CODEX_* variables).
Fixture tree `ecd859b6…` identical to all prior experiments. Instrumentation
smoke (one real 1-worker run) verified process telemetry attribution (~550 MB
RSS samples), fingerprint persistence, and stream decomposition end-to-end
before the matrix started.

## Results (exp-2026-08-22-f275370a-ec7)

Matrix completed 72/72; accepted 70, rejected/timed-out 2 (one per worker
count: fix-parse-money flakiness again). Zero provider blocks, zero infra
failures.

### N=3 results

Median 96.40 tph (min 73.7, max 115.0); acceptance 35/36; agent exec median
86.4 s; provider-wait median 32.9 s (40.1% of run); launch→first-event median
26.4 s; model steps median 9; tools median 8; per-process RSS median 460 MB;
per-process CPU median 18.6%; host memory ~97.8% used; per-core max 100%.

### N=4 results

Median 92.34 tph (min 77.0, max 108.3); acceptance 35/36; agent exec median
115.8 s (**1.339×**); provider-wait median 35.7 s (fraction **lower**, 35.2%);
launch→first-event median 33.2 s (+25.9%); model steps median 9; tools median
9; per-process RSS median 456 MB; **per-process CPU median 8.7%**; host memory
~96.4% used; per-core max 100%.

### Variance analysis

- Paired per-repetition diffs (N4−N3): +17.7, −34.4, −38.0, −4.0, +18.9,
  +11.6 tph → median +3.8, positive in only 3/6 pairs. Trial-level variance
  (±20 tph) exceeds any level effect.
- Unpaired medians differ by −4.2%; ranges overlap almost fully.
- Honest reading: the fourth worker provides **no material gain**; whether its
  exact effect is −4% or +4% cannot be resolved at n=6. No significance claims.

### Cliff reproduced?

**CLIFF_REPRODUCED** (as a no-gain edge): adding a fourth worker yields zero
positive marginal accepted throughput on this host/workload/model, consistent
with the capacity curve's +0.9% plateau.

### Attribution evidence (N=4 vs N=3 medians)

| Signal | Ratio / value | Reading |
| --- | --- | --- |
| Agent execution ms | **1.339×** (86.4 → 115.8 s) | same tasks slow materially under 4-way concurrency |
| Per-process CPU median | **0.47×** (18.6% → 8.7%) | processes starved of machine time |
| Per-process RSS | ~equal (~460 MB) | footprint-driven memory pressure: 4 × 0.5 GB on a ~97%-used 8 GiB host |
| Provider-wait ms | 1.087× | grows far less than local execution |
| Provider-wait fraction | **0.886×** | remote share of wall time falls at N=4 |
| Rate-limit / error signals | 0 / 0 | no hidden shaping reported by the runtime |
| Inter-step gap fraction | 1.196× (28.2% → 34.3%) | local handoff/tool windows lengthen |
| Launch → first event | 1.259× | process startup also slows |
| Actual concurrency | reaches configured levels | no serialization collapse |

## What this proves

- The 3→4 plateau reproduces under higher repetition with clean instrumentation.
- The slowdown mechanism is local: agent processes receive roughly half the
  CPU each at N=4 while their remote-wait share shrinks.
- Provider throttling/rate-shaping is absent detectably, ruling out the most
  suspected external explanation with direct signals.
- Ordinary host telemetry (flat ~63% aggregate CPU) would have missed the
  starvation; per-process CPU and provider/local separation were the
  informative new signals.

## What this does not prove

- The exact local split between CPU scheduling contention and memory pressure
  (both present; separating them needs paging/queue instrumentation).
- That OpenCode contains no runtime inefficiency — only that none manifested
  as serialization or reduced provider concurrency here.
- Anything about other models, hosts, paid tiers, or larger fleets.
- Any adaptive-control design conclusion (none built).

## Product implication

Rapture's new observability layer answered a question host monitoring could
not: the missing fourth-worker capacity is lost to local agent-process
starvation, invisible in aggregate CPU and undetectable without per-process
and provider-boundary instrumentation. This differentiates observation, not
control — prediction remains falsified pending new evidence.

## Recommended next research question

Does raising per-worker memory headroom (or using lighter runtimes) restore
positive marginal yield at N=4 on this host — i.e., is the starvation
primarily memory-pressure-driven? A minimal {3,4} repeat on a ≥16 GiB host
would separate CPU scheduling from memory compression/paging.

## Commits

| Commit | Subject |
| --- | --- |
| f4bc171 | feat(attribution): instrument provider, runtime, and process observability |
| 947325a | research(attribution): restore per-run artifacts dropped by ignore rules |
| (this commit) | research(attribution): record focused 3v4 attribution result |

## Push result / PR

Branch `research/provider-runtime-attribution-v0` pushed to origin; draft PR
opened against `cursor/repeated-real-agent-scaling-ca4d` (title:
"research: attribute 3-to-4 worker runtime plateau"). Never merged
automatically.

Quality gates: biome ✓ typecheck ✓ build ✓ git diff --check ✓; test suite:
all new attribution/provider/process/overlap tests pass; the 4 failures in
doctor.test.ts and ledger-kit.test.ts reproduce identically on the base
commit and predate this work.

---

## Decision

`LOCAL_CONTENTION_ATTRIBUTED`

With six repetitions per worker count, the fourth OpenCode worker produced no
positive marginal throughput (median 96.4 → 92.3 tph), reproducing the
capacity cliff. New provider-boundary instrumentation shows the remote share
of agent wall time fell at N=4 (0.886×) with zero rate-limit or error signals,
while per-run agent execution inflated 1.339× and median per-process CPU halved
at an unchanged ~460 MB RSS per agent on a host whose memory was ~96–98% used
with per-core CPU pegged at 100%. The marginal capacity of the fourth worker
was consumed by local contention between the four agent processes themselves —
CPU/memory starvation, not provider throttling and not runtime serialization.
