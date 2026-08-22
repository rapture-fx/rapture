# Agentic Change Compiler V0

**Primary decision: `CHANGE_CONTRACT_NO_VALUE`**

## Executive summary

The hypothesis was that coding agents waste effort rediscovering repository structure, and
that compiling that structure into an explicit machine-readable contract would let an agent
reach a correct change with less exploration.

The contract was built, proved deterministic, and delivered successfully: the agent opened
it in **24 of 24** contract-condition runs and never referenced it in a baseline run. All 48
paired runs completed with zero provider or infrastructure failures.

It did not work. Independently verified acceptance was **identical** — 20/24 in both
conditions, a delta of exactly 0.0 percentage points. Exploration was not reduced; it was
**redistributed**. Shell searching fell sharply and consistently (`searchOperations` −45%
median, improving on 7 of 8 tasks), but the agent then read *more* files (+29%), took
**+63% longer to reach its first edit**, and issued essentially the same number of tool
calls overall (−4.5%). The contract condition also consumed **+24.6% more input tokens**.

The pre-registered criterion technically passes on all five clauses. I am not claiming
success on it, because inspecting my own instrumentation after the run revealed that the two
metrics which cleared the 20% bar are **not independent**: a shell `grep`/`find` increments
both `searchOperations` and `commandsExecuted` by construction. In substance one exploration
dimension improved, not two, and every aggregate measure of exploration cost was flat or
worse. Reporting `CHANGE_CONTRACT_SIGNAL_OBSERVED` on that basis would be true to the letter
of the criterion and false to the evidence.

## Primary decision

`CHANGE_CONTRACT_NO_VALUE`. The paired intervention produced no material reduction in
exploration cost and no change in verified correctness, at a measurable token cost. Per the
frozen next-step rule, the Agentic Change Compiler direction stops here, and is not to be
compensated for by adding routing, swarms, or automatically enlarging the context.

## Git truth and exact base SHA

| Item | Value |
| --- | --- |
| `origin/main` | `321d9c00df65add0d1fd2cf35d8c1691753dc726` (unchanged, verified after fetch) |
| Branched from | `0a30ab2c879efca1346e330ac028d5bc27cd7772` |
| Branch | `research/change-compiler-v0` |
| Worktree | `../rapture-change-compiler-v0` (fresh, isolated) |
| Node / pnpm / OpenCode | v22.14.0 / 10.12.1 / 1.18.21 |

PR #8 and PR #9 were both open, unmerged drafts at branch time. This branch **stacks on
both**, which the brief permits only when their functionality is genuinely required. It is:

Main's only benchmark corpus (`real-work-v0`) is two fixtures of **2,627 and 2,711 bytes**,
7–8 files each, whose largest source file is **16 lines**. An agent reads that entire
repository in about two tool calls. There is no repository-discovery cost there for a
contract to remove, so measuring "does precomputed context reduce discovery work" on it
would return a null result by construction — the same corpus-design mistake that made the
previous workstream inconclusive. The `delegation-v0` corpus on PR #9 has 52-file and 127 KB
repositories with 1,416- and 2,790-line source files, and carries the measured per-task
acceptance the pre-registered task selection required.

Both PRs must land in order: #8, then #9, then this one.

## Why this experiment exists

Concurrency research was paused: it produced a trustworthy instrument but increasingly
predictable answers and no decision consumer. Task-class delegation signal came back
inconclusive because human task taxonomy was too coarse and task identity dominated
outcomes. This workstream tested a different explanation for agent friction — mechanical
properties of the repository and the requested change — and a different product shape: not
another coding agent, but a substrate that compiles intent and repository truth into
explicit obligations any agent could consume.

## Change-contract schema

`.rapture/change-contract.json`, schema version 1, validated by zod and self-fingerprinting.

- **request** — task id, verbatim intent, exact source commit.
- **mechanicalContext** — entry symbols, relevant files with depth and direction, bounded
  dependency-depth summary, fan-out, test surfaces, verification surface, change breadth.
