# Rapture research program V0

Status: research contract (documentation only — no runtime behavior).
Related: `docs/research-method.md` (measurement method), `docs/experimental-methodology.md`
(rules), `docs/evidence-and-claims.md` (claim ladder and registry),
`docs/product-thesis.md` (product hypothesis), `docs/publication-outline.md`.

## Primary research question

**Can autonomous software engineering be treated as a resource-bounded computing
workload whose accepted output can be measured, explained, predicted, and improved?**

Rapture studies the conversion of autonomous coding compute into *accepted
engineering outcomes* — tasks that pass deterministic validation outside
agent-editable scope — with the long-term possibility of measuring, diagnosing,
predicting, and improving that conversion efficiency. Every claim Rapture makes
must be traceable to persisted experimental evidence at a stated evidence level
(`docs/evidence-and-claims.md`).

## Research questions

Each question is stated so an experiment can fail it. A question is closed only
by evidence at the corresponding evidence level, never by argument.

- **RQ1 — Scaling shape.** How does accepted engineering throughput scale with
  agent concurrency?
  Falsified for a configuration if measured S(N) shows no reproducible deviation
  from linear scaling across pre-registered repetitions.
- **RQ2 — Efficiency deterioration.** Where and why does parallel efficiency
  deteriorate?
  Answered by locating knees/plateaus in E(N) and attributing them (RQ3).
- **RQ3 — Bottleneck attribution.** Which bottlenecks are local host, runtime,
  provider, validation, repository, or task related?
  Requires discriminating telemetry collected during the wall, not after it.
- **RQ4 — Knee prediction.** Can lower-concurrency evidence predict the next
  concurrency step before it is executed?
- **RQ5 — Outcome-aware prediction.** Does engineering-outcome-aware prediction
  outperform simple resource-only baselines?
  **Current answer: no** — see the negative result below.
- **RQ6 — Control.** Can a control policy improve accepted engineering output
  per time, compute, or cost versus pre-registered baselines?
  Not currently justified; requires Level 6 evidence first.
- **RQ7 — Generalization.** Do results generalize across workloads,
  repositories, agents, providers, and hardware?
  Not demonstrated for any result yet.
- **RQ8 — Long-horizon changeability.** Does short-term autonomous throughput
  affect future changeability/rework?

> RQ8 is explicitly later-stage. It is recorded to keep the program honest about
> long-term intent, and must not become current implementation scope. It is
> gated behind the scaling profiler being stable (see `docs/research-method.md`,
> "Future changeability research").

## Metric contract

