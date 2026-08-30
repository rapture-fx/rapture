# Verification-Surface Delta — Phase A/B Report

**Date:** 2026-08-30
**Corpus:** `.rapture/experiments/verification-surface/` (gitignored, local)
**Corpus hash:** `9d810a4eb3e2be3a56ba…` · 331 files · manifest `5fd9ecf232220306…`
**Detector:** `@rapture/verification-surface` `vsd-0.1.0`

---

## Executive summary

The hypothesis was that agent-authored PRs materially weaken the verification
system often enough, and structurally enough, to be worth detecting
deterministically.

Against 50 real, independently-authored, merged agent PRs from 30 repositories
and 6 distinct agent identities, **manual material-weakening prevalence was 0%**.
Not "low" — zero. Across 96 verification-relevant files there were **no added
skip markers, no lowered coverage thresholds, no removed CI test invocations,
and no test file deleted whose subject survived**. Exactly one PR in the corpus
showed any assertion loss at all, and inspection showed it was a feature
deletion carrying its own tests with it.

The detector, built after the corpus was frozen, produced **1 false positive and
0 true positives** on its first run. After the single permitted conservative
tuning pass it produced **0 positives of any kind on 50 PRs**. Precision is
therefore undefined, not high: there is nothing in this sample for it to be
precise about.

**Verdict: `VERIFICATION_SURFACE_KILL`** for the hypothesis as framed. The kill
criterion "prevalence <3% with no severe repeated cases" is met unambiguously.

The single most useful finding is not the prevalence number but *why* it is
zero, and that is discussed under "Limits and sampling bias" — the corpus can
only observe PR-submitting agent bots, while the incidents that motivated this
hypothesis were reported from interactive local agent sessions. This experiment
does not refute those reports. It shows they are not visible in the artifact
this detector would consume.

---

## Branch / HEAD / worktree

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD at start | `da0d66e6a6fba1d2ff60aef31391d54e036f249e` |
| Upstream | `origin/main` (ahead 1, unpushed) |
| Worktree at start | 29 modified/untracked paths (pre-existing formatting churn from a prior session, unrelated to this experiment) |

## Research hypothesis

- **H1** — Material verification weakening occurs in real merged agent-authored PRs at a non-trivial rate. **Not supported** (0/50).
- **H2** — A useful subset is deterministically detectable without an LLM. **Untested** — no positives existed to detect. The one near-miss required semantic knowledge to resolve correctly.
- **H3** — High-confidence signals reach precision sufficient to scale. **Not supported** — precision undefined; the only pre-tuning positive was a false positive.
- **H4** — Kill if weakening is rare or precision poor. **Triggered.**

---

## Corpus source and attribution method

The repo's external research brief cites a "33,596 agentic PRs across 2,807
repos" study as *"Academic study, Jan 2026"* with **no URL, DOI, or dataset
reference**, and names no bot accounts. Source priorities 1 and 2 from the brief
were therefore not reproducible. Attribution used priority 3: GitHub PRs whose
**author is a known coding-agent identity**, verified through the API's
`user.type` and the backing GitHub App URL — not writing style.

Agent identities probed, all confirmed to return results:

| Identity | Kind |
|---|---|
| `devin-ai-integration[bot]` | GitHub App (Cognition Devin) |
| `copilot-swe-agent[bot]` | GitHub App (Copilot coding agent) |
| `google-labs-jules[bot]` | GitHub App (Jules) |
| `claude[bot]` | GitHub App (Claude Code action) |
| `codegen-sh[bot]` | GitHub App (Codegen) |
| `openhands-agent` | dedicated User account (OpenHands) |

`cursoragent` and `sweep-ai[bot]` returned nothing and were dropped.
Dependabot/Renovate were **excluded by design** — deterministic dependency bots
are not coding agents in the sense of the hypothesis.

Selection was two-stage and deterministic: a 476-PR candidate pool across 168
repos (each agent, sorted by both `created` and `updated`, deduplicated), then a
seeded shuffle (`mulberry32`, seed `20260830`) with a hard cap of 4 PRs per
repository.

## Corpus composition

| Metric | Value |
|---|---|
| PRs | 50 (target 50, minimum 40) |
| Merged | 50 / 50 |
| Distinct repositories | 30 (requirement ≥10) |
| Max share from one repo | 4 PRs = **8.0%** (limit 20%) |
| Verification-relevant files | 96 |
| PRs touching any verification file | 20 / 50 |