- **constraints** — editable scope, protected paths, invariants *with the evidence for each*,
  and explicit unknowns.
- **acceptance** — validation commands and required evidence.
- **provenance** — generation timestamp, generator version, source hashes, contract hash.

`generatedAt` is the source commit's own timestamp rather than a wall clock, because a
contract that changed on every build could not be integrity-checked. The fingerprint covers
everything except itself.

## Mechanical analysis design

Fully deterministic and LLM-free. A module graph is built from literal `import` / `require` /
`export … from` / `import()` specifiers, resolved against files on disk with standard
extension and `/index` resolution, then walked outward from the editable files.

Two correctness defects were found and fixed by looking at real output rather than trusting
the implementation:

1. **Direction switching.** The walk originally collected importers of files the edited file
   imports. On the semver fixture that reached **44 of 52 files** — effectively the whole
   repository — because one low-level module is imported by nearly everything. A contract
   full of irrelevant files is worse than no contract. The walk now follows each direction
   separately: dependencies constrain how the change may be written, dependents are the blast
   radius. Same task, **5 files**.
2. **Comments counted as dependencies.** A `require('..')` inside a JSDoc usage example in
   `lib/scan.js` created a false edge to the package root. The scanner now blanks comments
   while tracking string literals, so a `//` inside a URL is not mistaken for a comment.

Both fixes have regression tests.

## What was deliberately not inferred

- No architectural intent, no business rules, no design rationale.
- No type information, call graph, or runtime behaviour.
- No LLM was called at any point in analysis or compilation.
- Computed and non-literal specifiers are **not** resolved; they are counted and surfaced
  under `unknowns` so a consumer sees exactly what was missed rather than trusting a graph
  that silently dropped edges.
- No solution content: a test asserts that no known-good source line appears in any contract,
  and preflight confirmed **0 leaks across 760 solution lines × 8 contracts**.
- No validator internals beyond the fact that an external validator decides acceptance.

## Task corpus

Eight tasks across three upstream-derived repositories, selected before execution from
acceptance measured in the delegation workstream.

| Task | Repository | Prior acceptance | Role | Contract files / bytes |
| --- | --- | --- | --- | --- |
| `version-diff-release-type` | version-core | 0/3 | hard negative control | 5 / 4,882 |
| `version-coerce-options` | version-core | 1/3 | off-ceiling | 10 / 6,015 |
| `version-lru-cache-eviction` | version-core | 3/3 | ceiling, exploration probe | 15 / 7,143 |
| `glob-ignore-callbacks` | glob-matcher-core | 2/3 | off-ceiling | 7 / 5,066 |
| `glob-utils-helpers` | glob-matcher-core | 3/3 | ceiling, exploration probe | 7 / 5,437 |
| `cli-negated-option-name` | cli-command-core | 2/3 | off-ceiling | 5 / 4,657 |
| `cli-argument-contract` | cli-command-core | 3/3 | ceiling, exploration probe | 6 / 5,349 |
| `cli-suggest-similar` | cli-command-core | 3/3 | ceiling, exploration probe | 3 / 4,451 |

Ceiling tasks were included deliberately: acceptance cannot move there, which is exactly what
makes them a clean read on exploration cost.

**The hard negative control did not hold.** `version-diff-release-type` had failed 9/9 across
two prior workstreams, but was accepted **2/3 in the baseline arm** here. That is not a
leak — the baseline arm has no contract — it confirms the task is low-probability rather
than impossible, which a failure-signature analysis had predicted before this experiment was
designed. It does mean the corpus has no true never-solved control.

## Frozen experimental design

Frozen at `experiments/change-compiler-v0.frozen.json` with a 115-file integrity sidecar,
committed before any run was consumed (commit `7e2b91e`).

| Parameter | Value |
| --- | --- |
| Conditions | `baseline`, `change_contract` |
| Workers | **1** (no concurrency) |
| Repetitions | 3 |
| Tasks | 8 |
| Logical runs | 48 |
| Seed | 20260824 |
| Order | repetition-major |
| Timeout | 900 s per task |

