# Task Delegation Signal V0

**Primary decision: `DELEGATION_SIGNAL_INCONCLUSIVE`**

## Executive summary

This workstream asked whether measurable characteristics of an engineering task
explain enough variation in independently verified agent outcomes to inform a
delegation decision. It built a fully crossed corpus — three upstream-derived,
identity-reduced repositories × five task classes, one task per cell — pre-registered
eight structural features per task, froze a worker=1 OpenCode experiment, and ran it.

All 45 runs completed: 38 accepted, 7 rejected, **zero** provider or infrastructure
failures. Outcomes did vary, from a task that never succeeded to nine tasks that
never failed.

**The pre-registered signal criterion was not met, and this is not a positive
result.** Only one bucket (`bug_fix`, −28.9pp) reached the 20-point threshold, where
two were required — and that one bucket failed the "not dominated by a single task
instance" clause outright: its three tasks landed at 0%, 66.7% and 100%.

It is also not a clean negative. Corpus-wide acceptance was 84.4%, with three of five
classes pinned at exactly 9/9. A design where 60% of classes sit on the ceiling cannot
rank those classes against each other, whatever the truth is. Within-class spread
(up to 100pp) exceeded every between-class difference. That is the literal definition
of being unable to separate structural signal from task-specific noise, so the honest
decision is `DELEGATION_SIGNAL_INCONCLUSIVE` rather than a negative result that would
wrongly justify closing the direction.

The one thing that did replicate is at task level, not class level:
`version-diff-release-type` has now failed **9 out of 9** attempts across two
workstreams, two fixture variants and two worker counts.

## Primary decision

