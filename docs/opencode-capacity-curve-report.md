# Capacity-prediction experiment report (opencode-capacity-curve)

## Executive summary

Rapture's first capacity-prediction primitive was built and falsified against real
agent traffic. A frozen `opencode-capacity-curve` experiment ran OpenCode CLI
(`opencode/hy3-free`) over the six ledger-kit tasks at workers {1,2,3,4} × 3
repetitions (72 logical runs, matrix completed) on the same 4-core/8 GiB host as
the prior diagnostic, with next-step predictions persisted to an append-only
chronology **before** each held-out worker count executed.

The capacity curve reproduced a clean diminishing-return region: median accepted
throughput 29.5 → 50.4 → 105.5 → **106.4** tasks/hour for 1 → 2 → 3 → 4 workers.
Marginal accepted yield collapsed from +70.8% (1→2) and +109.4% (2→3) to
**+0.9%** (3→4). The deterministic knee detector identified N=3 with medium
confidence, and every prediction is reproducible byte-for-byte from persisted
restricted evidence.

However, the pre-registered prediction comparison went against the hypothesis:
the engineering-outcome-aware Rapture predictor agreed with observed held-out
outcomes on only 1 of 3 steps — no better than memory-only thresholds (1/3) and
worse than the naive always-more-workers baseline and the CPU-only baseline
(2/3 each). The single diminishing step (N=4) was not foreshadowed by any
engineering signal available at N≤3: marginal gain history was strongly
positive (+109%), parallel efficiency above floor (E(3)=1.192), agent latency
deflated (0.81×), and host CPU unsaturated (~65% mean) — while the one resource
signal that did flag saturation (memory ~97%) was constant at every worker
count including the most productive one, so it carried no discriminative value.

**Decision: `PREDICTION_NO_INCREMENTAL_VALUE`.** Do not build an adaptive
Rapture scheduler yet.

## Decision

`PREDICTION_NO_INCREMENTAL_VALUE` (kill criterion 1: the Rapture predictor
provided no useful distinction beyond simple CPU/memory threshold baselines).
The capacity curve itself reproduced well and the knee detector works; the
*prediction* claim failed its holdout test. See "Does engineering-outcome
awareness add predictive value?" below.

## Git baseline

| Field | Value |
| --- | --- |
| Branch | `cursor/repeated-real-agent-scaling-ca4d` (tracks origin) |
| HEAD | `b220650` (Add opencode-scale-4-diagnostic report with wall attribution) |
| Working tree | Implementation uncommitted; new files: capacity/knee/predictors/prediction-store/host-state/counterfactual modules, CLI `capacity` command, 6 test files, frozen config + integrity sidecar, this report |
| PR | none opened |

## Previous diagnostic evidence

Source: `docs/opencode-scale-4-diagnostic-report.md`
(exp-2026-08-20-0941a7e3-b19, decision `BOTTLENECK_MULTI_FACTOR`, mechanism
AGENT_EXECUTION_SLOWDOWN). Observed scaling with `deepseek-v4-flash-free`:
T = 32.5 / 42.0 / 56.1 tasks/hour at 1 / 2 / 4 workers; E(4)=0.432; host memory
~96% used at all worker counts; per-core CPU 98–100% under concurrency. All
prior frozen artifacts verified unchanged during this task (integrity drift
`[]`; enforced by a regression test).

## Capacity prediction design

Smallest falsifiable predictor set, all pure TypeScript in `packages/core`,
all inputs persisted aggregates, no ML, no LLM, no adaptive control:

- `capacity.ts` — explicit metric math: T(N), S(N)=T(N)/T(1),
  E(N)=T(N)/(N·T(1)), marginal throughput gain T(N)−T(P), marginal worker yield
  (T(N)−T(P))/(N−P), incremental worker efficiency, agent latency inflation,
  telemetry aggregation (CPU mean/p95, per-core max, load p95, memory).
- `knee.ts` — deterministic knee detector over named thresholds
  (`lowMarginalGainFraction=0.15`, `parallelEfficiencyFloor=0.6`,
  `agentLatencyInflationThreshold=1.25`, `cpuSaturationFraction=0.9`,
  `memoryPressureFraction=0.9`, `acceptanceDropThreshold=0.05`). Signals are
  evaluated independently and conflicting evidence is preserved. Returns
  `INSUFFICIENT_EVIDENCE` below two points.
- `predictors.ts` — four baselines (fixed-concurrency, cpu-only, memory-only,
  cpu+memory) plus the Rapture outcome-aware predictor; states
  PRODUCTIVE / DIMINISHING_RETURNS / SATURATING / INSUFFICIENT_EVIDENCE;
  descriptive evaluation only (no significance claims).
