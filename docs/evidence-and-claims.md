# Rapture evidence ladder and claim registry

This document defines exactly what evidence level permits which claim, where
the program currently stands, and which claims are supported, falsified, open,
or prohibited. It is the single source of truth for "what has Rapture shown?".

## Evidence ladder

| Level | Name | Permitted claim | Current status |
| --- | --- | --- | --- |
| 0 | INSTRUMENTATION | Rapture records experiment evidence reproducibly. | **SUPPORTED** — fake-agent preflight matrices, append-only fsynced events, integrity sidecars. |
| 1 | WALL_OBSERVED | A scaling wall was observed for a specific frozen configuration. | **SUPPORTED** — `opencode-scale-4` (`exp-2026-08-19-2c4eba1a-f52`, S(4)=2.32, E(4)=0.581); wall reproduced in the diagnostic run (E(4)=0.432). |
| 2 | BOTTLENECK_ATTRIBUTED | Measured evidence supports a mechanism for the wall. | **SUPPORTED FOR SPECIFIC CONFIGURATION ONLY** — host CPU saturation + memory pressure → agent-execution slowdown on the 4-core/8 GiB macOS host; Rapture overhead, validation, worktree, and acceptance causes independently ruled out (`BOTTLENECK_MULTI_FACTOR`). |
| 3 | KNEE_DESCRIBED | The capacity knee can be identified retrospectively from complete data. | **SUPPORTED FOR ONE MEASURED CURVE** — deterministic knee detection at N=3 on the 1/2/3/4 capacity curve (commit `afd3b29`). Retrospective only. |
| 4 | KNEE_PREDICTED | The capacity knee can be predicted before crossing it. | **FAILED ON FIRST PREDICTION EXPERIMENT** — see below. |
| 5 | PREDICTION_BEATS_BASELINES | Outcome-aware prediction adds value beyond ordinary resource baselines. | **NOT DEMONSTRATED** (currently contradicted). |
| 6 | CONTROL_IMPROVES_OUTPUT | A live intervention improves accepted output/time/compute/cost vs pre-registered baselines. | **NOT JUSTIFIED** by current evidence; no scheduler work is warranted yet. |
| 7 | GENERALIZED | The effect replicates across materially different environments. | **NOT DEMONSTRATED**. |
| 8 | COMMERCIAL_VALUE | The measured improvement creates economically meaningful customer value. | **NOT DEMONSTRATED**. |

### The negative prediction result (must not be erased)

The first outcome-aware capacity predictor did **not** outperform trivial
baselines: predictions persisted before held-out execution agreed with held-out
outcomes on 1 of 3 concurrency steps, versus 2 of 3 for naive baselines.
Decision: **`PREDICTION_NO_INCREMENTAL_VALUE`** (recorded at commit `afd3b29`).

Consequences that remain binding until new evidence changes them:

- Level 4 stays failed for the tested predictor family and fixture.
- The observed 3→4 plateau was **not foreshadowed** by currently available
  engineering signals.
- An adaptive scheduler is **not justified** by current evidence.
- Future prediction attempts must state what observability or workload change
  could plausibly alter this result before running again.

## Claim registry

Categories are mutually exclusive. A claim appears in exactly one.

### SUPPORTED

- Rapture can run reproducible real-agent concurrency experiments end to end.
- Rapture can measure accepted engineering throughput, speedup, and parallel
  efficiency from persisted experiment evidence.
- Rapture can preserve prediction chronology immutably *before* held-out
  execution.
- Rapture can account for engineering output against agent-time and
  machine-time, and against explicit monetary cost when pricing provenance is
  supplied (Engineering Economics V0).
- Real-Work Benchmark V0 provides benchmark schema, deterministic validation,
  provenance, and multiple task classes (as a schema/capability statement).
- Rejected and timed-out runs consume resources and cost while contributing
  nothing to accepted output.

### SUPPORTED_FOR_SPECIFIC_CONFIGURATION_ONLY

- A 4-worker OpenCode scaling wall occurred on the measured 4-core/8 GiB macOS
  host with `opencode/deepseek-v4-flash-free` on six ledger-kit tasks.
- One diagnostic wall was attributable to host resource saturation causing
  agent-execution slowdown (1.3–1.8× per-task agent-time growth at 4 workers).
- A sharp capacity knee exists at N=3 in the one measured 1/2/3/4 curve.
- Parallel efficiency fell to E(2)≈0.65 / E(4)≈0.43 in that diagnostic matrix.

### FALSIFIED_OR_NOT_SUPPORTED

- The first Rapture outcome-aware predictor added incremental predictive value.
  (**Falsified** on the tested fixture/predictor family.)
- Current evidence justifies an adaptive scheduler. (**Not supported.**)
- Currently available engineering signals foreshadowed the 3→4 plateau.
  (**Not supported.**)

### OPEN_HYPOTHESIS

- Provider/runtime serialization may explain the later N=4 plateau beyond host
  saturation (attribution follow-up in progress).
- Engineering-outcome-aware signals may become predictive with richer
  observability (token streams, provider telemetry) or larger task sets.
- Marginal engineering economics may identify economically inefficient
  concurrency once usage/pricing data accompanies a real matrix.
- Results may generalize across repositories, models, providers, and machines.
- Short-horizon throughput effects may show up later as changeability/rework
  differences (RQ8).

Each open hypothesis names its required experiment type in
`docs/research-program.md` (taxonomy); none may be promoted to a supported
claim without passing through the ladder above.

### PROHIBITED_WITH_CURRENT_EVIDENCE

These claims may not appear in any Rapture document, README, PR description, or
product material:

- "Rapture knows the optimal concurrency for arbitrary coding workloads."
- "Rapture increases engineering productivity in production."
- "Rapture reduces customer AI spend."
- "Rapture generalizes across coding agents."
- Any statistical-significance language for current repetition counts.
- Any proprietary composite score collapsing throughput, efficiency, and cost.

## Advancing the ladder

A level advances only via the experiment types in
`docs/research-program.md` under the rules in `docs/experimental-methodology.md`.
Level 5 requires beating resource-only baselines on held-out steps across more
than one fixture. Level 6 requires a live intervention with pre-registered
baselines and kill criteria. Levels 7–8 require replication across materially
different environments before any commercial claim. If an advance contradicts
this document, update this document in the same PR as the evidence.
