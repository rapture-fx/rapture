# Rapture experimental methodology

This document codifies the rules every future Rapture experiment must follow.
They exist to prevent post-hoc experimental drift: changing the question after
seeing the data, softening negative results, or promoting retrospective
observations into predictions. Deviations are permitted only when documented
at freeze time and recorded next to the results.

These rules generalize what Rapture already enforces in code (frozen configs +
integrity sidecars, append-only fsynced `events.jsonl`, immutable logical run
identity, deterministic seeded task ordering, independent acceptance) and what
`docs/research-method.md` established for measurement.

## Configuration integrity

1. **Freeze before observing.** The full experimental configuration is frozen
   (status `not_executed`) before any outcome is observed.
2. **Persist integrity hashes.** Every frozen configuration ships with an
   integrity sidecar; drift between freeze and execution invalidates the run
   as evidence for the frozen claim.
3. **Immutable run identity.** Logical runs have stable identities; attempts
   are tracked separately so resumes cannot silently replace evidence.

## Acceptance semantics

4. **Deterministic independent acceptance.** A task is accepted only when all
   configured validation commands pass on its own worktree; integration failure
   zeroes accepted throughput for that matrix while preserving per-task evidence.
5. **Validators outside agent-editable scope.** Acceptance validators live
   outside anything an agent can modify during the run.
6. **Separate failure classes.** Provider blocks, infrastructure failures, and
   interruptions are never counted as task failures — or as successes.

## Identity and environment

7. **Record agent/provider/model identity** (adapter name, version, model,
   reasoning configuration where pinnable).
8. **Record machine/environment identity** (OS, kernel, CPU count/model,
   memory, Node/pnpm/git versions, runner fingerprint).

## Statistical hygiene

9. **Use repetitions.** Three repetitions are an early variance probe, not a
   significance test. No statistical-significance language without a design
   that supports it.
10. **Seed task ordering.** A persisted root seed derives repetition-specific
    deterministic orders, identical across worker counts at matching repetitions.
11. **No cherry-picking.** All pre-registered trials are reported.
12. **No rerunning unfavorable valid outcomes.** A valid stochastic outcome is
    final; only infrastructure/provider failures are rerun-eligible.
13. **Do not pool incompatible configurations.** Different environment
    fingerprints, models, or providers are separate analyses unless pooling is
    declared and justified before the experiment.

## Prediction discipline

14. **Persist predictions before held-out observations.** A prediction only
    counts if it was stored, immutably and timestamped, before the data it
    predicts existed. Retrospective curve-fitting is description (Level 3),
    never prediction (Level 4+).
15. **Pre-register kill criteria** whenever a product hypothesis is being
    tested, including the decision value that stops the line of work.

## Reporting discipline

16. **Preserve negative results.** Negative outcomes are first-class research
    products (see `PREDICTION_NO_INCREMENTAL_VALUE`) and may not be dropped,
    softened, or reframed as partial positives.
17. **Document deviations from freeze.** Any deviation from the frozen config
    appears adjacent to the results, with cause.
18. **Distinguish simulation from intervention.** Retrospective analysis of a
    completed experiment can support Level ≤ 3 claims; claims about control
    (Level 6) require a live intervention against a pre-registered baseline.
19. **State what each experiment does not prove.** Every experiment report ends
    with explicit non-claims.

## Worked examples from existing experiments

- The `opencode-scale-4-diagnostic` run froze configuration + integrity hash
  (`bc161095…`), executed the exact frozen command, and reproduced the wall —
  rules 1–2, 7–8, 10 applied.
- Its attribution (host CPU saturation + memory pressure → agent-execution
  slowdown) relied on telemetry captured *during* execution, ruling out Rapture
  overhead, validation, worktree, and provider causes — rule 6's discriminating
  spirit and RQ3 method.
- The capacity-prediction result was recorded as
  `PREDICTION_NO_INCREMENTAL_VALUE` with chronology persisted before held-out
  execution — rules 14–16 applied to a negative outcome.

## What this methodology does not do

It does not define metrics (`docs/research-program.md`, metric contract), map
evidence to claims (`docs/evidence-and-claims.md`), or make product decisions
(`docs/product-thesis.md`). When those documents disagree with measured
evidence, the evidence wins and the documents get corrected — through this
repository's review process, not by silent edits.
