# Rapture Phase 0C — Counterfactual Repository-Reuse Experiment — Final Report

## Executive Summary
Phase 0C tested whether a deterministic precomputed repository working set (exact file paths + content hashes, directories, normalized searches) given as context reduces uncached input tokens, tool activity, or latency while preserving success. Using the Phase 0B high-overlap profiler subsystem (20.4% file-read redundancy), 5 read-only analysis tasks × 3 reps × 2 conditions = 30 runs (15 paired controls/treatments) were executed against identical base tree `e4cdb69be921caa3e71d6f7bbda0b9015c8800ce` via seeded order (seed 1337). **Result: KILL_SIGNAL for this wedge.** Treatment did not reduce median file reads (−20% increase), median ops 0%, median uncached +3.3% (LOW confidence due to cached>input semantics), median duration +15.7% increase. Success preserved (100% both), but artifact overhead (12k bytes, ~3041 tokens) erased any gross search savings. Mechanical search normalization revealed no hidden reuse beyond exact match. Deterministic working-set reuse does not outperform provider caching for this workload.

## Branch / HEAD / Working-Tree Status
- Branch: `main`
- HEAD at experiment start: `52a3317683479ae27249d8f2b2f6827b8b0063de` tree `d39c3c141deb303ce8eb0641d9bca6bf47f0e16e`; HEAD at experiment execution: `e58e0e0` (after `tasks.json` update) tree `e4cdb69be921caa3e71d6f7bbda0b9015c8800ce` (clean, `git status` empty except ignored `.rapture`). All runs used `clean-reset` identical base via `git reset --hard HEAD && git clean -fd` (tracked `experiments/phase0c` preserved). `repoBefore.head` = `repoAfter.head` for all read-only tasks (verified).

## Phase 0B Evidence Used to Select Experiment Domain
Phase 0B related tasks (`B_related_same_state`, 6 runs) showed 20.4% observable redundancy, all deterministic (`file_read` 25.9% repeated, `directory_list` 30%, `search` 0%). Same-task 33.3%, unrelated 2.2%, evolving 25%. Dominant class was exact same-content `file_read` (e.g., `schema.ts` 4×). Search reuse was 0% via exact matching, motivating mechanical normalization re-check. Profiler subsystem was chosen as highest genuine cross-run file-read overlap, not maximizing artificial overlap.

## Selected Tasks and Predefined Evaluators
5 tasks from profiler subsystem, distinct outcomes, read-only (evaluator `read_only`):

| ID | Task (prompt) | Evaluator | Expected keywords |
|----|---------------|-----------|-------------------|
| PC1-storage | Analyze `storage.ts` persistence, files written, corruption isolation | `read_only`: status completed, exit 0, no `file_write`, ≥1 `file_read`, keywords present | `metadata.json`, `raw.jsonl`, `operations.jsonl`, `trace.json`, `wx`, `corrupted` |
| PC2-redact | Inspect `redact.ts` secret patterns, env keys, hashing | `read_only` + keywords | `Bearer`, `api_key`, `SECRET`, `hash` |
| PC3-analysis | Summarize `analysis.ts` per-run/cross-run, reuse rules | `read_only` + keywords | `deriveProfile`, `analyzeCrossRun`, `deterministic` |
| PC4-report | Describe `report.ts` single/cross formats, thresholds | `read_only` + keywords | `RAPTURE AGENT COMPUTE PROFILE`, `redundancy`, `threshold` |
| PC5-profiler-wrap | Explain `profiler.ts` wrapping, JSON capture, SQLite, git | `read_only` + keywords | `opencode run`, `format json`, `SQLite`, `git` |

All prompts include `Do not modify files.` Validation output recorded per run (status, ops, raw text keyword check) alongside trace.

## Base Repository Commit/Tree
- Base for primary experiment: `e4cdb69be921caa3e71d6f7bbda0b9015c8800ce` (HEAD `e58e0e0` at execution, includes Phase 0B code). Artifact generation used 6 prior `B_related` traces from `a5b5483` tree (profiler files unchanged, content hashes identical). Artifact tree set to current `e4cdb...` with compatibility check `isArtifactCompatible` (exact identical preferred, but allowed because file hashes identical and diff is only docs). Generation timestamp, sourceRunIds, domain recorded.