`DELEGATION_SIGNAL_INCONCLUSIVE` — the corpus lacked the dynamic range to distinguish
a task-structure effect from task-specific noise. See
[Signal criterion evaluation](#signal-criterion-evaluation) for the arithmetic and
[Potential confounders](#potential-confounders) for why the corpus came out this way.

## Git truth and exact base SHA

| Item | Value |
| --- | --- |
| `origin/main` at start | `321d9c00df65add0d1fd2cf35d8c1691753dc726` (unchanged) |
| Branched from | `56af0afe706e2fe2392ab65515fd1c10789d4564` |
| Branch | `research/task-delegation-signal-v0` |
| Worktree | `../rapture-task-delegation-v0` (fresh, isolated) |
| Node | v22.14.0 |
| pnpm | 10.12.1 |

This branch **stacks on unmerged work**. `research/real-work-external-validity-v1`
(draft PR #8) is a linear descendant of `origin/main` and has not been merged, so
branching from `origin/main` directly would have discarded the semver-derived fixture
this corpus reuses and the formatter finding Phase 1 acts on. Branching from that tip
is identical in tree to `main` + that branch, with linear history. The PR therefore
stacks; both must land, PR #8 first.

Existing worktrees were left untouched.

## Why concurrency research was paused

The concurrency programme built a genuinely trustworthy instrument and then kept
producing answers that were knowable in advance. `REAL_WORK_SCALING_SIGNAL_OBSERVED`
established that two workers finish a fixed task set in about half the wall-clock time
of one — which queueing theory implies for a provider-latency-bound workload — and the
part of that result which looked interesting (`E(2) = 1.26`) turned out to be one
agent abort, not superlinear scaling. The genuinely interesting version of the
question had already failed as `PREDICTION_NO_INCREMENTAL_VALUE`.

More decisively, nothing in the repository consumed the metric. No team was about to
size a fleet based on T(1) versus T(2). Adding benchmark repositories to re-confirm
the same shape would have been a treadmill.

This workstream redirects the same instrument — independent verification, frozen
configs, integrity sidecars, economics primitives — at a decision engineering teams
make constantly and expensively: which work to hand to an agent at all. That decision
is expensive (wasted review time, or work not delegated that should have been),
uncertain (vendor benchmarks are not independent), and frequent.

## Artifact immutability hardening

The previous workstream caught Biome's `--write` reformatting a frozen benchmark
manifest and, before exclusion, 27 raw run artifacts. The fix at the time was to
enumerate the affected directories, which does not survive the next experiment nobody
remembers to add.

Two latent instances of the same bug were already present and are closed here:

- `fixtures/ledger-kit` is hashed by **six historical experiment integrity sidecars**
  and was fully formatter-writable.
- `benchmarks/real-work-v0/validators` are hash-pinned by that suite's manifest and
  were likewise writable.

Neither had drifted — Biome simply happened to agree with their current formatting —
so a rules change on upgrade would have silently invalidated six frozen experiments
and a suite fingerprint.

Exclusions are now **structural rather than enumerative**: `experiments`, `benchmarks`
and `fixtures/ledger-kit` are excluded wholesale, because everything in those trees is
hashed by a manifest or a sidecar.

The guard (`scripts/guards/check-immutable-evidence.mjs`, wired into `pnpm test` and
`pnpm guard:evidence`) asserts **behaviour, not configuration text**. It stages the
protected trees into a scratch workspace, runs `biome format --write`,
`biome check --write` and `biome check --write --unsafe`, then compares all 2,834
protected files byte for byte. It ships with a **negative control** — a guard that
cannot fail proves nothing — asserting that the same check *does* detect mutation when
the exclusions are stripped out. A third test walks every integrity sidecar and every
benchmark manifest and asserts each hashed path falls under a protected root, so the
protected set cannot fall behind the evidence.

It worked in practice: during this workstream `biome check --write` fixed 5 source
files and left the entire `benchmarks/` tree untouched, so no manifest regeneration
was needed — the exact failure mode that bit V1.

## Task-feature schema

Eight characteristics are recorded per task in the manifest, before any agent runs.
They flow through the materialize → run round trip and are persisted on every
`EngineeringTaskRun` as `benchmarkDelegationFeatures`, so the analysis reads them from
run evidence rather than re-joining to a manifest that may have moved.

| Feature | Values |
| --- | --- |
| `taskClass` | bug_fix, small_feature, refactor, test_repair, config_change (+ api_change, unused here) |
| `repositoryId` | version-core, glob-matcher-core, cli-command-core |
| `acceptanceCriteriaType` | unit_test, integration_test, type_contract, static_analysis, behavioral_contract |
| `editableFileCount` | integer; schema-enforced to equal the editable scope size |
| `expectedChangeBreadth` | single_file, multi_file_single_module, cross_module |
| `specificationClarity` | explicit, moderate, underspecified |
| `verificationCostClass` | cheap, moderate, expensive |
| `reversibility` | fully_reversible, reversible_with_review, high_consequence |

`verificationCostClass` is assigned structurally, not by stopwatch: *cheap* is
in-process assertions only, *moderate* spawns child processes to resolve the package,
*expensive* stages several repository copies and runs a full suite in each.

**Limitations were recorded in the freeze, before execution**, not discovered
afterwards: `acceptanceCriteriaType` is collinear with `taskClass`; `editableFileCount`
and `expectedChangeBreadth` are constant across all 15 tasks. Those two therefore
cannot be evaluated at all, and the analysis says so rather than reporting a number.

## Repository inventory and provenance

| Repository | Upstream | Revision | Ref | Licence | Module system |
| --- | --- | --- | --- | --- | --- |
| `version-core` | npm/node-semver | `6e05b76…49a29` | v7.8.5 | ISC | CommonJS |
| `glob-matcher-core` | micromatch/picomatch | `4f41a8e…8767f` | 4.0.5 | MIT | CommonJS |
| `cli-command-core` | tj/commander.js | `ba6d13d…e7834` | v15.0.0 | MIT | ESM |

All three have **zero runtime dependencies**, so each materializes and validates fully
offline with an empty `installCommand`. Machine-readable provenance lives at
`benchmarks/delegation-v0/provenance.json`, hash-protected by the manifest; asset
verification fails closed if it is not.

Each records upstream URL, revision, ref, licence, acquisition date, an
`upstreamSourceSha256` fingerprinting the retained upstream bytes **before** any
transformation, the retained path inventory, and every transformation applied.

### Identity scrubbing

Per Phase 4, non-functional identity cues were removed: READMEs, changelogs, badges,
CI metadata; `package.json` replaced with a neutral manifest (renamed package, no
repository/homepage/bugs/author/funding/keywords); `lib/picomatch.js` renamed to
`lib/glob-match.js`; `CommanderError` renamed to `CliError`.

Two honest qualifications:

- **Removing every README also removes a documentation advantage.** It was done
  uniformly across all three repositories so the condition does not vary between them,
  but it does make every task harder than it would be with docs present.
- **LICENSE files are retained verbatim, including copyright holders**, because the
  licences require it. That is an unavoidable residual identity cue. This phase is
  confound *reduction*, not elimination, and no claim is made that memorization was
  controlled.

## Task inventory by class

Fully crossed: every class appears exactly once per repository, asserted by test.

| Class | version-core | glob-matcher-core | cli-command-core |
| --- | --- | --- | --- |
| `bug_fix` | version-diff-release-type | glob-scan-negation | cli-negated-option-name |
| `small_feature` | version-coerce-options | glob-ignore-callbacks | cli-suggest-similar |
| `refactor` | version-lru-cache-eviction | glob-utils-helpers | cli-argument-contract |
| `test_repair` | version-range-test-repair | glob-match-test-repair | cli-option-test-repair |
| `config_change` | version-subpath-exports | glob-subpath-exports | cli-subpath-exports |

The four `version-core` non-config tasks are **reused verbatim** from the previous
workstream; the other eleven are new. That reuse is itself a confounder — see below.

Operational class definitions, since the boundary is otherwise fuzzy: a **bug_fix**
has one wrong behaviour with a localized fix; a **refactor** has an entire
implementation behind a stable interface that is degenerate, with several related
behaviours wrong together.

## Task-feature assignments before execution

All 15 tasks: `editableFileCount` 1, `expectedChangeBreadth` single_file,
`reversibility` fully_reversible except the three `config_change` tasks
(reversible_with_review, since packaging affects consumers).

| Class | acceptanceCriteriaType | specificationClarity | verificationCostClass |
| --- | --- | --- | --- |
| `bug_fix` | behavioral_contract | explicit | cheap |
| `small_feature` | unit_test | explicit (moderate for cli-suggest-similar) | cheap |
| `refactor` | behavioral_contract | explicit | cheap |
| `test_repair` | integration_test | moderate | expensive |
| `config_change` | static_analysis | explicit | moderate |

## Baseline-reject proof

Every task's validator rejects the frozen baseline on two consecutive runs, via the
benchmark doctor and a dedicated test — 15 of 15 `PROOF_*` checks PASS.

## Known-good-pass proof

Every known-good overlay is accepted twice consecutively, same 15 checks. For the
three `config_change` tasks the known-good is a hand-written manifest; for the rest it
is the upstream implementation (or, for `test_repair`, the corrected suite).

## Read-isolation proof

For all three repositories: no worktree file is a symlink or resolves outside the
worktree; manifest, provenance, validators and known-good overlays all resolve
outside it; no solution appears verbatim; no five-line contiguous block of a solution
that is absent from the baseline appears anywhere in the worktree including `.git`
objects; and a process confined to the worktree cannot resolve `known-good` or
`validators`.

**One real exception is pinned rather than hidden.** Upstream commander implements
`default`, `choices` and `_collectValue` almost identically on `Option` and on
`Argument`, so much of the `cli-argument-contract` solution is recoverable by reading
`lib/option.js`. That makes that task closer to lookup than to reasoning. It is
allowlisted explicitly, with the duplication verified present, so any *new*
lookup-able answer fails the test. It accepted 3/3, which is consistent with being
easy for that reason.

## Frozen experiment configuration

Frozen at `experiments/task-delegation-signal-v0.frozen.json` with a 107-file
integrity sidecar, committed **before** any run was consumed (commit `2d43db1`).

| Parameter | Value |
| --- | --- |
| Worker counts | **1** (no concurrency comparison) |
| Repetitions | 3 |
| Tasks | 15 |
| Logical runs | 45 |
| Seed | 20260823 |
| Execution order | repetition-major |
| Integration | off |
| Timeout per task | 900 s |
| Pricing context | none |

Three runner invocations, one per repository, because a run materializes worktrees
from a single base revision. Acceptance, not throughput, is the measurement, so
splitting by repository does not affect the comparison; per-repository wall times are
not pooled.

Host: macOS 13.7.8, Darwin 22.6.0, x64, 4 cores, Intel i5-7360U, 8 GiB.

## OpenCode CLI version and exact model

| Field | Value |
| --- | --- |
| OpenCode CLI | 1.18.21 |
| Model | `opencode/hy3-free` |

Availability was re-verified by standalone probe immediately before freezing (cost 0,
structured usage). The same model was used by the two prior OpenCode experiments, so
the provider surface stays comparable.

**Deliberately, no capability probing was done against this corpus.** Outcome
variation across tasks *is* the measurement here, so probing it first would have
contaminated the result. This is the opposite of the previous workstream, where
probing existed to avoid a degenerate all-zero comparison, and the difference is
recorded in the freeze. One consequence is visible in the results: nobody checked
whether the corpus was too easy before running it.

## Provider/runtime deviations

**None.** All 45 runs recorded `agentModel = opencode/hy3-free`,
`agentVersion = 1.18.21`, `workerCount = 1`, suite `rapture-delegation-v0@0.1.0`, and
exactly three distinct base tree hashes (one per repository). `deviations` in the
frozen document is empty and stayed empty. Zero provider failures.

## Run completion accounting

| Outcome | Count |
| --- | --- |
| Total logical runs | 45 / 45 planned |
| Accepted | 38 |
| Rejected | 7 |
| Timed out | 0 |
| Provider failures | 0 |
| Validator infrastructure failures | 0 |
| Runs with structured usage | 45 / 45 |

Rejections break down as 6 `validation_failed` and 1 `editable_scope_violation`. One
run produced no file edits at all.

## Overall acceptance baseline

**38/45 = 84.4%** with no task information. This is the number every bucket is
compared against — and, as it turns out, the number that limits what this experiment
could have detected.

## Acceptance by task class

| Class | Accepted | Rate | vs baseline | rep1 | rep2 | rep3 |
| --- | --- | --- | --- | --- | --- | --- |
| `config_change` | 9/9 | 100.0% | +15.6pp | 100% | 100% | 100% |
| `refactor` | 9/9 | 100.0% | +15.6pp | 100% | 100% | 100% |
| `test_repair` | 9/9 | 100.0% | +15.6pp | 100% | 100% | 100% |
| `small_feature` | 6/9 | 66.7% | −17.8pp | 66.7% | 66.7% | 66.7% |
| `bug_fix` | 5/9 | 55.6% | −28.9pp | 66.7% | 33.3% | 66.7% |

Three of five classes are at a hard ceiling. No ranking among them is possible.

## Acceptance by repository

| Repository | Accepted | Rate | vs baseline |
| --- | --- | --- | --- |
| `cli-command-core` | 14/15 | 93.3% | +8.9pp |
| `glob-matcher-core` | 14/15 | 93.3% | +8.9pp |
| `version-core` | 10/15 | 66.7% | −17.8pp |

No repository reaches the 20-point threshold. The `version-core` gap is produced
entirely by its two reused tasks.

## Acceptance by structural feature

| Feature | Bucket | Rate | vs baseline |
| --- | --- | --- | --- |
| `acceptanceCriteriaType` | integration_test | 100.0% | +15.6pp |
| | static_analysis | 100.0% | +15.6pp |
| | behavioral_contract | 77.8% | −6.7pp |
| | unit_test | 66.7% | −17.8pp |
| `specificationClarity` | moderate | 100.0% | +15.6pp |
| | explicit | 78.8% | −5.7pp |
| `verificationCostClass` | expensive | 100.0% | +15.6pp |
| | moderate | 100.0% | +15.6pp |
| | cheap | 74.1% | −10.4pp |
| `reversibility` | reversible_with_review | 100.0% | +15.6pp |
| | fully_reversible | 80.6% | −3.9pp |
| `expectedChangeBreadth` | *(single value)* | — | **cannot be evaluated** |
| `editableFileCount` | *(single value)* | — | **cannot be evaluated** |

None of these reaches 20 points. And because `acceptanceCriteriaType` is collinear
with `taskClass`, and the other varying features are largely determined by class, none
of them is independent evidence — the "moderate clarity = 100%" row, for instance, is
just the three `test_repair` tasks wearing a different label.

## Outcome by individual task

| Task | Repository | Class | Accepted | Median agent (s) |
| --- | --- | --- | --- | --- |
| `version-diff-release-type` | version-core | bug_fix | **0/3** | 114.5 |
| `version-coerce-options` | version-core | small_feature | 1/3 | 138.0 |
| `cli-negated-option-name` | cli-command-core | bug_fix | 2/3 | 114.6 |
| `glob-ignore-callbacks` | glob-matcher-core | small_feature | 2/3 | 188.7 |
| `cli-argument-contract` | cli-command-core | refactor | 3/3 | 84.8 |
| `cli-option-test-repair` | cli-command-core | test_repair | 3/3 | 51.5 |
| `cli-subpath-exports` | cli-command-core | config_change | 3/3 | 20.5 |
| `cli-suggest-similar` | cli-command-core | small_feature | 3/3 | 96.6 |
| `glob-match-test-repair` | glob-matcher-core | test_repair | 3/3 | 61.1 |
| `glob-scan-negation` | glob-matcher-core | bug_fix | 3/3 | 77.8 |
| `glob-subpath-exports` | glob-matcher-core | config_change | 3/3 | 24.2 |
| `glob-utils-helpers` | glob-matcher-core | refactor | 3/3 | 137.3 |
| `version-lru-cache-eviction` | version-core | refactor | 3/3 | 50.7 |
| `version-range-test-repair` | version-core | test_repair | 3/3 | 89.3 |
| `version-subpath-exports` | version-core | config_change | 3/3 | 29.7 |

Eleven of fifteen tasks are perfectly deterministic at 3/3, one at 0/3. Nearly all the
information in this experiment is carried by four tasks.

## Within-class versus between-class variation

| Class | Per-task rates | Within-class spread | Class rate | Distance from baseline |
| --- | --- | --- | --- | --- |
| `bug_fix` | 0% / 66.7% / 100% | **100pp** | 55.6% | 28.9pp |
| `small_feature` | 33.3% / 66.7% / 100% | **67pp** | 66.7% | 17.8pp |
| `refactor` | 100% / 100% / 100% | 0pp | 100% | 15.6pp |
| `test_repair` | 100% / 100% / 100% | 0pp | 100% | 15.6pp |
| `config_change` | 100% / 100% / 100% | 0pp | 100% | 15.6pp |

This table is the core result. For the only two classes that are not on the ceiling,
**within-class spread is three to four times their distance from the corpus baseline**.
Knowing a task's class tells you far less than knowing which task it is. The three
zero-spread classes are not evidence of consistency either — they are three classes
that were uniformly too easy to discriminate.

## Failure modes

| Class | Rejected | Timed out | Infrastructure | No-edit |
| --- | --- | --- | --- | --- |
| `bug_fix` | 4 | 0 | 0 | 0 |
| `small_feature` | 3 | 0 | 0 | 1 |
| `refactor` / `test_repair` / `config_change` | 0 | 0 | 0 | 0 |

Every individual failure:

| Task | Rep | Classification | Files changed |
| --- | --- | --- | --- |
| `version-diff-release-type` | 1, 2, 3 | validation_failed | `functions/diff.js` |
| `version-coerce-options` | 2 | validation_failed | *(none)* |
| `version-coerce-options` | 3 | validation_failed | `functions/coerce.js` |
| `cli-negated-option-name` | 2 | validation_failed | `lib/option.js` |
| `glob-ignore-callbacks` | 1 | **editable_scope_violation** | `lib/glob-match.js`, `test/match.test.js` |

Two are worth naming. The scope violation is the agent editing `test/match.test.js` —
a file belonging to a *different task* — alongside its own; scope enforcement caught
it and the run was rejected rather than being scored as a success. The no-edit run
repeats a failure mode seen in the previous workstream: the agent ends its turn
without changing anything, exiting 0 and not timing out, correctly recorded as a
rejection rather than an infrastructure failure.

## Execution-time results

| Class | Median agent (s) | Accepted | Agent-hours | Accepted / agent-hour |
| --- | --- | --- | --- | --- |
| `config_change` | 27.0 | 9 | 0.0780 | 115.35 |
| `test_repair` | 63.2 | 9 | 0.1675 | 53.73 |
| `refactor` | 84.8 | 9 | 0.2278 | 39.51 |
| `bug_fix` | 108.3 | 5 | 0.2608 | 19.17 |
| `small_feature` | 138.0 | 6 | 0.3533 | 16.98 |

Execution time separates the classes more cleanly than acceptance does — a
`config_change` task takes about a fifth as long as a `small_feature` one and always
succeeds. That is a descriptive observation about this corpus, not a delegation rule:
the config tasks were also the most mechanically specified.

## Economics results with explicit nulls

| Metric | Value |
| --- | --- |
| Runs with structured usage | 45 / 45 (`cli_structured`) |
| Input tokens | 1,075,328 |
| Output tokens | 83,647 |
| Cached input tokens | 4,988,608 |
| Reasoning tokens | 99,937 |
| Provider-reported cost | 0 (free tier) |
| Derived monetary cost | **null** (no pricing context supplied) |
| Machine cost | **null** |
| Cost per accepted outcome, by class | **0** (free tier; not a priced measurement) |
| Accepted per provider dollar | **null** (undefined at zero cost) |

To move from capability evidence to economic delegation evidence, these would have to
be measured and none of them was: **human manual completion time, human review time,
rework time, escaped-defect cost, task business value, failure-risk cost.** None is
estimated here. A cost-per-accepted-task of 0 on a free-tier model says nothing about
whether delegating this work is worth it.

## Signal criterion evaluation

The criterion, fixed in the freeze before execution:

| # | Requirement | Result |
| --- | --- | --- |
| 1 | ≥ 2 pre-registered classes or buckets differ from the corpus baseline by ≥ 20pp | **FAIL** — exactly 1 (`bug_fix`, −28.9pp) |
| 2 | Direction consistent across ≥ 2 of 3 repetitions | PASS for that bucket (3/3) |
| 3 | Not explained solely by provider/infrastructure failures | PASS (0 such runs) |
| 4 | Within-class results not dominated by a single task instance | **FAIL** — `bug_fix` spans 0% / 66.7% / 100% |

**Not met, on two of four requirements.** The threshold was not adjusted after seeing
the data.

## Potential confounders

1. **Ceiling effect.** Corpus-wide acceptance of 84.4%, with 3 of 5 classes at 9/9,
   leaves almost no room to detect a class effect. This is the dominant limitation and
   the main reason the decision is inconclusive rather than negative.
2. **Task-difficulty calibration was uncontrolled, and I am the confound.** The four
   reused `version-core` tasks came from the previous workstream; the eleven new tasks
   were authored *after* seeing which of those were hard. Even with no intent to bias,
   difficulty was never calibrated across repositories, and `version-core` — the only
   repository below ceiling — is precisely the one whose tasks were not written under
   that knowledge. The repository effect and "who wrote the task, and when" are
   confounded.
3. **Feature collinearity, pre-registered.** `acceptanceCriteriaType` is fully
   determined by `taskClass`; `specificationClarity`, `verificationCostClass` and
   `reversibility` are largely determined by it. No feature is independent evidence.
4. **Two features have no variance at all** — `editableFileCount` and
   `expectedChangeBreadth` are constant across all 15 tasks and were never testable.
5. **Memorization is not controlled.** Identity scrubbing reduces cues; LICENSE files
   still name copyright holders, and all three are widely distributed packages.
6. **One task is partly lookup-able** — `cli-argument-contract`, via upstream's
   duplication of `Argument` methods onto `Option`.
7. **One model, one host, one provider, n=3.** No statistical significance is claimed
   or supported.

## What this proves

- The measurement instrument works on a multi-repository, multi-ecosystem corpus:
  45/45 runs completed with zero provider or infrastructure failures, features
  recorded on every run, and outcomes cleanly separated into rejection, scope
  violation, timeout and infrastructure failure.
- Independently verified outcomes are **highly reproducible per task**: 11 of 15 tasks
  were 3/3 and one was 0/3.
- `version-diff-release-type` has now failed **9/9** across two workstreams, two
  fixture variants (identity-scrubbed and not) and two worker counts. That is the most
  reproducible finding in the programme — and it is at the level of a *specific task*,
  not a task class.
- Editable-scope enforcement caught a real violation in a live run.
- A fully crossed corpus with pre-registered features is buildable and provable, and
  the immutability guard closed two latent bugs affecting historical evidence.

## What this does not prove

- **Not that task structure carries no signal.** The corpus was too easy to test the
  hypothesis. Absence of evidence here is mostly absence of dynamic range.
- **Not that task structure does carry signal.** The criterion failed; nothing here
  supports a positive claim.
- **Nothing at instance level.** No probability can be attached to a future ticket.
- **Nothing about economics or ROI.** No human time, review or rework cost was
  measured; the model was free-tier.
- **No universal delegation rule**, and no generalization to other repositories,
  models, agents or hosts.
- **Nothing that justifies a router, scheduler or predictor.**
  `PREDICTION_NO_INCREMENTAL_VALUE` and `LOCAL_CONTENTION_ATTRIBUTED` are unchanged.

## Product implication

The thesis — that teams need evidence about *what* to delegate — is not damaged by
this result, but it is not supported by it either. What this run does establish is
that the naive version of the study does not work: build a corpus, measure acceptance
by class, read off a ranking. At 84.4% baseline acceptance the ranking is mostly
ceiling.

The actionable lesson is about **corpus design, not product direction**. A delegation
study needs tasks calibrated to sit away from both ceiling and floor, difficulty
assigned independently of the person who knows the answers, and features that vary
independently of class. None of those three held here.

Per Phase 13, the research thesis is **not** updated: no task-structure-conditioned
outcome separation was demonstrated, so there is nothing earned to write down.

## Kill-criterion status

| Criterion | Status |
| --- | --- |
| `DELEGATION_BENCHMARK_INVALID` — baseline and known-good not separable | Not triggered; 15/15 separated deterministically, twice each |
| `DELEGATION_CONFIDENTIALITY_BLOCKED` — known-good readable from the worktree | Not triggered; isolation proven, with one documented intra-repository duplication |
| Repository requires unstable services or credentials | Not triggered; all three are zero-dependency and fully offline |

## Quality gates

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm biome check .` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` (220 vitest + 13 + 3 node:test) | PASS |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| benchmark doctor — delegation-v0 | PASS (15/15 proofs, source tree clean) |
| benchmark doctor — real-work-v0 (0.1.1) | PASS, unchanged |
| benchmark doctor — real-work-v1 (0.2.0) | PASS, unchanged |
| Baseline-reject proof, all 15 new tasks | PASS |
| Known-good-pass proof, all 15 new tasks | PASS |
| Known-good read-isolation proof | PASS |
| Editable-scope enforcement | PASS |
| All frozen integrity sidecars | PASS — 8/8, zero drift |
| Artifact formatter-immutability guard | PASS — 2,834 files, incl. negative control |
| Manifest regeneration is a byte-identical no-op | PASS |
| `git status` clean after regeneration | PASS |

## Codex usage confirmation

**Codex was never invoked and consumed no quota.** Every agent invocation used
OpenCode with `opencode/hy3-free`, provider-reported cost 0. Total agent invocations:
45 experiment runs plus 1 pre-freeze availability probe = 46.

## Exact commits

| Commit | Subject |
| --- | --- |
| `fa7e920` | `research: protect immutable experiment evidence from formatter writes` |
| `8df8f4f` | `benchmark: add pre-registered delegation task features` |
| `843b564` | `benchmark: add crossed delegation task corpus across three upstream repositories` |
| `2d43db1` | `research: freeze task delegation signal experiment` |
| `a6d1ed1` | `research: record task delegation signal result` |

Branched from `56af0afe706e2fe2392ab65515fd1c10789d4564`; `origin/main` at
`321d9c00df65add0d1fd2cf35d8c1691753dc726`.

## Push result and draft PR URL

Branch `research/task-delegation-signal-v0` pushed to
`https://github.com/wiramahendra/rapture`.

Draft PR: <https://github.com/wiramahendra/rapture/pull/9> — opened as a draft
against `main` and deliberately not merged. It **stacks on unmerged draft PR #8**
(`research/real-work-external-validity-v1`), which is a linear ancestor; #8 must land
first.

## Recommended next decision

Do **not** run this experiment again with more tasks. The design, not the sample size,
is what failed: adding tasks to a corpus with 84.4% baseline acceptance produces more
ceiling.

The next decision worth making is whether to **calibrate a corpus before measuring
it**. Concretely, the prerequisite for any future delegation study is a
difficulty-calibration pass: run candidate tasks once each, keep only those landing
between roughly 20% and 80% acceptance, and discard both the always-solved and the
never-solved. That directly contradicts this workstream's "no pre-freeze probing"
stance, and the tension is real — probing difficulty is contamination if acceptance is
the outcome, but not probing it produced a corpus that could not answer the question.
The resolution is to calibrate on *held-out* tasks that never enter the measured
corpus.

Two further prerequisites, both violated here: task difficulty must be assigned by
someone who has not seen which tasks are hard, and features must be made to vary
independently of class — which requires deliberately building, say, multi-file
`bug_fix` tasks and single-file `refactor` tasks.

Until a corpus meets those three conditions, further delegation measurement will keep
producing this same inconclusive shape, and the honest move is to fix the corpus or
stop — not to gather more data with the same instrument.
