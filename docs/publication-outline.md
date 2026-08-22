# Publication outline (working draft — not a submission claim)

Status: outline only. No literature review has been performed for this task, no
citations are fabricated, and no publication novelty is claimed. Sections below
mark what currently exists as measured evidence versus what must be gathered
before any submission.

Working title options:

1. *Useful Engineering Throughput: Empirical Scaling of Autonomous Coding Agents*
2. *Scaling Autonomous Software Engineering: Throughput, Efficiency, and Bottlenecks*
3. *When More Coding Agents Stop Helping: An Empirical Study of Useful Engineering Throughput*

## Abstract placeholder

One configuration of an autonomous coding agent was executed at increasing
concurrency under frozen configurations with immutable provenance; accepted
engineering throughput (independently validated tasks per wall-clock hour)
reproduced a scaling wall; telemetry captured during execution attributed one
wall to host resource saturation; a capacity knee was identified retrospectively
at N=3; a first outcome-aware predictor failed to beat naive baselines; and
economics accounting connects accepted output to agent-time, machine-time, and
explicit cost. *(Placeholder — numbers and framing to be finalized only after
generalization experiments exist.)*

## Introduction

- Autonomous coding agents are increasingly run at concurrency; nobody measures
  *accepted* output per resource unit.
- Define useful engineering throughput vs raw activity (PRs opened, tokens spent).
- State the measurement-first stance and the evidence ladder.

## Research questions

RQ1–RQ8 from `docs/research-program.md`, verbatim.

## Definitions and metrics

Metric contract from `docs/research-program.md`: T_i(N), T(N), S(N), E(N),
acceptance semantics, agent-hours vs machine-hours, marginal worker yield,
cost-per-accepted-task where valid. Null-propagation rules.

## Rapture measurement architecture

Frozen configs + integrity hashes; append-only fsynced events.jsonl; immutable
logical-run identity; deterministic seeded task ordering; independent
validation outside agent-editable scope; host telemetry sampler; usage/pricing
provenance. (Source: repository implementation + `docs/research-method.md`.)

## Experimental methodology

Condensed rules from `docs/experimental-methodology.md`, emphasizing freeze,
pre-registration of predictions, no cherry-picking, negative-result preservation.

## Initial scaling results

- opencode-scale-4 (`exp-2026-08-19-2c4eba1a-f52`): S(2)=2.17, S(4)=2.32,
  E(4)=0.581 on a 4-core/8 GiB macOS host.
- opencode-scale-4-diagnostic: wall reproduced (E(2)≈0.65, E(4)≈0.43); 54/54
  runs completed; agent execution time grew 1.3–1.8× at 4 workers on identical
  tasks.
- 1/2/3/4 capacity curve: sharp knee at N=3 (retrospective).

## Bottleneck attribution

Host CPU saturation (~100% per-core peaks, extreme load averages) plus memory
pressure (~96% utilization) → agent-execution slowdown; Rapture overhead,
validation contention, worktree management, acceptance degradation, and provider
failure independently ruled out. Explicitly scoped to this host/configuration;
provider/runtime serialization remains open.

## Negative capacity-prediction result

`PREDICTION_NO_INCREMENTAL_VALUE`: chronology persisted before held-out
execution; outcome-aware predictor agreed with held-out outcomes on 1/3 steps
vs 2/3 for naive baselines. The 3→4 plateau was not foreshadowed by available
signals. Reported as a first-class result, with implications for adaptive control.

## Engineering economics

Accepted tasks per agent-hour/machine-hour; rejected and timed-out runs consume
resources but not acceptance; derived-vs-reported cost separation; null policy.
Current monetary results on the diagnostic are honestly null (no usage capture
at the time); the capability is demonstrated on synthetic fixtures.

## Threats to validity

From `docs/research-method.md`: single host, single model/provider, small
synthetic fixtures, three-repetition probes without significance claims,
provider nondeterminism, task-order effects, cache warmth, validator coverage.
Also: knee detection is retrospective on one curve.

## Future generalization experiments

Cross-repository, cross-model/provider, cross-hardware matrices; richer
provider observability; real-workload benchmark integration (PR #3); economics
on real billing data. Each mapped to ladder levels 5–7.

## Related-work categories to research later

(To be surveyed only when publication work actually begins; none reviewed here.)

- empirical software-engineering studies of parallelism and Amdahl's-law-style limits
- CI/build fleet capacity studies
- LLM-agent benchmarking and evaluation literature
- multi-agent orchestration systems reports
- cloud cost-efficiency / unit-economics measurement work

## Conclusion

Placeholder: restate what is demonstrated (measurement, wall observation,
one attribution, retrospective knee), what is falsified so far (first
outcome-aware predictor), and what remains open (prediction, control,
generalization).