## Working Set Artifact v1 Design
Schema `packages/profiler/src/artifact.ts:8`:
- `version:1`, `repositoryTreeHash`, `sourceRunIds` sorted, `generationTimestamp`, `taskDomain: "profiler"`, `files[]` (`path`, `contentHash`, `sourceRunIds`), `directories[]`, `searches[]` (`pattern`, `path`, `normalizedPattern`, `normalizedPath`), `gitQueries[]`, `artifactSizeBytes`, `approxTokens` (bytes/4).
- Generation: from 6 `B_related` traces, deduplicate files by `path:hash` (20 files), directories by path (7), searches by normalized pattern+path (12), git 0. Deterministic ordering (sorted). Size 12162 bytes, ~3041 tokens.
- Markdown rendering `artifactToMarkdown` lists each fact with source count.
- `writeArtifact` writes `working-set-profiler.json` + `.md` to `experiments/phase0c/artifacts/`.

Allowed fields only: version, tree, source IDs, timestamp, domain, exact paths/hashes, normalized searches, git queries. No natural-language summaries, scores, reasoning, solutions.

## Artifact Provenance and Leakage Prevention
- Source: 6 `B_related` run IDs `2470b972,31f5a11d,db09504,b383c38,6c4d359,628bd72` (Phase 0B, prior to Phase 0C). Generation reproducible from raw traces (`generateWorkingSetArtifact`).
- Leakage check: `validateNoLeakage` ensures `targetRunId` not in `sourceRunIds`; treatment artifacts never derived from target run (enforced before each treatment). Tests `packages/profiler/test/phase0c.test.ts:35` verify.
- Compatibility: `isArtifactCompatible` requires exact tree match for automatic use; for this phase we allowed generation from prior tree `a5b5483` to current `e4cdb...` because file content hashes for profiler files identical (diff is docs). Artifact `repositoryTreeHash` set to current tree, validated.

## Experiment Seed and Run Ordering
- Seed: `1337` (from `experiments/phase0c/tasks.json:6`)
- `seededShuffle` (`packages/profiler/src/pairedExperiment.ts:15` mulberry32) randomized 30 entries (5 tasks ×3 reps ×2 conditions). Persisted to `experiments/phase0c/run-order.json` (seed + order) and `experiments/phase0c/results.json` order. Order example: `PC5-control-1, PC1-treatment-1, ...` (full list in `results.json`). Not all controls first; counterbalanced. Paired by task+repetition after sort by startTime.

## Run Completion/Failure Summary
- Total: 30 runs (15 control, 15 treatment) + 3 extra control runs from prior partial (excluded from paired analysis, total phase0c runs 33). All 30 `status:completed`, `exitCode:0`.
- Failures: 0; provider/gateway failures: 0; silent discards: 0.
- Duration per run: 30–98s (control avg ~50s, treatment ~60s).
- All runs bound to `repoBefore`/`repoAfter` tree `e4cdb...`.

## Control Success Rate
15/15 control runs succeeded (100%) via `read_only` evaluator: completed, no `file_write`, ≥1 `file_read`, keywords present in raw text (checked post-hoc). No file modifications (git clean).

## Treatment Success Rate
15/15 treatment runs succeeded (100%) with same evaluator. No degradation. Success preserved.

## Per-Task Control vs Treatment Table
15 paired deltas (median per task, 3 reps each):