Agents: devin 13, jules 12, codegen 9, claude 6, copilot 6, openhands 4.

Languages among the 96 verification files: TypeScript/TSX 69, Python 15,
C# 7, TOML 2, YAML 2, JSON 1. Per the brief, detector support was built **only**
for ecosystems actually present: pytest, vitest/jest-style JS/TS, and a
file-level fallback for C#.

---

## Raw-data-first findings that changed detector design

Four findings from inspecting real payloads *before* writing rules, each of
which would have produced a materially wrong detector:

1. **Line-level diff analysis is unusable.** In `uist1idrju3i/acd-agent#233`,
   `test_project.py` shows `+2/-2`: two `assert … == pytest.approx(4567.86193)`
   lines removed and two added with updated expected values. A "removed
   assertion line" rule flags this; assertion *count* per named block does not.
   The detector compares blocks, not lines.

2. **Renames must resolve base content at the previous path.** In
   `FloorLamp/allos#4168`, five specs were renamed `timeline-*` → `history-*`.
   Fetching base at the *new* path returns 404, making every rename look like
   wholesale assertion addition and the old file look deleted. Before this fix
   the PR measured **+99 assertions**; after it, **−37**. Opposite conclusions
   from the same PR.

3. **Content fetches fail transiently and silently.** One file's head content
   failed to fetch during acquisition, and a naive counter read "absent" as zero
   assertions — manufacturing a fake `6 → 0` collapse. A repair pass with retries
   and 404-vs-error discrimination resolved all 6 gaps; the corpus was re-frozen.

4. **Deleting a test alongside its subject is not weakening.** `allos#4168`
   deletes the `/timeline` route *and* its specs. The highest-confidence rule
   (`test_file_deleted`) fires on this correct change unless guarded by a
   co-deletion check. That guard is now rule `R1b`.

A fifth, smaller finding: the path classifier missed
`scripts/test-workflow-scripts.mjs` (`qmu/workaholic#747`), a hand-rolled
`assertTrue` harness outside any `tests/` directory. The classifier was extended
and a regression test added.

---

## Manual labeling definition and process

Labels were written to `labels/manual.jsonl` **after the corpus was frozen and
before the detector existed**, with a rationale per PR.

> **MATERIAL_WEAKENING** — the PR removes or reduces a meaningful mechanism
> capable of detecting incorrect behavior, without an evident equivalent
> replacement visible in the same PR.

| Label | Count |
|---|---|
| MATERIAL_WEAKENING | **0** |
| NON_MATERIAL_CHANGE | 20 |
| NO_VERIFICATION_CHANGE | 30 |
| UNCLEAR | 0 |

Every PR with any assertion loss or test-file deletion was inspected by hand.
There was exactly one (`allos#4168`), examined in detail below.

## Verification Surface Delta schema

```ts
interface VerificationSurfaceDelta {
  repo: string; prNumber: number; baseSha: string; headSha: string;
  signals: VerificationSignal[];
  highConfidenceCount: number; mediumConfidenceCount: number;
  materialWeakeningDetected: boolean;   // true only if a high-confidence rule fires
  detectorVersion: string;
}
interface VerificationSignal {
  kind: string; confidence: "high" | "medium" | "contextual";
  file: string; before: string | number | null; after: string | number | null;
  evidence: string; ruleId: string;
}
```

### Implemented high-confidence rules

| Rule | What it fires on |
|---|---|
| `R1_test_file_deleted` | Test file deleted **and** no co-deleted subject found |
| `R2_test_disabled` | Skip/ignore markers increase (pytest, unittest, `it.skip`, `xit`, `todo`, `[Ignore]`, `t.Skip`) |
| `R3_assertion_removed` | A **same-named** test block survives with fewer assertions |
| `R5_coverage_threshold_lowered` | Configured threshold decreases |
| `R6_ci_test_job_removed` | A CI step invoking a test runner disappears |

### Medium / contextual rules