Held constant across arms: model, CLI version, repository snapshot and base revision,
engineering request text (byte-identical), external validator, editable scope, timeout,
worker count, seed and ordering. The **only** variable is the presence of the compiled
contract plus one fixed pointer sentence naming it.

Both conditions live in the same task file, so they interleave within a trial and are paired
in time rather than run as separate blocks.

**Delivery mechanism.** The contract is written into the worktree before the agent starts,
and `.rapture/` is added to the worktree's git exclude file. Without that the injected file
appears in `git status` and is indistinguishable from work the agent did — it would have
tripped editable-scope enforcement and rejected every contract run. A test proves the file
is readable and simultaneously invisible to change detection, and that injection cannot
escape the worktree.

## OpenCode CLI, model and runtime

OpenCode CLI **1.18.21**, model **`opencode/hy3-free`**, availability re-verified by
standalone probe immediately before freezing. All 48 runs recorded that exact model and
version, `workerCount = 1`, and exactly three distinct base tree hashes (one per repository).

Host: macOS 13.7.8, Darwin 22.6.0, x64, 4 cores, Intel i5-7360U, 8 GiB.

## Contract reproducibility proof

Contracts were regenerated from an **independent materialization** into a different directory
and compared byte for byte:

- 8/8 contracts byte-identical.
- Generated task files byte-identical.
- Re-verified again after the builder was reformatted, to confirm formatting had not
  perturbed output.

## Run completion accounting

| Outcome | Count |
| --- | --- |
| Total logical runs | 48 / 48 planned |
| Accepted | 40 |
| Rejected | 8 |
| Provider failures | 0 |
| Infrastructure failures | 0 |
| Editable-scope violations | 0 |
| Runs with exploration metrics captured | 48 / 48 |

One accepted run carries `agent_exit_nonzero_validation_passed`: the agent process hit its
limit, but the change it had already written passed the external validator. Rapture records
that distinction rather than collapsing it into a pass or a failure.

## Baseline acceptance

**20/24 = 83.3%.**

## Change-contract acceptance

**20/24 = 83.3%.** Delta **0.0 percentage points** — the acceptance guardrail passes, and
there is no acceptance benefit whatsoever.

Contract uptake: opened in **24/24** contract runs; referenced in **0/24** baseline runs.
The intervention was genuinely delivered and genuinely consumed. This is not a null result
caused by the agent ignoring the material.

## Paired exploration metrics

Per-task medians across 3 repetitions, then the median of per-task changes — so no single
task can carry the aggregate.

| Metric | Median change | Tasks improving in ≥2/3 reps | Direction |
| --- | --- | --- | --- |
| `searchOperations` | **−45.0%** | 7/8 | better |
| `commandsExecuted` | **−32.5%** | 5/8 | better |
| `totalToolCalls` | −4.5% | 4/8 | flat |
| `uniqueFilesRead` | **+29.2%** | 0/8 | worse |
| `toolCallsBeforeFirstEdit` | **+41.7%** | 2/8 | worse |
| `msToFirstEdit` | **+63.2%** | 3/8 | worse |

The shape is consistent and interpretable: **the contract replaced searching with reading.**
The agent stopped grepping around the repository, opened the files the contract listed —
more of them — and took substantially longer to make its first edit. Total tool calls barely
moved.

## Files-read analysis

`uniqueFilesRead` rose on 5 of 8 tasks and fell on none in a majority of repetitions (0/8
tasks improved in ≥2/3 reps). The largest increases were `cli-suggest-similar` (1→3, +200%),
`glob-ignore-callbacks` (2→4) and `version-coerce-options` (2→4).

This is the clearest evidence against the hypothesis. Listing relevant files did not save the
agent from opening them; it gave it a reading list.

## Search and tool-call analysis

`searchOperations` fell on 7 of 8 tasks (−45% median), the single most consistent effect in
the experiment. `commandsExecuted` fell −32.5% on 5 of 8.