- `prediction-store.ts` — append-only JSONL chronology; duplicate predictions
  or outcomes for the same step are refused (`PredictionAlreadyExistsError` /
  `OutcomeAlreadyExistsError`).
- `experiment.ts` — optional `worker-major` execution order; after each worker
  count completes, predictions for the *next* count are computed from events so
  far and persisted before any of its trials start; outcomes appended once in
  the finalizer. Preflight `host-state.json` snapshot persisted exclusively.

## Metric definitions

| Metric | Formula |
| --- | --- |
| observed_throughput T(N) | accepted tasks / trial wall-clock hours (median across repetitions) |
| speedup S(N) | T(N) / T(1) |
| parallel_efficiency E(N) | T(N) / (N · T(1)) |
| marginal_throughput_gain(N,P) | T(N) − T(P), adjacent tested counts |
| marginal_worker_yield(N,P) | (T(N) − T(P)) / (N − P) |
| incremental_worker_efficiency | yield / T(1) |
| agent_latency_inflation | current median agent-exec ms / base median |
| capacity_knee | first tested N after which every subsequent adjacent step shows low marginal gain with cost-signal support |

## Frozen experiment configuration

`experiments/opencode-capacity-curve.frozen.json` +
`experiments/opencode-capacity-curve.integrity.json` (aggregate
`2d00ad4d…8b7d8`, regenerated after the documented amendment below).

| Control | Value |
| --- | --- |
| Agent | OpenCode CLI 1.18.20, `opencode run --dir <worktree> --model <m> --agent build --format json` |
| Model | `opencode/hy3-free` (**amended**, see Deviations) |
| Workers | 1, 2, 3, 4 |
| Repetitions | 3 |
| Seed | 20260817 |
| Tasks | exact `fixtures/ledger-kit/tasks.json` (6 tasks) |
| Task order | repetition-seeded, identical across worker counts |
| Validation | same 6 external validators |
| Timeout | 180 s per task |
| Integration | off |
| Execution order | worker-major (required for prediction chronology) |
| Telemetry | ~1 s host sampling (4,328 samples) |

### Deviations from the original freeze (provider-forced)

1. **Model substitution.** The frozen model `opencode/deepseek-v4-flash-free`
   was **removed from the provider catalog** during the task window; every
   request returned server-side `UnknownError` (verified with standalone
   probes independent of concurrency). The paid successor
   `opencode/deepseek-v4-flash` was rejected for insufficient account balance.
   After operator approval the freeze was amended to `opencode/hy3-free`,
   selected from remaining free-tier models after a successful standalone
   probe. Absolute comparability with the diagnostic's throughput levels is
   broken; within-experiment comparisons are unaffected (identical model at
   every worker count). Recorded in the frozen file's `deviations` array.
2. **Agent version.** 1.18.18 (diagnostic) no longer installed; 1.18.20 used.
3. **Attempt 1 discarded (infrastructure, not outcome).**
   exp-2026-08-21-6105ee2f-efd completed its matrix but all 72 runs were empty
   rejections caused by the provider outage above (~9 s agent executions, zero
   file changes, server error in every stdout). Its artifacts are preserved
   unchanged as outage evidence; it was excluded from analysis as an invalid
   experiment rather than an unfavorable result.

## Host-state provenance (attempt 2)

Captured preflight at 2026-08-21T13:14:38Z into `host-state.json`: macOS 13.7.8
Darwin 22.6.0 x64, i5-7360U (4 cores), 8 GiB, Node v22.14.0, Rapture RSS
60 MB, load 1m 40.6 (decaying), free memory 0.10 GB. Sanitized environment:
**zero inherited `OPENCODE_*` variables** (attempt 1 had two; the documented
pollution vector was closed). Preflight warned about 19 processes matching
known coding-agent patterns — all belonging to the idle ChatGPT desktop app;
nothing was killed and they consumed ≤3% CPU. Fixture repo clean at base tree
`ecd859b685b8673f0aa27338a0cb7715f45012eb` — identical to the diagnostic's
fixture tree.

## Doctor result

READY — all 12 checks PASS (NODE_RUNTIME, PNPM_RUNTIME, GIT_RUNTIME,
EXPERIMENT_CONFIG, TASK_INTEGRITY, FIXTURE_INTEGRITY, REPOSITORY_STATE,
WORKTREE_STATE, AGENT_BINARY, AGENT_AUTH, MODEL_CONFIG, OUTPUT_PATH).
Artifacts: `experiments/opencode-capacity-curve/doctor.json`,
`runner-fingerprint.json`.

## Results (exp-2026-08-21-2c5c7311-d6b)

Matrix completed 72/72 logical runs, 12/12 trials, 64 accepted / 5 rejected /
3 timed out, 0 provider blocks, 0 infrastructure failures, 0 interrupted.

### Per-worker results