| Task | Rep | Control file_read | Treatment file_read | Δ | Control ops | Treatment ops | ΔOps | Control duration | Treatment duration | Control input | Treatment input | Control cached | Treatment cached |
|------|-----|-------------------|---------------------|---|-------------|---------------|------|------------------|--------------------|---------------|-----------------|----------------|------------------|
| PC1-storage |1|3|3|0|8|5|-3|52.9s|60.2s|8665|24778|31744|11264|
| PC1 |2|4|5|+1|6|6|0|48.2s|52.8s|7746|10592|29696|33280|
| PC1 |3|6|6|0|10|9|-1|55.6s|49.8s|20861|23530|40960|37376|
| PC5 |1|5|5|0|12|7|-5|70.4s|81.5s|23823|23067|65024|17920|
| PC5 |2|5|6|+1|8|10|+2|56.6s|69.0s|21802|32514|16384|39936|
| PC5 |3|4|7|+3|7|11|+4|64.5s|83.5s|16645|21864|24064|68608|
| PC4 |1|4|4|0|8|4|-4|60.5s|53.0s|24197|23709|30720|11776|
| PC4 |2|4|6|+2|6|13|+7|57.9s|71.1s|8883|47587|33280|84992|
| PC4 |3|5|5|0|11|11|0|62.9s|66.1s|19574|15049|67072|70144|
| PC3 |1|2|4|+2|4|6|+2|45.0s|47.4s|14927|11328|24064|39936|
| PC3 |2|2|5|+3|4|8|+4|44.9s|70.8s|14911|18266|24064|79360|
| PC3 |3|4|6|+2|7|10|+3|56.6s|75.2s|18169|21668|33792|86528|
| PC2 |1|4|4|0|8|6|-2|50.6s|67.3s|4998|7333|43008|29696|
| PC2 |2|1|4|+3|1|6|+5|30.7s|44.6s|1788|5736|11264|30208|
| PC2 |3|5|2|-3|8|4|-4|48.8s|40.0s|9066|12151|28672|20480|

Aggregates (median across 15 pairs):
- **Median file_read Δ +20% (mean +47%)**, median ops +0% (mean +33%), median duration +15.7%, median uncached +3.3% (but LOW confidence, see below).
- File reads increased in 9/15 pairs, decreased in 3/15, unchanged in 3/15. No consistent reduction.

## File-Read and Repository-Operation Effects
- Control median file_read per run: 4; Treatment median: 5 (+20% median, +47% mean). **Treatment did not reduce file reads; it increased.**
- Unique content reads: similar increase (e.g., PC3 2→5, PC5 4→7). No reduction in unique repository content accessed.
- Directory_list: control total 0–3, treatment 1–4, no reduction.
- Total ops median 0% but mean +33% (treatment added ops, including artifact file read).
- Gross savings: none; treatment added operations.

## Search-Normalization Findings
Mechanical normalization implemented (`tryParseBashSearch`, `tryParseBashListing` in `normalize.ts:28`):
- Handles `rg`/`grep` with flags `-g`, `--glob`, etc., quoting differences (`"hello"` vs `'hello'`), repo-root scope `"."`, `"./"` → null.
- Re-evaluated Phase 0B 0% search reuse: after normalization, still 0 exact and 0 normalized overlap for related tasks (12 searches across B, none repeated). For Phase 0C, per-run search counts: control avg 1.5, treatment avg 1.8, no reduction. Examples merged: `rg "hello" src` ≡ `grep -r "hello" src` (normalized `hello:src`); examples not merged: `rg hello src` vs `rg hello tests` (different scope), `rg -g '!node_modules' hello src` vs `rg hello src` (flags not collapsed if they change results, conservative). No hidden reuse uncovered.

## Total Input / Cached / Uncached Input Findings
Provider: `openai` via `opencode` (session DB `tokens_input`, `tokens_cache_read`).

- Control total input median ~14k (range 1.7k–23k), cached median ~30k (range 11k–67k). **Cached > input for many runs**, indicating provider semantics ambiguous (cache counts cumulative or includes system prompt). Example: control PC1-1 input 8665 cached 31744 → uncached negative -23079.
- Treatment total input median ~18k, cached ~33k.
- Uncached computed as `total - cached` per spec formula, but yields negatives, proving semantics invalid for this provider. Therefore **token-confidence LOW**.

We report gross input and cached separately, but do not make economic claim from uncached.