**These two are not independent.** In the instrumentation, a `bash` call whose command
matches `grep|rg|find|ag|ls|fd` increments `searchOperations` *and* `commandsExecuted`. They
substantially measure one behaviour: fewer shell invocations. The pre-registered criterion
asked for "at least two exploration-cost metrics" and I supplied two metrics that are largely
the same metric. That is a defect in my measurement design, disclosed here rather than
relied upon.

`totalToolCalls` — the closest thing to an overall exploration budget — moved −4.5%, which is
noise at this sample size.

## Time-to-first-edit analysis

`msToFirstEdit` rose **+63.2%** median, worse on 5 of 8 tasks. `toolCallsBeforeFirstEdit`
rose +41.7%, worse on 6 of 8.

If the contract were removing rediscovery work, time to first productive action is precisely
where it should show. It moved decisively the wrong way. Reading a 4.5–7.1 KB contract and
then opening the files it names costs more than the searching it displaces.

## Token and cost results

| Metric | Baseline | Contract | Delta |
| --- | --- | --- | --- |
| Input tokens | 674,930 | 841,261 | **+24.6%** |
| Output tokens | 55,775 | 57,175 | +2.5% |
| Cached input tokens | 3,302,912 | 3,920,512 | +18.7% |
| Reasoning tokens | 67,506 | 91,236 | +35.2% |
| Provider-reported cost | 0 | 0 | free tier |
| Derived monetary cost | **null** | **null** | no pricing context supplied |
| Median agent execution | 111.8 s | 105.9 s | −5.3% |

The contract costs about a quarter more input tokens and a third more reasoning tokens for
zero acceptance gain. Median agent time is marginally lower, which does not survive the
time-to-first-edit result: the agent starts slower and finishes at roughly the same time.

## Validator-cycle analysis

The harness executes each task's external validator exactly once per run, so validator
cycles are constant at 1 across all 48 runs and cannot discriminate between conditions. It
is reported for completeness, not as evidence. Validation duration is a property of the
validator, not of the agent's behaviour, and is likewise uninformative here.

## Scope violations

**Zero in both conditions.** Notably, the injected contract never appeared as an agent edit,
confirming the git-exclude delivery mechanism worked as designed across all 24 contract runs.

| Condition | Scope violations | Timeouts | No-edit runs | Invalid tool calls |
| --- | --- | --- | --- | --- |
| baseline | 0 | 1 | 0 | 1 |
| contract | 0 | 0 | 0 | 1 |

## Per-task result table

| Task | Acceptance (base → contract) | toolCalls | uniqueReads | beforeFirstEdit | searchOps |
| --- | --- | --- | --- | --- | --- |
| `cli-argument-contract` | 2/3 → 3/3 | 10 → 10 | 3 → 4 | 3 → 6 | 4 → 2 |
| `cli-negated-option-name` | 3/3 → 3/3 | 16 → 11 | 3 → 3 | 2 → 2 | 5 → 3 |
| `cli-suggest-similar` | 2/3 → 3/3 | 7 → 11 | 1 → 3 | 3 → 6 | 3 → 3 |
| `glob-ignore-callbacks` | 2/3 → 2/3 | 11 → 10 | 2 → 4 | 6 → 4 | 3 → 1 |
| `glob-utils-helpers` | 3/3 → 3/3 | 12 → 14 | 4 → 5 | 3 → 5 | 4 → 3 |
| `version-coerce-options` | 3/3 → 3/3 | 13 → 19 | 2 → 4 | 6 → 7 | 4 → 2 |
| `version-diff-release-type` | 2/3 → 0/3 | 8 → 7 | 3 → 3 | 5 → 3 | 2 → 1 |
| `version-lru-cache-eviction` | 3/3 → 3/3 | 8 → 7 | 2 → 2 | 1 → 4 | 3 → 2 |

Acceptance movements are ±1 run on n=3 and net to exactly zero. Only
`cli-negated-option-name` improved on both tool calls and searches without a cost elsewhere.

## Failure-mode analysis

All 8 rejections were `validation_failed` — genuine wrong answers, not harness or provider
problems. Five of the eight are `version-diff-release-type`, the hardest task in the corpus.

