# Real-Work External Validity V1

**Decision: `REAL_WORK_SCALING_SIGNAL_OBSERVED`**

## Executive summary

Rapture's accepted-engineering-throughput measurement was, until now, only ever
exercised on fixtures Rapture wrote itself. This workstream built the first
benchmark repository derived from a third-party upstream codebase — a minimized
snapshot of `npm/node-semver` v7.8.5 — gave it four deterministic engineering
tasks with external validators, proved the benchmark valid before any agent
touched it, and then ran a frozen OpenCode 1-vs-2 worker experiment over it.

All 24 planned logical runs completed: 15 accepted, 9 rejected, zero timeouts,
zero validator infrastructure failures, zero editable-scope violations. Going
from 1 to 2 workers raised median accepted throughput from **19.35 to 48.85
accepted tasks per wall-clock hour**, with acceptance rising from 58.3% to 66.7%.
Every one of the three paired repetitions moved in the same direction.

The measurement therefore survives contact with upstream-derived work: the earlier
scaling results were not purely an artifact of synthetic fixtures. But the
headline multiplier must not be read at face value. `S(2) = 2.52` and
`E(2) = 1.26` are above linear, and no superlinear effect is being claimed. The
component concurrency can actually influence — trial wall-clock time — compressed
by a median of **2.05×**, and the remainder of the multiplier comes from a single
extra accepted task at N=2, which is traceable to agent nondeterminism unrelated
to worker count. Details in [Interpretation](#interpretation).

## Git truth and exact base SHA

| Item | Value |
| --- | --- |
| Base SHA | `321d9c00df65add0d1fd2cf35d8c1691753dc726` |
| Base ref | `origin/main` (also `main`, `origin/HEAD`) |
| Branch | `research/real-work-external-validity-v1` |
| Worktree | `../rapture-real-work-v1` (fresh, isolated) |
| Node | v22.14.0 (satisfies `>=22.14.0`; the shell default was v20.19.5, so nvm's 22.14.0 was used throughout) |
| pnpm | 10.12.1 |

`origin/main` was fetched and matched the expected baseline SHA exactly, so no
re-basing onto a newer main was required.

One discrepancy is worth recording plainly: the task brief asked to verify that
main "still contains `RAPTURE_RESEARCH_BASELINE_READY`". That literal string does
not appear anywhere in the tree, in any commit message, or in any tag. The
matching SHA was treated as the authoritative baseline signal, and no artifact was
created to satisfy the token.

Existing worktrees (`rapture-main-landing`, `rapture-pr2-validate`) were left
untouched.

## Upstream repository selection and why

The selection criteria that did the most work were *deterministic offline
execution* and *no external service dependency during validation*. Together they
rule out most real repositories, because most real repositories need a package
install before their code will run.

`npm/node-semver` satisfies them unusually well:

- **Zero runtime dependencies.** Every `require()` in the retained surface resolves
  inside the repository, so `installCommand` is empty and no network access is
  needed at any point during an experiment.
- **Real structure, not a toy.** 47 runtime files across `classes/`, `functions/`,
  `internal/` and `ranges/`, with genuine cross-file coupling — the range logic
  reaches into the comparator classes, the coercion logic into a shared
  regular-expression table, the caches into the parse paths.
- **Small enough for the host.** 95 KB across 53 files; a 4-core / 8 GiB machine
  materializes and validates it in well under a second.
- **Permissive licence.** ISC, retained verbatim.
- No Docker, no browser, no credentials, no monorepo tooling.
- It supports several genuinely independent tasks in disjoint files, which is what
  makes parallel execution meaningful.

Rejected alternatives and why: `picomatch` and `minimatch` (dependency or
difficulty concerns), `yargs-parser` (thinner cross-file structure), anything
requiring `tap`/`jest`/`vitest` at validation time (needs an install).

The most significant downside is discussed under
[What this does not prove](#what-this-does-not-prove): semver is famous, and a
model may recall it.

## Upstream URL, commit SHA, licence, and provenance

| Field | Value |
| --- | --- |
| Upstream URL | `https://github.com/npm/node-semver` |
| Upstream revision | `6e05b7637396ac66522cff8731f07cfe0ef49a29` |
| Upstream ref | `v7.8.5` |
| Licence | ISC (retained verbatim at `LICENSE`, unmodified) |
| Acquisition date | 2026-08-22 |
| Snapshot type | `minimized_derived_snapshot` — **not** an exact vendored copy |
| Upstream source fingerprint | `e597146565fd4e3d094c1d8fa42c87de6d320d973d05ab5ab656a5c02b194339` |

The source fingerprint covers the 50 retained upstream paths, hashed from the
pristine upstream checkout **before** any Rapture transformation, using the same
canonical algorithm the framework uses for fixture fingerprints. It therefore
pins what was taken, independently of what was later changed.

Machine-readable provenance lives at `benchmarks/real-work-v1/provenance.json`,
beside the manifest. It is listed in the manifest's `protectedAssets`, and asset
verification now **fails closed** if an upstream-derived repository's provenance
sidecar is not integrity-protected — so the transformation log cannot drift away
from the fixture it describes. A human-readable `PROVENANCE.md` sits inside the
fixture itself so the snapshot cannot be mistaken for upstream semver by anyone
reading it in isolation.

## Transformations from upstream source

154 upstream files in, 50 retained, 104 removed, then 4 files changed or added.

| # | Kind | What |
| --- | --- | --- |
| 1 | `path_reduction` | Kept only the runtime distribution surface (`index.js`, `classes/`, `functions/`, `internal/`, `ranges/`, `range.bnf`) plus `LICENSE` and `README.md`. Removed the upstream `tap` test suite (66 files), `.github/` (16), `benchmarks/` (6), `bin/`, `preload.js`, lint/commit/release tooling, changelog and contributor docs. |
| 2 | `manifest_replacement` | Replaced `package.json` with a minimized CommonJS manifest: renamed to `semver-core`, all `devDependencies` and `scripts` removed. |
| 3 | `documentation_addition` | Added `PROVENANCE.md`. |
| 4 | `baseline_defect_injection` | `functions/diff.js` — removed the prerelease-to-release special casing. |
| 5 | `baseline_defect_injection` | `functions/coerce.js` — removed `rtl` and `includePrerelease` support. |
| 6 | `baseline_defect_injection` | `internal/lrucache.js` — reduced to an unbounded `Map` wrapper with no recency tracking and no eviction. |
| 7 | `test_addition` | Added `test/range.test.js`, a Rapture-authored `node:test` suite (not upstream) whose baseline revision asserts stale expectations and fails. |

The upstream test suite was removed because `tap` requires a network install,
which is incompatible with the determinism the experiment needs. Acceptance is
decided only by external validators outside the fixture, never by in-repo tests.

**This fixture does not behave like released `semver@7.8.5` and must not be used
as a dependency.**

## Benchmark task inventory

Suite `rapture-real-work-v1@0.2.0`, repository `semver-core`, base revision
`e3707f5846b848dd0876a22d1492786744de51e9`.

| Task | Class | Editable scope | Validator | Timeout |
| --- | --- | --- | --- | --- |
| `semver-diff-release-type` | `bug_fix` | `functions/diff.js` | `validators/semver-diff.mjs` | 60 s |
| `semver-coerce-options` | `small_feature` | `functions/coerce.js` | `validators/semver-coerce.mjs` | 60 s |
| `semver-lru-cache-eviction` | `refactor` | `internal/lrucache.js` | `validators/semver-lru-cache.mjs` | 60 s |
| `semver-range-test-repair` | `test_repair` | `test/range.test.js` | `validators/semver-range-tests.mjs` | 180 s |

Agent timeout hint: 900 s per task. Scopes are disjoint, so the four tasks stay
independent when run concurrently in isolated worktrees.

None is a one-character mutation. `diff` requires reasoning about `compare` and
`compareMain` in `classes/semver.js`; `coerce` requires finding the right tokens
in `internal/re.js`; the cache task requires understanding how the cache is used
by `classes/range.js` and `internal/parse-options.js`.

## Editable scopes

Enforcement is not advisory. After each run Rapture diffs the worktree and
classifies any file outside `editableScope` as
`editable_scope_violation:<paths>`, which forces rejection even when the
validator passed. A test drives this end-to-end with the fake adapter: the same
known-good overlay is accepted, and the overlay plus one extra `README.md` edit is
rejected with `editable_scope_violation:README.md`.

Across the 24 real runs there were **zero** scope violations.

## Validator design

Validators live in `benchmarks/real-work-v1/validators/`, outside the fixture and
outside every agent worktree. Each is hash-pinned in the manifest, runs in a fresh
Node process with the candidate repository path as its only argument, and exits
`0` accepted / `1` rejected / `2` infrastructure failure — so a broken validator
is never silently scored as a task failure.

The first three assert behaviour tables:

- **diff** — 22 version pairs covering equality, build-metadata-only differences,
  ordinary major/minor/patch steps, `pre`-prefixed steps, prerelease-to-prerelease,
  and every prerelease-to-release shape. Each pair is asserted in **both** argument
  orders, plus `TypeError` on invalid input.
- **coerce** — preserved no-option behaviour, right-to-left coercion, prerelease
  and build capture, both options composed, and call-to-call stability (a global
  regex must not leak `lastIndex`).
- **lrucache** — interface preservation, `undefined`-value handling, eviction at
  capacity, recency promotion on read, a hard retention bound under 3× churn, and
  unchanged `satisfies`/`validRange` answers across 1500 distinct ranges.

`semver-range-test-repair` needed a different design, because "the test suite
passes" is not a decidable acceptance criterion — a suite that asserts nothing
passes too. Its validator therefore also **mutation-tests the repaired suite**: it
copies the candidate repository four times, appends one behavioural mutant to
`classes/range.js` each time (`Range.prototype.test` forced true, forced false,
`Range.prototype.intersects` forced true, forced false), and requires the suite to
**fail** against every mutant. Deleting or trivialising assertions is therefore a
rejection, not a pass. Appending after `module.exports` makes the mutation robust
to whatever formatting the agent leaves behind.

## Baseline-reject proof

Every task's validator rejects the frozen baseline on two consecutive runs, via
both the benchmark doctor and a dedicated test:

```
PROOF_semver-diff-release-type       PASS  baseline rejected and known-good accepted 2/2
PROOF_semver-coerce-options          PASS  baseline rejected and known-good accepted 2/2
PROOF_semver-lru-cache-eviction      PASS  baseline rejected and known-good accepted 2/2
PROOF_semver-range-test-repair       PASS  baseline rejected and known-good accepted 2/2
```

Rejections are specific, not incidental — for example `diff(1.0.0-1, 1.0.0)`
yields `'prerelease'` where `'major'` is required.

## Known-good-pass proof

Each known-good overlay is applied to the materialized baseline and the validator
accepts twice consecutively, as shown above. The overlays for `diff`, `coerce` and
`lrucache` restore the verbatim upstream implementations; the overlay for the test
task is the corrected suite. Validator output was byte-identical across repeated
runs.

## Known-good read-isolation proof

Known-good solutions live in `benchmarks/real-work-v1/known-good/`, which is never
copied into a materialized repository. A test proves the isolation four ways:

1. **No escape.** Every file in the agent worktree is a regular file, not a
   symlink, and resolves inside the worktree root.
2. **Assets are outside.** The manifest, provenance sidecar, all validators and all
   known-good overlays resolve outside the worktree root.
3. **No solution text present.** For each overlay, every line that distinguishes the
   solution from the frozen baseline (≥20 characters, absent from the baseline file)
   is searched for across *every* file in the worktree **including `.git` objects**.
   None is found. Comparing against the baseline matters: lines the baseline and
   solution share are legitimately visible to the agent and are not leaks.
4. **Not resolvable at runtime.** A Node process with its cwd set to the worktree
   cannot resolve `known-good` or `validators`.

An independent observation from the run itself reinforces this: in three runs the
agent recognised the upstream package and tried to fetch semver's real source; the
tool call was denied and no upstream code entered the worktree.

## Benchmark fingerprint and integrity

| Artefact | Digest |
| --- | --- |
| Suite fingerprint | `35ed9af7971992a704b45b6d5c4508f9a71231fa7f08fa4d1c7a02a787a80c83` |
| Fixture directory | `cfff12db42869d27c37b7822ada4ea39fbbe23c9a6e4039d5be5c67d818b74dd` (53 files, 95,073 bytes) |
| Base revision | `e3707f5846b848dd0876a22d1492786744de51e9` |
| Base tree hash | `1d3c3e9a4315d0f20f0e8c7f57e99a441e9b6cba` |
| Experiment integrity aggregate | `5c0aa9e85bc12148f108a3d5ed879196ace7f5f990fa5128737cbfc748336c76` (65 files) |

`manifest.json` is generated by `scripts/real-work-v1/build-manifest.mjs`, which
derives every hash — including the base revision, by reproducing the framework's
own materialization commit with its fixed identity and timestamp. Regeneration on
an unchanged tree is a byte-identical no-op, asserted by a test, so a clean
`git status` after regeneration is a real integrity gate.

All 24 runs recorded the same `baseTreeHash` (`1d3c3e9a…`), and a fresh
post-execution materialization produced that same tree — the fixture did not move
underneath the experiment. Suite 0.1.1 (`rapture-real-work-v0`) parses and proves
unchanged; its fingerprint is untouched.

## OpenCode CLI version and exact model

| Field | Value |
| --- | --- |
| OpenCode CLI | 1.18.21 |
| Model | `opencode/hy3-free` |
| Provider | OpenCode only. Codex was never invoked and consumed no quota. |

Model selection is recorded in the freeze rather than assumed. No paid provider
experiment was authorized, so selection was restricted to free-tier models. Three
candidates (`opencode/hy3-free`, `opencode/nemotron-3-ultra-free`,
`opencode/mimo-v2.5-free`) answered a standalone probe with `cost: 0` and
structured token usage. `hy3-free` was chosen because the prior
`opencode-capacity-curve` experiment used it, keeping the provider surface
comparable, and because pre-freeze capability probes showed a **non-degenerate
acceptance spread** on this benchmark (2 of 3 probed tasks accepted, 1 rejected).
That mattered: a model that accepts nothing makes accepted throughput uniformly
zero and the 1-vs-2 comparison meaningless.

Those probes ran before the freeze, outside the experiment, and are disclosed in
`experiments/real-work-external-validity-v1.frozen.json`. The benchmark was not
modified after observing them, and their runs are excluded from every number
reported here.

All 24 runs recorded `agentModel = opencode/hy3-free` and
`agentVersion = 1.18.21`. No post-freeze model substitution occurred.

## Frozen experiment configuration

Frozen at `experiments/real-work-external-validity-v1.frozen.json` with integrity
sidecar `.integrity.json`, **before** any experiment run was consumed (commit
`a6f157d`).

| Parameter | Value |
| --- | --- |
| Worker counts | 1, 2 |
| Repetitions | 3 |
| Tasks | 4 |
| Logical runs | 24 |
| Seed | 20260822 |
| Execution order | `repetition-major` |
| Integration | off |
| Timeout per task | 900 s |
| Resumable | yes |
| Pricing context | none supplied |

`repetition-major` was chosen deliberately over the prior study's `worker-major`:
it places each repetition's N=1 and N=2 trials adjacently in time, which is what
makes the paired per-repetition differencing below meaningful.

Preflight `doctor` passed on this host before execution (Node v22.14.0, pnpm
10.12.1, git 2.49.0, opencode present and authenticated, model pinned, 4 task
definitions validated, worktree create/remove working). The only non-PASS was a
`WARNING` that no `--config` was supplied, which is expected — the freeze document
is not in the CLI's experiment-config format.

Host: macOS 13.7.8 (22H730), Darwin 22.6.0, x64, 4 cores, Intel i5-7360U @
2.30 GHz, 8 GiB RAM.

## Provider/runtime deviations

**No deviations from the freeze.** The model, CLI version, worker counts,
repetitions, seed, ordering and task set all executed as frozen. `deviations` in
the frozen document is empty and stayed empty.

One runtime behaviour is worth recording, because it shaped the results. In 3 of
24 runs — all `semver-coerce-options` — the agent attempted a tool call that
OpenCode's permission layer denied, then ended its turn **without editing any
file**. In 2 of those the denied call was an attempt to download or read upstream
semver source. These runs exited 0, did not time out, and were correctly recorded
as `rejected` / `validation_failed` rather than as infrastructure failures: the
agent ran, was not impeded by Rapture, and simply produced no change. They are
counted as rejections throughout.

This is good news for benchmark confidentiality — the agent could not reach the
upstream solution — but it means those three attempts carry no signal about
engineering capability.

## Run completion accounting

| Outcome | Count |
| --- | --- |
| Total logical runs | 24 / 24 planned |
| Accepted | 15 |
| Rejected (`validation_failed`) | 9 |
| Timed out | 0 |
| Validator infrastructure failures | 0 |
| Editable-scope violations | 0 |
| Provider failures | 0 |
| Agent processes exiting non-zero | 0 |
| Runs with structured usage captured | 24 / 24 |

The matrix completed (`24/24`); no resume was needed and no repetition was added
post-hoc.

## N=1 results

| Rep | Wall (s) | Accepted | Accepted/hour | Median task latency (s) |
| --- | --- | --- | --- | --- |
| 1 | 372.1 | 2/4 | 19.35 | 93.5 |
| 2 | 393.7 | 2/4 | 18.29 | 96.8 |
| 3 | 462.4 | 3/4 | 23.36 | 121.3 |

Median throughput **19.35** tasks/hour (range 18.29–23.36). Acceptance **7/12
(58.3%)**. Median trial wall clock 393.7 s.

## N=2 results

| Rep | Wall (s) | Accepted | Accepted/hour | Median task latency (s) |
| --- | --- | --- | --- | --- |
| 1 | 181.4 | 2/4 | 39.69 | 81.7 |
| 2 | 221.1 | 3/4 | 48.85 | 90.9 |
| 3 | 204.2 | 3/4 | 52.90 | 97.1 |

Median throughput **48.85** tasks/hour (range 39.69–52.90). Acceptance **8/12
(66.7%)**. Median trial wall clock 204.2 s.

## T(1), T(2), S(2), E(2)

| Metric | Value |
| --- | --- |
| T(1) | 19.35 accepted tasks / wall-clock hour |
| T(2) | 48.85 accepted tasks / wall-clock hour |
| S(2) = T(2)/T(1) | **2.52** |
| E(2) = T(2)/(2·T(1)) | **1.26** |

`E(2) > 1` is reported because it is what the formula yields, **not** because
superlinear scaling is being claimed. See [Interpretation](#interpretation).

Separating the component concurrency can actually influence — trial wall-clock
time, which does not depend on how many tasks happened to be accepted:

| Rep | Wall N=1 (s) | Wall N=2 (s) | Wall speedup | Wall efficiency |
| --- | --- | --- | --- | --- |
| 1 | 372.1 | 181.4 | 2.05 | 1.03 |
| 2 | 393.7 | 221.1 | 1.78 | 0.89 |
| 3 | 462.4 | 204.2 | 2.26 | 1.13 |

Median wall-clock speedup **2.05** (efficiency 1.03).

## Acceptance comparison

| Workers | Accepted | Runs | Acceptance rate |
| --- | --- | --- | --- |
| 1 | 7 | 12 | 58.3% |
| 2 | 8 | 12 | 66.7% |

Acceptance did **not** degrade under concurrency; it rose by one accepted run.
That single run is the entire difference, and it is attributable to agent
nondeterminism rather than worker count — see
[Task-class observations](#task-class-observations).

## Paired repetition differences

| Rep | T(1) | T(2) | S(2) | Wall N=1 (s) | Wall N=2 (s) | Accepted N=1 | Accepted N=2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 19.35 | 39.69 | 2.05 | 372.1 | 181.4 | 2/4 | 2/4 |
| 2 | 18.29 | 48.85 | 2.67 | 393.7 | 221.1 | 2/4 | 3/4 |
| 3 | 23.36 | 52.90 | 2.26 | 462.4 | 204.2 | 3/4 | 3/4 |

All three paired repetitions moved in the same direction, with S(2) between 2.05
and 2.67. The direction is stable even though the magnitude is not.

Trial-to-trial variance is substantial: N=1 wall clock spans 372–462 s (a 24%
spread) with an identical task set, which is why magnitudes here should be treated
as indicative only.

## Task-class observations

| Task | Class | N=1 accepted | N=2 accepted | Median latency (s) |
| --- | --- | --- | --- | --- |
| `semver-lru-cache-eviction` | `refactor` | 3/3 | 3/3 | 44.6 |
| `semver-range-test-repair` | `test_repair` | 3/3 | 3/3 | 85.5 |
| `semver-coerce-options` | `small_feature` | 1/3 | 2/3 | 132.9 |
| `semver-diff-release-type` | `bug_fix` | 0/3 | 0/3 | 115.0 |

This spread is the most informative part of the run, and it makes the aggregate
throughput numbers legible:

- **Two tasks are deterministic at this model strength.** The bounded refactor and
  the test repair were accepted in all 6 runs each. The test-repair result also
  confirms the mutation-based validator works against a real agent, not just
  against a hand-written known-good file: the agent's repaired suites killed all
  four `Range` mutants.
- **One task is deterministically out of reach.** `semver-diff-release-type` failed
  0/6 at both worker counts. The agent edited the file every time and got the
  prerelease-to-release classification wrong every time. This is a genuine
  engineering failure, not a harness artifact — and it is exactly the kind of task
  that must not be removed for lowering the acceptance rate.
- **One task is the sole source of variance.** `semver-coerce-options` accounts for
  every accepted-count difference in the entire experiment: 1/3 at N=1, 2/3 at N=2.
  All three of its failures were the no-edit runs described under
  [Provider/runtime deviations](#providerruntime-deviations) — the agent hit a
  denied tool call and stopped. So the N=1 → N=2 acceptance gain of exactly one run
  is one fewer such abort, which has no causal relationship to worker count.

Because the other three tasks are constant across both conditions, accepted tasks
per trial is fully determined by `2 + [coerce accepted]`. The 4-task suite is too
small for accepted-count differences to carry statistical weight.

## Agent-hour and machine-hour economics

| Metric | N=1 | N=2 |
| --- | --- | --- |
| Accepted tasks | 7 | 8 |
| Agent-hours (Σ agent execution) | 0.3390 | 0.3063 |
| Machine-hours (trial wall × workers) | 0.3412 | 0.3370 |
| Accepted per agent-hour | 20.65 | 26.12 |
| Accepted per machine-hour | 20.52 | 23.74 |
| Median task latency (s) | 96.8 | 86.6 |
| Median agent execution (s) | 95.9 | 86.2 |

Machine-hours are near-identical across conditions, which is the expected shape:
N=2 halves wall-clock time while occupying twice the workers. The improvement in
accepted-per-machine-hour is therefore driven by the one extra acceptance, not by
better resource utilisation.

Median per-task agent execution *fell* slightly at N=2 (95.9 s → 86.2 s). Two
concurrent agents on a 4-core host did not measurably slow each other down — this
workload is provider-latency-bound, not locally CPU-bound. That is consistent with
`LOCAL_CONTENTION_ATTRIBUTED`, which attributed contention at the 3→4 step, not at
1→2. It is not evidence that concurrency makes individual tasks faster; the
difference is within observed run-to-run noise.

### Phase timing (median per run, seconds)

| Workers | Agent exec | Validation | Worktree setup | Worktree cleanup | Orchestration |
| --- | --- | --- | --- | --- | --- |
| 1 | 95.9 | 0.13 | 0.065 | 0.033 | 0.000 |
| 2 | 86.2 | 0.14 | 0.076 | 0.037 | 0.072 |

Rapture's own overhead is negligible — under 0.3 s per run against ~90 s of agent
execution — so the throughput comparison reflects agent and provider behaviour
rather than harness cost.

## Token/cost metrics with explicit nulls

Structured usage was captured for **24/24** runs, all from `cli_structured`.

| Metric | N=1 | N=2 |
| --- | --- | --- |
| Input tokens | 326,892 | 311,342 |
| Output tokens | 22,312 | 23,714 |
| Cached input tokens | 1,289,088 | 1,309,568 |
| Reasoning tokens | 32,815 | 36,335 |
| Provider-reported cost | 0 | 0 |
| Derived monetary cost | **null** | **null** |
| Machine cost | **null** | **null** |
| Cost per accepted task | 0 (free tier; not a priced measurement) | 0 (same) |
| Accepted tasks per provider dollar | **null** | **null** |

Nulls are deliberate and load-bearing. No pricing context was supplied, so every
derived monetary metric stays null rather than being invented. The
provider-reported cost of `0` is a real free-tier report, kept distinct from
derived cost, and it is **not** evidence that this work is free to perform on a
paid model. Accepted-tasks-per-provider-dollar is null because it is undefined at
zero cost, not because the data is missing.

## Comparison with prior synthetic evidence

Presented side by side for pattern comparison only. **These are different
workloads and are not pooled.** The task sets, repository, difficulty and trial
sizes all differ; only the model and host are shared.

| | ledger-kit (synthetic, `opencode-capacity-curve`) | semver-core (upstream-derived, this experiment) |
| --- | --- | --- |
| Tasks per trial | 6 | 4 |
| Trials per worker count | 3 | 3 |
| T(1) | 29.49 tph | 19.35 tph |
| T(2) | 50.36 tph | 48.85 tph |
| S(2) | 1.708 | 2.52 |
| E(2) | 0.854 | 1.26 |
| Acceptance N=1 → N=2 | 72.2% → 94.4% | 58.3% → 66.7% |

The qualitative pattern replicates: moving from 1 to 2 workers produces a material
throughput gain with no acceptance collapse, on both a synthetic and an
upstream-derived workload. Absolute levels are lower on the upstream-derived work,
which is consistent with harder tasks — and one task that the model cannot solve
at all.

Notably, the prior capacity-curve report also recorded an above-linear efficiency
(`E(3) = 1.192`) and attributed it to repetition variance rather than a real
superlinear effect. The same caution applies here, for the same reason.

## Interpretation

**Decision: `REAL_WORK_SCALING_SIGNAL_OBSERVED`.**

The criterion is "N=2 shows a material positive accepted-throughput gain without
an offsetting collapse in acceptance." Both halves hold: median accepted
throughput rose from 19.35 to 48.85 tasks/hour, all three paired repetitions moved
in the same direction, and acceptance rose from 58.3% to 66.7%.

`REAL_WORK_HIGH_VARIANCE` was considered and rejected. Variance is real — N=1 wall
clock spans 372–462 s on an identical task set — but it does not prevent a
directional conclusion, because no repetition contradicts the direction.

### Separating observation from interpretation

*Observed:* T(1) = 19.35, T(2) = 48.85, S(2) = 2.52, E(2) = 1.26, acceptance
7/12 → 8/12, median wall clock 393.7 s → 204.2 s, zero timeouts, zero
infrastructure failures, zero scope violations.

*Interpretation:* the honest reading of `E(2) = 1.26` is that it is an artifact,
not a discovery. It decomposes into two parts:

1. **Wall-clock compression, median 2.05×.** Two workers finished the same
   four-task trial in roughly half the time. Near-linear at N=2 is plausible here
   because the workload is provider-latency-bound and 2 concurrent agents on 4
   cores did not contend. Individual repetitions ranged 1.78–2.26, straddling 2.0,
   so "approximately linear" is as strong a statement as the data supports.
2. **One extra accepted task at N=2.** This lifts the ratio the rest of the way.
   It is entirely attributable to `semver-coerce-options`, whose three failures
   were all runs where the agent hit a denied tool call and made no edit. That is
   agent nondeterminism, not a concurrency effect.

With only 4 tasks per trial and 3 repetitions, a one-run acceptance swing moves
throughput by up to 50%. No statistical significance is claimed from n=3; medians,
ranges and paired differences are reported instead, as pre-registered.

The measurement methodology itself is the main thing validated here: accepted
throughput, acceptance classification, editable-scope enforcement, phase timing and
usage capture all behaved correctly on upstream-derived work, and cleanly separated
task rejection from timeout and from infrastructure failure.

**No recommendation to increase concurrency is made on the basis of this result.**
This experiment measured N=1 and N=2 only, on one repository, with one model, on
one host. It says nothing about where the knee is on this workload.

## What this proves

- Rapture can construct, prove and execute a benchmark derived from a third-party
  upstream codebase, with full provenance and no post-acquisition ambiguity about
  what was changed.
- The accepted-throughput measurement is meaningful on upstream-derived tasks: it
  distinguished a task the model always solves, a task it never solves, and a task
  whose failures come from agent aborts.
- Deterministic external validation works on real code, including a task
  ("repair this test suite") that cannot be decided by running the suite alone.
- Known-good solutions are unreadable from the agent worktree, demonstrated both by
  construction and by an agent actively failing to fetch the upstream source.
- On this workload, raising OpenCode concurrency from 1 to 2 workers produced a
  material accepted-throughput gain with no acceptance degradation, consistently
  across three paired repetitions.
- The earlier 1→2 scaling result was not purely a synthetic-fixture artifact: the
  qualitative pattern reproduces on upstream-derived work.

## What this does not prove

- **Not superlinear scaling.** `E(2) = 1.26` is an artifact of a one-run acceptance
  difference plus latency variance at n=3.
- **Nothing about N≥3** on this workload. The knee was not probed and is not
  implied.
- **Not statistically significant.** n=3 repetitions, 4 tasks, one model, one host.
- **Not generalizable** to other repositories, other agents, other models, or other
  hosts. One upstream repository is one data point.
- **Memorization is not controlled.** `semver` is a very widely distributed package,
  and the run log shows the agent explicitly recognising it as "semver 7.8.5" and
  attempting to fetch upstream source. For the three tasks derived from upstream
  code, a model may be recalling the canonical implementation rather than reasoning
  from the repository. This inflates acceptance in a way this experiment cannot
  separate out, and it is the single largest threat to the external validity being
  claimed. The `test_repair` task is the least exposed, since its suite is
  Rapture-authored and not upstream.
- **Nothing about cost.** The model is free-tier; provider-reported cost is 0 and
  all derived monetary metrics are null.
- **Nothing about commercial value, product-market fit, prediction, or control.**
  `PREDICTION_NO_INCREMENTAL_VALUE` and `LOCAL_CONTENTION_ATTRIBUTED` are unchanged
  by this work.
- **Not a production infrastructure claim.** A 4-core, 8 GiB laptop is not
  production agent infrastructure.

## Benchmark status after this work

**`REAL_WORK_BENCHMARK_PARTIAL` is retained.** It is not promoted.

What genuinely improved: the suite now includes a repository derived from a real
upstream third-party codebase with recorded provenance, deterministic validators
proven against baseline and known-good, demonstrated read isolation, and — for the
first time — evidence from actual real-agent execution rather than fixture proofs
alone.

What still limits it, and why promotion would be unjustified:

- One upstream repository, 4 tasks. The brief capped V1 at 4 tasks; that cap is a
  scope decision, not a sufficiency argument.
- One language and ecosystem (Node.js/CommonJS), one licence, one architectural
  style.
- The repository was selected partly *because* it has zero dependencies, which is
  atypical of real projects. Nothing here shows the method survives a repository
  that needs an install, a build, or a service.
- Memorization is uncontrolled, as described above.

## Quality gates

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm biome check .` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` (213 vitest + 13 node:test) | PASS |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| `benchmark-doctor` (v1) | PASS — 4/4 proofs, source tree clean |
| `benchmark-doctor` (v0, 0.1.1) | PASS — 8/8 proofs, unchanged |
| Baseline-reject proof, every new task | PASS (2/2 each) |
| Known-good-pass proof, every new task | PASS (2/2 each) |
| Read-isolation proof | PASS |
| Editable-scope violation rejected | PASS |
| Fixture/provenance integrity | PASS |
| Historical frozen experiment integrity | PASS — 7/7 sidecars, 0 drift |
| Manifest regeneration is a byte-identical no-op | PASS |
| `git status` clean after read-only regeneration | PASS |

Biome's `--write` initially reformatted the frozen `real-work-v0` manifest. That
change was reverted and the formatter was instead configured to leave
machine-generated, integrity-hashed benchmark artifacts alone — formatter churn
there would silently invalidate a suite fingerprint. The upstream-derived fixture
is likewise excluded, because reformatting third-party code would be an
undocumented transformation.

## Provider quota usage

OpenCode only, `opencode/hy3-free`, provider-reported cost `0` throughout.

| Phase | Runs | Notes |
| --- | --- | --- |
| Model availability probes | 3 | one trivial prompt per candidate model |
| Pre-freeze capability probes | 3 | disclosed in the freeze; excluded from results |
| Frozen experiment | 24 | the reported matrix |
| **Total agent invocations** | **30** | |

Experiment tokens: 638,234 input, 46,026 output, 2,598,656 cached input, 69,150
reasoning. **Codex was never invoked and consumed no quota.**

## Exact commits

| Commit | Subject |
| --- | --- |
| `16b4c14` | `benchmark: add upstream-derived real-work fixture and provenance` |
| `331882f` | `benchmark: add deterministic real-work tasks and validation proofs` |
| `a6f157d` | `research: freeze real-work external-validity experiment` |
| `e6d4972` | `research: record OpenCode 1-vs-2 external-validity result` |

Branched from `321d9c00df65add0d1fd2cf35d8c1691753dc726`. The freeze was committed
before any experiment run was consumed; results are committed separately.

## Push result and PR URL

Branch `research/real-work-external-validity-v1` pushed to
`https://github.com/wiramahendra/rapture`.

Draft PR: <https://github.com/wiramahendra/rapture/pull/8> — opened as a draft
against `main` and deliberately **not** merged.

## Recommended next empirical question

The result that most limits confidence is not the scaling number — it is that a
single well-known, zero-dependency repository underwrites the external-validity
claim, with memorization uncontrolled.

The next question worth answering is therefore **not** "where is the knee on real
work". It is:

> Does the accepted-throughput measurement hold up on an upstream repository the
> model is unlikely to have memorized, and one that requires a real install and
> build step?

Concretely: add a second upstream-derived repository chosen for low public
prominence and a non-trivial toolchain, keep the same 1-vs-2 design, and compare
acceptance and throughput patterns against this one. If the pattern holds on a
repository the model cannot recall, the external-validity claim strengthens
considerably. If acceptance collapses, this experiment's acceptance rates were
memorization-inflated and should be re-read accordingly.

A useful control, cheaper than a whole second repository: re-run the existing four
tasks with the upstream `README.md` removed from the fixture, to measure how much
of the acceptance rate depends on documentation the agent can read versus code it
must understand.