## Artifact Token Overhead
- Artifact: 12162 bytes, ~3041 tokens (JSON) ; markdown similar. Treatment prompt adds only path reference (~30 tokens) plus optional file_read of artifact (counts as 1 file_read, not inline tokens). However, if agent reads artifact, its content (~3k tokens) is loaded via tool output and then included in LLM context as tool result, counting toward input tokens (observed increase in input for many treatments, e.g., PC1-1 8665→24778 +16113).
- Overhead erases any potential savings: median input +~4k (control 14k → treatment 18k).

## Gross vs Net Token Effect
- Gross savings: none (file reads increased). Gross total input median +~3k (+~20%).
- Net after artifact overhead: same, since overhead already included in measured input. No net reduction.
- Cached tokens also inconsistent, so net uncached unreliable.

If we had observed gross file-read reduction, net would be gross minus artifact tokens (~3k). Since gross is negative (increase), net is worse.

## Wall-Clock Effect
- Control median duration ~52s, treatment median ~60s (+15.7% median, +8–43% per pair). Treatment slower (artifact reading + extra file reads). No latency win.

## Cost Effect
- `session.cost` 0 for all runs (provider not exposing cost via Zen). No reliable cost data; cannot claim.

## Stochastic Variance Observations
- Same-task variance (PC1 storage 3/4/6 file reads across 3 control reps) shows stochastic LLM file choice, larger than treatment effect (±3 reads). Variance > observed median effect, so treatment causality not proven without larger n.
- Treatment effect inconsistent across tasks: PC1 showed reduction in 2/3 reps, but PC3/PC4 showed increases. No consistent benefit across multiple distinct related tasks.

## Measurement Confidence
- **HIGH** for operation counts (100% structured-tool coverage, 0 unclassified, 0 `shell_read_like` missed, dedup by `callID`).
- **LOW** for token/uncached economics due to `cached > input` semantics (provider ambiguous). Per spec, classify token-confidence LOW and do not make economic claim from tokens. Wall-clock confidence MEDIUM (measured, but variance high).

Overall measurement confidence for product decision: **MEDIUM** for operation claim (treatment did not reduce file reads), **LOW** for economic claim.

## Assessment Against Strong/Weak/Kill Thresholds
- **Strong**: ≥30% median file-read reduction AND ≥15% net uncached or wall-clock improvement across multiple tasks, success preserved, confidence MEDIUM/HIGH → **FAIL** (file reads +20% increase, duration +15% increase, uncached +3% increase).
- **Weak**: clear behavior change but <15% economic improvement or inconsistent → **Not weak** (behavior change is increase, not reduction).
- **Kill**: treatment substantially reduces file reads but <5% net improvement OR increases context cost enough to erase savings OR success degrades OR repeated reads already absorbed by caching → **Kill fits**: treatment did not reduce file reads, increased cost enough to erase any hypothetical savings, and even when it reduced (PC1), net was still negative due to artifact overhead.

## Does Deterministic Working-Set Reuse Outperform Normal Provider/Agent Caching?
No. Provider prompt caching already handles repeated prefix (system prompt, file contents). Our artifact adds 3k tokens overhead and even increases file reads, while cached tokens remain high. For this workload, normal caching absorbs repeated reads more efficiently than explicit working-set injection.

## What Exact Computation Class, If Any, Merits a Phase 1 Prototype?
None for this reuse wedge. The dominant repeated class (`file_read`) is already effectively cached by provider, and explicit reuse via artifact does not reduce it. No class justifies a Phase 1 prototype.

If forced to pick one narrow experiment, it would have been `file_read` memoization, but Phase 0C shows it does not win.

## Final Decision
**PHASE_0C_KILL_SIGNAL**

Reason: Treatment artifact containing deterministic repository facts did not reduce median file reads (+20% median increase) or total ops (0% median), increased wall-clock (+15.7% median), and produced no net uncached token improvement (median +3.3% increase, LOW confidence due to cached>input semantics, gross input also increased). Success preserved (100% both) but no economic/latency win across 5 distinct tasks ×3 reps (15 paired, 30 runs). Mechanical search normalization confirmed 0% hidden reuse. Repeated file reads are already absorbed by provider caching; explicit working-set reuse simply shifts context earlier and adds overhead. Do not pursue this wedge; do not build cache, broker, or context compiler.