Qualitatively, against the questions fixed before execution:

- **Did the contract omit a file the successful baseline needed?** No evidence of it;
  relevant-file sets included the files the task prompts point at (for `diff`, the contract
  surfaced `classes/semver.js` at depth 2, exactly the file the prompt says to read).
- **Did it over-constrain?** Not visibly — zero scope violations in either arm, and no
  failure traced to the contract's `protectedPaths`.
- **Did it reduce unnecessary exploration?** It reduced *shell searching* substantially and
  consistently. It did not reduce total exploration.
- **Did it send the agent toward irrelevant code?** Files read went up on 5 of 8 tasks, which
  is consistent with the agent working through the contract's file list rather than the
  minimum needed. This is the most likely mechanism for the time-to-first-edit regression.
- **Did the agent ignore it?** No — opened 24/24.
- **Did it surface tests and invariants earlier?** Yes, mechanically, but with no measurable
  benefit to acceptance.
- **Were explicit unknowns handled correctly?** No failure was attributable to them; the
  agent neither treated unknowns as facts nor appeared to act on them.
- **Did it create false confidence?** `version-diff-release-type` fell 2/3 → 0/3, and the
  contract arm reached its first edit *sooner* there (5 → 3 tool calls). A faster start on
  the corpus's hardest task, with a worse outcome, is the pattern false confidence would
  produce. With n=3 this is a hypothesis, not a finding.

## What this proves

- A change contract can be compiled **deterministically and byte-reproducibly** from a
  repository, with every claim traceable to evidence and unknowns stated explicitly.
- It can be delivered to a real coding agent without contaminating change detection, and it
  **will be consumed** — 24/24 uptake, 0/24 leakage into the control arm.
- Agent exploration can be measured directly from the provider's own event stream, with full
  coverage (48/48 runs) and no reliance on host telemetry.
- On this corpus, precomputed mechanical context **redistributes** exploration — sharply less
  shell searching, more file reading, later first edit — rather than reducing it, at
  +24.6% input tokens and exactly zero change in verified correctness.
- `version-diff-release-type` is low-probability, not impossible: accepted 2/3 in baseline
  after 9 prior failures.

## What this does not prove

- **Not that repository context is useless to agents.** One contract shape, one model, one
  corpus, one delivery mechanism. A different contract — smaller, or answering a narrower
  question — is untested.
- **Not that the contract caused the acceptance drop on `version-diff-release-type`.** ±1 run
  on n=3.
- **Nothing about larger or unfamiliar repositories**, other models, other agents, or hosts.
- **Nothing about economics.** Free-tier model; derived monetary cost is null throughout.
- **No statistical significance** is claimed or supported at n=3 per cell.
- **Nothing that justifies routing, swarms, scheduling, or further compiler layers.**

## Kill-criterion evaluation

The pre-registered criterion, evaluated exactly as written:

| # | Requirement | Literal result |
| --- | --- | --- |
| 1 | Acceptance not more than 5pp below baseline | **PASS** (0.0pp) |
| 2 | ≥2 exploration metrics improve ≥20% (median per-task) | **PASS** (`searchOperations` −45%, `commandsExecuted` −32.5%) |
| 3 | Direction consistent in ≥2/3 reps for a majority of tasks | **PASS** (7/8 and 5/8 respectively) |
| 4 | Not explained by one pathological task | **PASS** (search improved on 7 of 8 tasks) |
| 5 | No material rise in scope violations or infra failures | **PASS** (0 and 0) |

**The literal criterion is met, and I am nonetheless deciding `CHANGE_CONTRACT_NO_VALUE`.**
The reasoning, stated plainly so it can be challenged:

Clause 2 assumed two metrics would be two independent measures of exploration cost. They are
not: my own instrumentation increments `searchOperations` and `commandsExecuted` from the
same shell call. In substance **one** exploration dimension improved. Every aggregate measure
— total tool calls (−4.5%), unique files read (+29.2%), tool calls before first edit
(+41.7%), time to first edit (+63.2%) — is flat or materially worse, and input tokens rose
24.6%. The north-star question asks whether enough rediscovery work can be removed to
**measurably improve verified engineering efficiency**; verified efficiency did not improve
on any measure.