| Workers | Accepted | Acceptance | Median tph | Min–Max tph | S(N) | E(N) | Agent ms (med) | Latency infl. vs 1 | CPU mean | Mem used | Load p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 13/18 | 0.722 | 29.49 | 12.68–33.30 | 1.000 | 1.000 | 111,786 | 1.000× | 63.4% | 98.6% | 163.6 |
| 2 | 17/18 | 0.944 | 50.36 | 49.27–66.97 | 1.708 | 0.854 | 113,349 | 1.014× | 63.1% | 98.7% | 293.2 |
| 3 | 17/18 | 0.944 | 105.46 | 65.81–121.29 | 3.576 | 1.192 | 92,126 | 0.824× | 65.1% | 97.3% | 137.7 |
| 4 | 17/18 | 0.944 | 106.42 | 88.56–123.30 | 3.608 | 0.902 | 91,744 | 0.821× | 63.0% | 96.5% | 74.3 |

### Marginal throughput by added concurrency

| Step | Δtph | Δ% | Yield/worker | Incremental eff. | Latency inflation |
| --- | --- | --- | --- | --- | --- |
| T(2)−T(1) | +20.87 | +70.8% | +20.87 | 0.708 | 1.014× |
| T(3)−T(2) | +55.10 | +109.4% | +55.10 | 1.868 | 0.813× |
| T(4)−T(3) | **+0.96** | **+0.9%** | +0.96 | 0.033 | 0.996× |

### Curves

- **Throughput**: rises steeply then flatlines exactly at the 4th worker — a
  clean capacity knee between N=3 and N=4.
- **Parallel efficiency**: 1.000 → 0.854 → 1.192 → 0.902. The superlinear
  E(3)>1 is repetition variance (min 65.8, max 121.3 tph at N=3), not a
  physical effect.
- **Agent latency inflation**: ~flat (1.01×, 0.82×, 1.00× relative to previous)
  — unlike the diagnostic, agent execution did **not** slow materially with
  concurrency here; the lighter hy3-free workload never drove per-core CPU to
  the diagnostic's 98–100% levels.
- **CPU / memory**: CPU mean flat at 63–65% at every worker count; memory used
  96.5–98.7% everywhere (constant background constraint, as in the
  diagnostic).
- **Acceptance**: 0.722 → 0.944 → 0.944 → 0.944. The N=1 dip is one bad trial
  (workers-1-trial-1 accepted 3/6). Failures across all 72 runs: fix-parse-money
  (3 rejected, 2 timed out), add-volume-discount (1 rejected),
  extract-normalize-email (1 timed out), validate-sku (1 timed out) — the known
  flaky task dominates again.

### Candidate knee

`KNEE_DETECTED` at **N=3**, confidence medium (deterministic): marginal gain
T(4)−T(3) = +0.9% ≤ 15% threshold with memory-pressure support (96.5% ≥ 90%).
Reasons and per-step signal vectors are persisted and inspectable.

## Pre-registered prediction chronology

All 15 predictions were appended to `predictions.jsonl` **before** any trial of
their target worker count started (timestamps below precede each target's first
trial-start event; enforced and regression-tested). Regeneration from persisted
restricted evidence reproduces them identically (`yes` in CLI output).

| Persisted at (UTC) | Observed | Target | Predictor verdicts (fixed / cpu / mem / cpu+mem / rapture) |
| --- | --- | --- | --- |
| 13:48:01 | [1] | N=2 | PRODUCTIVE / PRODUCTIVE / SATURATING / SATURATING / DIMINISHING_RETURNS |
| 14:06:38 | [1,2] | N=3 | PRODUCTIVE / PRODUCTIVE / SATURATING / SATURATING / PRODUCTIVE |
| 14:17:35 | [1,2,3] | N=4 | PRODUCTIVE / PRODUCTIVE / SATURATING / SATURATING / PRODUCTIVE |

Observed held-out outcomes (appended separately at 14:27:17, never merged into
prediction records): N=2 productive (+70.8%), N=3 productive (+109.4%),
N=4 weak-marginal (+0.9%).

## Baseline and predictor comparison

Descriptive agreement with held-out outcomes (3 evaluable steps; no
significance claims):

| Predictor | Correct | Agreement | Misses |
| --- | --- | --- | --- |
| fixed-concurrency ("more is better") | 2/3 | 66.7% | N=4 |
| cpu-only | 2/3 | 66.7% | N=4 |
| memory-only | 1/3 | 33.3% | N=2, N=3 (flagged saturation throughout) |
| cpu+memory | 1/3 | 33.3% | N=2, N=3 |
| **rapture** | **1/3** | **33.3%** | N=2 (acceptance-dip rule fired on the N=1 variance trial), N=4 (no foreshadowing signal) |