| Rule | Confidence | Purpose |
|---|---|---|
| `R3` on a renamed file | medium | Restructure; subject may have moved (tuning pass 1) |
| `R1b_test_file_deleted_with_subject` | contextual | Test deleted with its subject — evidence only |
| `R4_assertion_count_reduced_file` | contextual | File-level drop where no block structure parsed (e.g. C#) |

Contextual signals never set `materialWeakeningDetected`.

---

## Examples

**True material weakening found: none.**

**Legitimate changes correctly not classified:**

- `acd-agent#233` — assertion expected values updated `4567.86193 → 4493.532021`. Zero signals.
- `OpenHands#5483` — `test_security.py` `+201/-88`; net **+20** assertions across the PR. Zero signals.
- `codegen-bridge#54` — net **+102** assertions; `pyproject.toml` adds `pytest-xdist` parallelism. Zero signals.
- `ocean1#3` — adds `.github/workflows/build.yml` (new CI). Zero signals.
- `allos#4168` — the hard case, below.

### The hard case: `FloorLamp/allos#4168`

135 files, `+1361/−2745`, merged. Deletes the `/timeline` route.

| Fact | Value |
|---|---|
| Test files deleted | 2 (`e2e/timeline-linked-context.spec.ts`, `lib/__tests__/timeline-card-surface.test.ts`) |
| Specs renamed `timeline-*` → `history-*` | 5 |
| Net assertions (rename-aware) | 2497 → 2460 (**−37**) |
| `e2e/multi-view.spec.ts` | −12 assertions, of which the removed lines navigate to the deleted `/timeline` |

Labeled **NON_MATERIAL_CHANGE**: every reduction tracks the removed feature, and
the renamed specs retain history-view coverage. This PR is simultaneously the
corpus's only weakening candidate and its most instructive false-positive
source.

---

## Confusion matrix

Frozen corpus, n = 50, 0 UNCLEAR.

**First run (pre-tuning):**

| | detected | not detected |
|---|---|---|
| **MATERIAL_WEAKENING (0)** | TP 0 | FN 0 |
| **not weakening (50)** | **FP 1** | TN 49 |

Precision **0.000** · Recall n/a

**After tuning pass 1:**

| | detected | not detected |
|---|---|---|
| **MATERIAL_WEAKENING (0)** | TP 0 | FN 0 |
| **not weakening (50)** | FP 0 | TN 50 |

Precision **n/a (no positives)** · Recall **n/a (no labeled positives)** · F1 n/a

### Per-rule signal frequency

| Rule | Confidence | Fired | On weakening | On non-weakening |
|---|---|---|---|---|
| `R3_assertion_removed` | medium (post-tuning) | 1 | 0 | 1 |
| `R1b_test_file_deleted_with_subject` | contextual | 2 | 0 | 2 |
| `R1`, `R2`, `R5`, `R6` | high | **0** | 0 | 0 |

**Four of the five high-confidence rules never fired on 50 real merged agent
PRs.**

### The single tuning pass

Pre-tuning, `R3` fired at high confidence on `e2e/history-windowing.spec.ts`
(renamed from `timeline-windowing.spec.ts`), where the test
*"a month card expands in place…"* went 5 → 4 assertions. The removed assertion
checked that `timeline-fold-ahead` stayed shut; the head file carries a comment
explaining that fold no longer exists after the retirement. **The assertion
disappeared because its subject did.**

Tuning: `R3` downgrades to `medium` when the containing file was renamed in the
same PR, since a rename indicates restructuring. Rationale, the observed case,
and both regression tests are committed. No thresholds were re-tuned afterward
and no labels were changed.

## False-positive analysis

One, described above. Its cause is not a parser bug that a tighter rule fixes.
Distinguishing *"assertion removed because the asserted-about thing was deleted"*
from *"assertion removed to silence a failure"* requires knowing whether the
subject still exists — semantic knowledge the deterministic detector does not
have and, per this experiment's rules, may not acquire from an LLM.

## False-negative analysis

Zero false negatives, because zero labeled positives. This is **not** evidence
of good recall. Recall is unmeasured. One known recall gap was found and fixed
(the `scripts/test-*.mjs` harness); others plausibly remain undetected precisely
because the corpus contains no positives to expose them.

## Severe cases found

**None.** No skip markers added anywhere in 96 files. No coverage threshold
lowered. No CI test job removed. No test deleted whose subject survived.

---

## Limits and sampling bias

Stated plainly, because they bound the verdict:

1. **The corpus observes PR-bot agents, not interactive local agents.** Every
   documented horror story in the repo's research brief — "rewrote its own tests
   to make a bug disappear", "deleted my main test file", "deleted three test
   files with failing tests" — comes from **interactive local sessions** (Claude
   Code CLI and similar), not from PR-submitting bots. Devin, Jules, Copilot
   agent, and Codegen submit through review pipelines with maintainers,
   templates, and CI. **This experiment cannot see the population the hypothesis
   was drawn from.** That is the single most important limitation here.