This moves the goalposts against my own hypothesis, not in favour of it, and the brief's
closing instruction is explicit: do not claim the vision is validated unless exploration
efficiency materially improves. It did not.

`DELEGATION`-style kill criteria were not triggered: the benchmark separated baseline from
known-good deterministically, known-good stayed isolated, and no repository needed network or
credentials.

## Product implication

The Agentic Change Compiler direction stops here.

The specific thing that failed is worth naming precisely, because it is not "context doesn't
help". The contract was accurate, cheap, deterministic, and read every single time. It still
produced no benefit, because **the exploration it displaced was not the expensive part**.
Grepping a 127 KB repository is cheap for this agent; reading files and deciding what to do
is expensive, and a file list makes that part *larger*, not smaller.

That reframes the original premise. The observation that motivated this work — agents
repeatedly rediscover structure — was real but the cost attribution was wrong. Structure
rediscovery was already cheap. Any future attempt in this space would need to show, before
building anything, that the work it removes is work that actually costs the agent something.

Per the frozen next-step rule for `CHANGE_CONTRACT_NO_VALUE`, this is not to be compensated
for by adding routing, swarms, scheduling, or automatically enlarging the context.

## Quality gates

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm biome check .` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS (232 vitest + node:test suites) |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| benchmark doctor (`delegation-v0`) | PASS, unchanged after execution |
| historical frozen-artifact integrity | PASS — 9/9 sidecars, zero drift |
| known-good confidentiality proof | PASS — 0 leaks, 760 lines × 8 contracts |
| change-contract reproducibility | PASS — byte-identical from independent materialization |
| formatter immutability guard | PASS — 3,225 protected files, incl. negative control |
| `git status` clean after regeneration | PASS |

## Codex usage confirmation

**Codex was never invoked and consumed no quota.** Every agent invocation used OpenCode with
`opencode/hy3-free`, provider-reported cost 0. Total invocations: 48 experiment runs plus 1
pre-freeze availability probe = 49.

## Exact commits

| Commit | Subject |
| --- | --- |
| `e786c62` | `feat(contract): add change-contract schema, repository mechanics, and CLI` |
| `7e2b91e` | `research: freeze change-compiler paired experiment` |
| `5b422b0` | `style: format change-compiler experiment builder` |
| `0c9f036` | `research: record change-compiler v0 result` |

## Push result and draft PR URL

Branch `research/change-compiler-v0` pushed to `https://github.com/wiramahendra/rapture`.

Draft PR: <https://github.com/wiramahendra/rapture/pull/10> — opened as a draft against
`main` and deliberately not merged. It stacks on unmerged draft PRs #8 and #9, both
linear ancestors; merge order is #8, then #9, then this.

## Recommended next engineering decision

Do not build another context layer, and do not re-run this with a different contract shape
first. The result that matters is not "the contract was wrong" but "the cost model was
wrong": search was cheap, reading and deciding were expensive.

The next decision worth making is therefore **whether to keep investing in this programme at
all, and if so, against what decision**. Three workstreams in a row have now produced
rigorous measurement and no actionable result — a confirmed-obvious concurrency finding, an
inconclusive delegation signal, and a null here. The common cause is not method quality; it
is that none of them was attached to a decision anyone was about to make.

If the programme continues, the honest prerequisite is a real consumer: someone about to
spend real money on a paid model at a real concurrency level on a real repository, whose
choice would change based on the number. Absent that, the instrument is excellent and the
questions are self-generated, and more experiments will keep producing well-measured
answers that change nothing.

If a consumer does exist, the single highest-value measurement remaining is the one this
programme has never made: **cost-to-acceptance on a paid model** — how much provider spend it
takes to reach an accepted change, per task, with the sound verifier deciding. That is the
number a team would actually use, it needs no new research infrastructure, and it is the only
metric so far that would be denominated in something a budget holder recognises.