Predicted saturation vs observed latency inflation: neither resource-based
verdict aligned with the (absent) latency inflation; agent latency stayed
≈0.8–1.0× at all worker counts.

## Does engineering-outcome awareness add predictive value?

**No — not demonstrated on this host/workload/model.** Three concrete findings:

1. **The informative signals were silent before the knee.** At the decision
   point (observed {1,2,3}), every engineering signal pointed to more headroom:
   +109% marginal gain, E(3)=1.19, latency deflating. The collapse at N=4 was
   abrupt and not preceded by measurable degradation.
2. **Memory pressure carried no information here.** Memory sat at ~96–98% used
   at every worker count including the most productive (N=3), so memory-threshold
   baselines "predicted" saturation three times and were wrong twice — their
   lone hit was coincidence, not signal.
3. **Rapture's extra sensitivity cut both ways.** Its acceptance-degradation
   rule misfired on the noisy N=1 trial (acceptance 0.722 from one bad
   repetition), costing it the easy N=2 prediction that both naive baselines
   got right.

This satisfies the pre-registered kill criterion: the outcome-aware predictor
did not outperform — or even match — the trivial always-more-workers baseline.

## Retrospective controller simulation

Retrospective arithmetic on completed immutable trials — **not** a live
adaptive controller and not causal evidence:

| Scenario | Throughput | Est. wall (72-task batch) | Worker occupancy |
| --- | --- | --- | --- |
| Stop at knee N=3 | 105.5 tph | 0.61 h | 90.0% |
| Always run max N=4 | 106.4 tph | 0.60 h | 67.8% |

Stopping at the knee would have cost ~0.9% wall time while freeing ~25% of
worker-time — economically interesting, but it rests entirely on the knee being
detectable *in advance*, which is exactly what the prediction protocol showed
it was not (on this evidence).

## What this proves

- The full immutable 1/2/3/4 capacity curve exists on this machine and resolves
  the unknown region between 2 and 4 workers: the knee is at N=3.
- Adjacent marginal engineering yield, latency-inflation, and resource curves
  are computable transparently from persisted raw measurements.
- Prediction chronology works end-to-end: predictions provably persisted before
  held-out execution, immutable afterwards, reproducible offline.
- The deterministic knee detector identifies the true knee from complete data.
- Historical experiments remain bit-identical (integrity-drift regression test).

## What this does not prove

- That Rapture can predict the knee before crossing it — the central product
  question answered negatively on this sample.
- Anything about other models (the original frozen model disappeared
  mid-experiment), hosts, repositories, or task mixes.
- That the N=4 plateau is host-caused (CPU was unsaturated; provider-side
  throttling of a free-tier model is an unexamined candidate).
- Any causal savings from the counterfactual simulation.

## Product implication

Capacity *description* works (curve + knee detection); capacity *prediction*
from lower-concurrency evidence did not beat trivial baselines on a 4-point
curve with 3 repetitions. A throughput-aware scheduler built today would be
guessing expensively.

## Recommended next engineering task

Not adaptive control. The smallest honest next experiment: repeat this exact
frozen configuration on a host with ≥16 GiB free memory (or with a paid,
unthrottled model) to test whether the N=4 plateau persists when the two
constant confounds (memory saturation, free-tier throttling) are removed —
and increase repetitions at the decision-relevant edge (e.g., 6 reps at
{3,4} only) before drawing further prediction conclusions.

## Branch / HEAD / status / PR

- Branch: `cursor/repeated-real-agent-scaling-ca4d`
- HEAD: `b220650`
- Working tree: modified (implementation + new artifacts, uncommitted)
- PR: none

---

Quality gates: `pnpm install --frozen-lockfile` ✓ · `pnpm biome check .` ✓ ·
`pnpm typecheck` ✓ · `pnpm build` ✓ · `git diff --check` ✓ · `pnpm test`:
48/48 new capacity tests pass; 4 failures in `doctor.test.ts` (3) and
`ledger-kit.test.ts` (1) reproduce identically on clean HEAD `b220650` and
predate this work.

## Decision

`PREDICTION_NO_INCREMENTAL_VALUE`

The capacity wall reproduced cleanly (marginal yield +70.8% → +109.4% →
+0.9%; knee at N=3, detected deterministically), and the prediction
infrastructure worked exactly as specified — predictions persisted before each
held-out worker count, immutable, reproducible. But on that honest holdout the
outcome-aware Rapture predictor agreed with reality on 1 of 3 steps versus 2 of
3 for the naive always-more-workers and CPU-only baselines, because every
engineering signal was still improving immediately before the cliff and the
only saturated resource (memory) was equally saturated at the most productive
concurrency. Engineering-outcome awareness added no predictive information
beyond ordinary resource telemetry on this host, workload, and model; per the
pre-registered kill criteria, no adaptive scheduler should be built on this
evidence.
