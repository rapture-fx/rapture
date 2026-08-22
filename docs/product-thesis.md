# Rapture product thesis (hypothesis / PRD seed)

Status: **hypothesis document**. Nothing here is proven market demand. Every
product statement traces to an evidence requirement in
`docs/evidence-and-claims.md`. This is a PRD seed for future validation, not a
commitment to build.

## Problem

Teams operating autonomous coding fleets may consume substantially more
agent/runtime/compute capacity than the accepted engineering output they
receive. The waste is invisible today: provider dashboards show spend, CI shows
green checks, but nobody sees *accepted engineering output per unit of agent
time, machine time, or dollar* — or where marginal capacity stops producing
anything.

## Target user hypothesis

Primary candidates:

- AI engineering / platform teams running coding agents at concurrency
- developer-productivity teams
- autonomous software-factory operators
- coding-agent vendors studying their own scaling behavior
- large engineering organizations running background coding fleets

**Explicit non-target:** single-agent casual developer workflows are not the
initial customer hypothesis. A solo developer running one agent has no
concurrency economics problem for Rapture to measure.

## Current workflow

Today such teams tune worker counts and model choices by anecdote: watch a bill,
vibe-check PR throughput, maybe cap concurrency after rate-limit incidents.
There is no accepted-output denominator, no marginal-yield measurement, and no
attribution when throughput stalls.

## Pain hypothesis

If the measured phenomena (parallel-efficiency collapse, sharp knees, walls
where added workers buy nothing) occur in real fleets — unproven — then teams
are likely silently paying for concurrency whose accepted output is flat, and
diagnosing slowdowns by guesswork because host/provider/runtime attribution is
not instrumented.

## Rapture value hypothesis

Rapture may provide value by:

1. **Measuring** marginal engineering yield of autonomous execution
   (accepted tasks per agent-hour / machine-hour / dollar).
2. **Diagnosing** lost capacity (host saturation vs provider serialization vs
   validation vs task structure) from captured telemetry.
3. **Eventually identifying or applying** more efficient operating
   configurations — identification first; any applied control is gated on
   Level 6 evidence that does not exist yet.

## Existing proven capabilities

Traceable to the claim registry (`docs/evidence-and-claims.md`, SUPPORTED):

- reproducible real-agent concurrency experiments with immutable provenance
- accepted throughput / speedup / efficiency reconstruction from persisted evidence
- prediction chronology persisted before held-out execution
- engineering-economics accounting against agent-time, machine-time, and
  explicit pricing provenance (PR #4)
- benchmark schema with deterministic validation and multiple task classes (PR #3)
- one documented wall attribution on one configuration (Level 2, config-specific)

## Unproven product capabilities

- Predicting the next concurrency step before crossing it (**failed first attempt**;
  `PREDICTION_NO_INCREMENTAL_VALUE`).
- Any control/policy that improves output per time/compute/cost.
- Generalization beyond small synthetic fixtures, one host, one model/agent.
- Economic inefficiency detection on real billing data at fleet scale.
- Any production-integration story (CI hooks, fleet managers).

## Primary product risks

1. **The phenomenon may be fixture-local.** Small synthetic tasks may saturate
   an 8 GiB laptop in ways real repositories on real machines never will.
2. **Vendors may fix it underneath us.** If agent runtimes/platforms solve
   concurrency scaling internally, the measured gap disappears (kill test 2).
3. **Prediction may stay hard.** Outcome-aware signals currently add nothing
   over trivial baselines; without better observability, "predict" stays a
   research word.
4. **Measurement may not move money.** Even real inefficiency may be too small
   relative to engineering salaries to matter commercially (kill test 4).
5. **Provider observability gaps.** Usage metadata is inconsistent across
   providers; monetary claims may stay null where customers most want them.

## North-star outcome

A fleet operator can see, before and while spending: accepted engineering
output per unit of agent time, machine resource, and currency — and trust the
number enough to change concurrency because of it.

## Potential product layers and evidence gates

| Layer | Description | Evidence required before building |
| --- | --- | --- |
| Profiler | measure throughput/efficiency/economics per experiment or fleet window | Levels 0–2 (have them); robust usage capture across ≥2 providers |
| Diagnostician | attribute lost capacity to host/runtime/provider/validation/task | Level 2 reproduced on ≥2 configurations + richer telemetry |
| Predictor | forecast knee/wall before crossing | repair Level 4: beat naive baselines on held-out steps across >1 workload |
| Controller | adjust concurrency live | Level 6: pre-registered intervention beats static configs |
| Fleet optimizer | cross-repo/model/provider allocation policy | Level 7 replication + explicit cost model validated on real billing |

Nothing above profiler is currently justified. This ordering is a direct
consequence of the evidence ladder, not a roadmap commitment.

## Commercial validation questions

- Do platform teams actually cap or tune concurrency today, and what evidence do they use?
- What fraction of agent spend sits behind concurrency levels where marginal yield ≈ 0?
- Would a measured cost-per-accepted-task number change anyone's configuration?
- Is cross-agent portability of the measurement a purchase criterion?
- What usage/pricing metadata can customers legally and technically expose?

## Product kill tests

Rapture must stop or pivot rather than accumulate sophistication when any of
these conditions hold:

| # | Kill test | Implication |
| --- | --- | --- |
| 1 | Outcome-aware signals do not outperform resource-only scheduling across multiple realistic workloads (already indicated by `PREDICTION_NO_INCREMENTAL_VALUE` on the first fixture). | Do not build an outcome-aware scheduler as the primary product. |
| 2 | Scaling inefficiency is mostly solved automatically inside agent vendors/platforms, with no cross-agent gap remaining. | Reassess independent product differentiation; measurement alone may not be defensible. |
| 3 | Real repositories do not reproduce meaningful scaling inefficiency. | Downgrade the empirical product thesis; keep instrumentation work, drop the fleet-value narrative. |
| 4 | Measured inefficiency does not translate into meaningful cost/latency/customer impact. | Research may remain academically interesting but is commercially weak; no commercialization claims. |

A kill test fires on pre-registered evidence, not on opinion. Firing a kill
test produces a decision record in this repository, not a quiet scope change.

## Explicit non-goals

- Not a production scheduler; no adaptive control exists or is planned now.
- No dashboard product surface in this phase.
- No database/billing system; economics are transparent derivations.
- No composite proprietary score.
- No claims of productivity increase or AI-spend reduction for customers — both
  are prohibited claims under current evidence.