All formulas match `docs/research-method.md`, the implemented metrics in
`packages/core/src/metrics.ts`, and Engineering Economics V0
(`docs/engineering-economics-v0.md` on PR #4). Nullable inputs stay nullable;
a metric with missing inputs is `null`, never zero or a guess. No metric may be
combined into a single unexplained composite score, and different objectives
may legitimately prefer different operating points.

| Metric | Formula | Notes |
| --- | --- | --- |
| Accepted engineering tasks | count of runs with all deterministic validation commands passed (and integration passed if enabled) | agent exit code/text is not acceptance |
| Tasks per wall-clock hour | `T_i(N) = accepted_i(N) / wall_hours_i(N)`; reported as median over repetitions | trials never merged before aggregation |
| Speedup | `S(N) = T(N) / T(1)` | null when baseline missing or zero |
| Parallel efficiency | `E(N) = T(N) / (N · T(1))` | null under same conditions |
| Agent execution time | sum / median of per-run `phaseTimings.agentExecutionMs` | monotonic clock; excludes Rapture overhead |
| Acceptance rate | accepted runs ÷ completed runs within a trial | provider-blocked and infrastructure failures excluded from task-failure accounting |
| Marginal throughput gain | `ΔT(N→M) = T(M) − T(N)` for adjacent worker counts | null-propagating |
| Marginal worker yield | incremental accepted tasks between adjacent worker counts | null if either level has zero accepted output |
| Accepted tasks per agent-hour | accepted ÷ (Σ agentExecutionMs / 3.6e6) | Economics V0; counts every run's agent time |
| Accepted tasks per machine-hour | accepted ÷ (Σ trial wall hours) | shared host counted once; never multiplied by worker count |
| Accepted tasks per provider dollar | accepted ÷ derived-or-reported provider cost where valid | null unless complete usage/pricing provenance exists |
| Marginal cost per additional accepted outcome | Δcost(N→M) ÷ Δaccepted(N→M) where valid | null when Δaccepted ≤ 0 or cost unknown |

## Experiment taxonomy

Every future Rapture experiment belongs to exactly one type. "Minimum evidence"
is what the run must persist to support any claim; "invalid claims" are the
claim types the experiment type can never license.

| Type | Purpose | Minimum evidence | Valid outputs | Invalid claim types | Typical decisions |
| --- | --- | --- | --- | --- | --- |
| Instrumentation validation | prove measurement works | frozen fake-agent fixture, formula checks | tool correctness statements | anything about real agents | instrumentation ready/not |
| Scaling experiment | estimate S(N), E(N) for one frozen config | manifest + integrity hash + events + repetitions ≥ 3 | observed wall/knee description for that config | mechanism claims, generalization | WALL_OBSERVED / KNEE_DESCRIBED |
| Bottleneck attribution | explain a reproduced wall | discriminating telemetry captured during execution | attributed mechanism for that config | prediction claims | BOTTLENECK_ATTRIBUTED / BOTTLENECK_MULTI_FACTOR / ATTRIBUTION_INSUFFICIENT |
| Prediction experiment | test forecasting before held-out steps | predictions persisted before held-out execution | predictor-vs-baseline comparison on held-out data | post-hoc "the curve was predictable" | PREDICTION_NO_INCREMENTAL_VALUE / PREDICTION_BEATS_BASELINES |
| Intervention experiment | test live control | pre-registered baseline + intervention arms | causal comparison on that workload | uncontrolled before/after claims | CONTROL_IMPROVES_OUTPUT / CONTROL_NO_IMPROVEMENT |
| Economics experiment | connect output to resources/cost | usage provenance + explicit pricing context | cost-efficiency statements where valid | monetary claims from missing data | ENGINEERING_ECONOMICS_READY / USAGE_UNAVAILABLE_FOR_PROVIDER / COST_DERIVATION_UNSUPPORTED |
| Generalization experiment | replicate across environments | materially different env/config matrix | replication scope statement | single-config extrapolation | GENERALIZED / REPLICATION_FAILED |
| Future changeability experiment | measure long-horizon rework (RQ8, later) | identical subsequent-task budgets across implementations | longitudinal change-cost comparison | static code-quality scoring | deferred — out of V0 scope |

## Cross-workstream status

Statuses marked **[verified]** point at commits/artifacts present in the
repository; **[operator-reported]** come from operator-supplied workstream
reports and were not independently re-executed here.

| Workstream | Status | Source of truth |
| --- | --- | --- |
| Capacity prediction (Agent 1) | `PREDICTION_NO_INCREMENTAL_VALUE`; knee at N=3 detected retrospectively; outcome-aware predictor agreed with held-out outcomes on 1/3 steps vs 2/3 for naive baselines; provider/runtime attribution next/in progress | commit `afd3b29` on `cursor/repeated-real-agent-scaling-ca4d` [verified]; continuation work [operator-reported] |
| Real-Work Benchmark V0 (Agent 2) | `REAL_WORK_BENCHMARK_PARTIAL`; draft PR #3 | PR #3 / branch `research/real-work-benchmark-v0` [verified] |
| Engineering Economics V0 (Agent 3) | `ENGINEERING_ECONOMICS_READY`; draft PR #4 | PR #4 / branch `research/engineering-economics-v0` [verified] |
| Integration Baseline V0 | all four workstreams merged onto `integration/research-v0` from `origin/main` (`bb96ef2`) with historical artifacts verified unchanged; full deterministic suite green under Node v22.14.0 | branch `integration/research-v0` |
| Research methodology & evidence contract (Agent 4) | this document set, draft PR on `research/research-program-v0` | this branch |

This document set deliberately does not depend on code from any other
workstream branch; their reports are treated as research evidence only.