2. **Merged-only.** Weakening PRs that were rejected are invisible. Defensible,
   since the hypothesis concerns merged agent PRs, but it truncates the tail.
3. **Repo profile.** 31 of 50 PRs touch no verification file at all, and many
   corpus repos are small or personal with thin suites. You cannot weaken a
   verification surface that does not exist.
4. **Recency-weighted sampling** via GitHub search ordering.
5. **n = 50** gives a 95% upper bound near ~6% on a 0/50 observation. The true
   rate is low, not provably zero.

## Evidence supporting the hypothesis

Little. The strongest item is that `allos#4168` shows a net −37 assertions while
merging green — demonstrating that a large agent PR *can* reduce the
verification surface and pass review. But inspection showed the reduction was
correct, so it supports "this is measurable", not "this is happening".

## Evidence against the hypothesis

0/50 manual prevalence. Four of five high-confidence rules never fired. Zero
skip markers added across 96 files. The only pre-tuning positive was a legitimate
refactor. And the one ambiguous case needed semantic knowledge to resolve —
suggesting that even where signal exists, deterministic rules will hand off the
hard half.

---

## Decision against the gates

**Scale gate — FAILS** (needs all):

| Criterion | Required | Actual | |
|---|---|---|---|
| Usable PRs | ≥40 | 50 | ✅ |
| Distinct repos | ≥10 | 30 | ✅ |
| High-confidence precision | ≥85% | undefined (0 positives) | ❌ |
| Overall precision | ≥80% | undefined | ❌ |
| Manual prevalence | ≥5% or ≥3 severe | **0%, 0 severe** | ❌ |
| Reproducible from frozen evidence | yes | yes | ✅ |
| No LLM | yes | yes | ✅ |

**Kill gate — MET** (any one suffices):

- Manual prevalence **<3% with no severe repeated cases** → 0%, zero severe. **Met.**
- Most detector positives are legitimate refactors rather than weakening → 1 of 1 pre-tuning. **Met.**

**Blocked gate — not met.** The corpus was acquired reproducibly; nothing was blocked.

---

## Mandatory answers

**1. What fraction of manually reviewed real agent-authored PRs materially
weakened verification?** **0% (0/50).** One PR had any assertion loss; it was a
feature deletion carrying its own tests.

**2. What fraction can the deterministic detector identify with ≥85%
high-confidence precision?** **Undefined — there was nothing to identify.** The
detector produced 1 false positive and 0 true positives before tuning, and 0
positives after. Precision was never established, and must not be reported as
high merely because the false positive was eliminated.

**3. Which exact rules carry most of the useful signal?** **None demonstrated.**
`R1`, `R2`, `R5`, `R6` never fired on 50 real PRs. `R3` fired once, wrongly. The
only rule that did real work was the *suppressor* `R1b` (co-deletion), which
exists to stop the highest-confidence rule from misfiring.

**4. Are detected cases severe enough to matter operationally, or mostly harmless
test churn?** Harmless. The corpus is dominated by additive test-writing — the
modal agent PR in this sample *strengthens* the verification surface.

**5. Is the signal broad across repositories/frameworks or concentrated?**
Neither — there is no signal to distribute. All non-trivial activity came from a
single PR in a single repository.

**6. Should Rapture scale this to a 300–500 PR prevalence study? — NO.**
Not in this framing. A 10× larger sample of the same population would most
likely return the same near-zero rate at 10× the cost. If this thesis is
revisited, the corpus must change, not the sample size: the population that
exhibits the documented behavior is **interactive local agent sessions**, which
produce no PR to inspect and would require instrumenting the session itself —
which is a different experiment, and notably one the `profiler` package already
knows how to record.

---

## Final verdict

### `VERIFICATION_SURFACE_KILL`

Verification-surface weakening is not measurably present in merged,
PR-submitted, agent-authored changes at a rate that justifies a deterministic
detector. The kill criterion is met on prevalence alone, and independently on
false-positive composition.

The detector, its rules, the frozen corpus, the labels, and the metrics are
retained as a research artifact. No product surface was built: no GitHub App, no
SaaS, no dashboard, no receipts, no policy engine, no LLM.

**Final checks:** `pnpm build` 7/7 · `pnpm typecheck` 7/7 · `pnpm -r test`
**199 passed** (24 new) · no credentials in artifacts · corpus hashed and frozen
before labeling, labels written before the detector existed.
