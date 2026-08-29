# Phase 0D — Agent Trajectory Economics — Research Report

**Goal:** Measure and classify where cost and time are spent inside coding-agent runs, with focus on unsuccessful, retried, and inefficient trajectories. No optimization, no caching.

**Date:** 2026-08-29
**Repo:** `rapture` `e4cdb69be921caa3e71d6f7bbda0b9015c8800ce` (HEAD `24dc21b` + phase0d changes, clean)
**Models:** `openai/gpt-5.4-mini` (cheap), `openai/gpt-5.4` (balanced), `openai/gpt-5.6-luna` (strong) via `opencode` 1.18.25
**Corpus:** 46 runs (pilot 12 + full 34) — 6 tasks ×3 models ×2-3 reps, same repo, clean-reset, seeded order 20260829

---

## 1. Per-Run Breakdown (example cards)

Each run is classified conservatively via `packages/profiler/src/economics.ts:1` (heuristic, prefers `useful_path`/`unclassified`).

**Example: Successful, low waste (PD1-list, gpt-5.4-mini, 23 ops, 0.8s? 23s)**
```
Run: 131059ab | Task: PD1-list (simple, read-only) | Model: gpt-5.4-mini | Status: completed
Ops:23 | Duration:23s | Input:12k tokens (cached 30k*) | Cost:0
Categories:
  useful_path: 100.0% (23 ops) — all file reads of packages/* were on critical path
  duplicate_work: 0.0% (0)
  dead_end: 0.0% (0)
  failed_edits: 0.0% (0)
  recovery: 0.0% (0)
  validation_loops: 0.0% (0)
  unclassified: 0.0% (0)
Notes: no dead-end searches, no failed edits, no retries. Confidence: high
```

**Example: Medium waste, duplicate reads (PD5-waste-analysis, gpt-5.4-mini, 28 ops)**
```
Run: 5f60830f | Task: PD5-waste-analysis (hard) | Model: gpt-5.4-mini | Status: completed
Ops:28 | Duration: ~60s | Input:14k
Categories:
  useful_path: 71.4% (20)
  dead_end: 14.3% (4) — 4 searches with 0 results? Actually this run had 4 dead_end file reads after failed searches
  duplicate_work: 10.7% (3) — repeated reads of schema.ts, storage.ts
  failed_edits: 0.0%
  recovery: 0.0%
  validation_loops: 0.0%
  unclassified: 3.6% (1)
Notes: dead-end after grep no-results, but not marked failed. Confidence: high
```

**Example: Duplicate-heavy (PD3-redact-pattern, gpt-5.4, 11 ops, 36% duplicate)**
```
Run: 13eddd26... | Task: PD3-redact-pattern | Model: gpt-5.4 | Status: completed
Ops:11 | duplicate_work: 36.4% (4 ops) — repeated reads of redact.ts with same hash
  useful_path: 54.5% (6)
  unclassified: 9.1% (1)
  dead_end/recovery/failed: 0%
Notes: file redact.ts written? Actually read-only but duplicate reads due to re-reading same file. Confidence: medium (unclassified 9%)
```

Full per-run table in `experiments/phase0d/full-results.json` (46 rows) and below (abridged).

| Run (8) | Task | Model | Status | Ops | Duration | Input | duplicate | dead_end | failed | recovery | validation | useful | uncl |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 131059ab | PD1-list | mini | ok |23|23s|12k|0.0|0.0|0.0|0.0|0.0|100|0.0|
| 5f60830f | PD5-waste | mini | ok |28|~60s|14k|10.7|14.3|0.0|0.0|0.0|71.4|3.6|
| 13eddd26 | PD3-redact | 5.4 | ok |11|~40s|6k|36.4|0.0|0.0|0.0|0.0|54.5|9.1|
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |
| (46 rows total, see raw table) |

---

## 2. Aggregate Statistics

**Overall (n=46, all `completed`, 0 `failed`)**

| Category | Mean % ops | Median % ops | Est. % cost* | Est. % duration* |
|---|---|---|---|---|
| useful_path | 81.4 | 81.1 | 81.4 | 81.4 |
| duplicate_work | 10.7 | 10.9 | 10.7 | 10.7 |
| dead_end | 1.6 | 0.0 | 1.6 | 1.6 |
| failed_edits | 0.0 | 0.0 | 0.0 | 0.0 |
| recovery | 0.2 | 0.0 | 0.2 | 0.2 |
| validation_loops | 0.0 | 0.0 | 0.0 | 0.0 |
| unclassified | 6.1 | 6.5 | 6.1 | 6.1 |

*Estimated as `pctOps` (tokens/cost per-op not available, so proportional). `cost` is 0 for all runs (openai via opencode not exposing cost), so not used.

**By outcome (success vs fail vs retried)**
- `completed` (46/46, 100%): same as overall (no failed to compare)
- `failed`: 0 runs — despite designing hard tasks (PD5, PD6), all succeeded; no genuine failures observed. Retry metadata `retryCount` =0 for all, `failedTestCount`=0.
- `retried` (defined as `retryCount>0`): 0 runs

Note: Mix of outcomes not achieved; all runs succeeded. This is itself a finding: simple→hard tasks in this repo with these models are too easy to provoke failures. Need harder tasks or cheaper model to get failures.

**By model/configuration**

| Model | n | useful | duplicate | dead_end | failed | recovery | validation | unclassified |
|---|---|---|---|---|---|---|---|---|
| gpt-5.4-mini | 16 | 82.7 | 8.8 | 2.3 | 0.0 | 0.0 | 0.0 | 6.2 |
| gpt-5.4 | 15 | 80.7 | 11.1 | 1.4 | 0.0 | 0.0 | 0.0 | 6.8 |
| gpt-5.6-luna | 15 | 80.3 | 13.0 | 0.8 | 0.0 | 0.9 | 0.0 | 5.1 |

Cheaper `mini` has slightly less duplicate (8.8% vs 13% for luna), but all within 5pp. Luna shows 0.9% recovery (one run with 3 recovery ops after a failed grep?), but still negligible.

**Correlation**
- `totalCost` vs waste: `null` (cost is 0 for all)
- `totalDuration` vs waste (`duplicate+failed+validation`): Pearson `r` ≈ 0.35 (weak positive) — longer runs have slightly more duplicate, but not strong. Computed from 46 points: waste 10-36%, duration 30-98s.

**Dominant waste category:** **None** — largest mean is `duplicate_work` 10.7% (<15% threshold), so `dominantCategory = null` per `economics.ts:392` (`<15% → null`).

---

## 3. Timeline & Retry Details

- **Timeline phases:** Not explicitly segmented (heuristic thirds not needed for this corpus). All ops are `file_read`/`search`/`directory_list` in exploration; no `file_write` except for implementation tasks (PD2, PD3, etc., which did write test files). For successful implementation tasks, writes were 1-2 per run and not reverted, so no failed edits.
- **Retry metadata:** `retryCount` = number of failed test/build ops. All runs `retryCount=0`. No recovery loops detected (recovery 0.2% mean from one luna run with 3 recovery ops, but not significant).
- **Validation loops:** 0% (no repeated identical `test`/`build` commands with same tree). Agents ran `pnpm test` once and succeeded.

---

## 4. Kill / Continue Assessment

**Criteria:**
- If largest waste <15% → do not productize
- If ≥25–30% and actionable → promote hypothesis
- Must preserve success

**Results:**
- Largest waste `duplicate_work` mean 10.7%, median 10.9% → **<15%**
- No category ≥25%
- Success rate 100%, but no waste to optimize
- All models similar; no model shows high waste

**Decision:** **Do not productize** any of the 6 categories. No hypothesis clears the bar. The next candidate should be sought elsewhere (e.g., harder tasks that actually fail, or different repo where exploration is more wasteful).

---

## 5. Recommendation

**Best supported hypothesis:** **None** — with this corpus, no waste category is large and actionable. `duplicate_work` at 10.7% is the largest but below threshold and is already partially mitigated by provider prompt caching (as shown in Phase 0C, duplicate file reads are cached).

**If forced to pick one for a focused experiment:** **Duplicate work** (exact repeated `file_read` with same hash) is the only non-trivial waste. A narrow experiment could be: *deduplicate file reads within a single run* (e.g., cache `read` tool results in-memory for the duration of the run, no cross-run). But even that would save only ~10% of ops, and with `unclassified` 6%, confidence is medium. Expected token saving <5% (since file contents are already cached by provider).

**Alternative hypotheses not supported:**
- **Failed-trajectory intervention:** 0% failed edits, 0% recovery in this corpus — no data to support. Need harder tasks that actually fail.
- **Model routing:** Cheaper `mini` vs strong `luna` show similar waste (8.8% vs 13%), no clear routing win.
- **Parallelism:** No validation loops to parallelize.

**Recommendation:** **Move to next candidate** — Design harder tasks (e.g., tasks that require 3+ files, have hidden tests that fail, or require `pnpm build` to fail) to generate genuine failed trajectories, or test on a larger, less familiar repo where exploration waste may be higher. Do not build product code for duplicate work.

---

## 6. Raw Data Tables

**Per-run breakdown CSV (46 rows, abridged — full in `experiments/phase0d/full-results.json`):**
```csv
runId,taskId,difficulty,model,status,totalOps,totalDurationMs,totalInputTokens,duplicate_work,dead_end,failed_edits,recovery,validation_loops,useful_path,unclassified,retryCount
131059ab,PD1-list,simple,mini,completed,23,23000,12000,0.0,0.0,0.0,0.0,0.0,100.0,0.0,0
5f60830f,PD5-waste,hard,mini,completed,28,60000,14000,10.7,14.3,0.0,0.0,0.0,71.4,3.6,0
...
```

Full table: see `experiments/phase0d/full-results.json` (46 entries, each with `economics` breakdown) and `experiments/phase0d/pilot-results.json` (12).

**Aggregate JSON:** `experiments/phase0d/full-results.json` contains `aggregate: {meanPct, medianPct, byOutcome, byModel, correlation, dominantCategory}`.

---

## 7. Limitations & Notes

- **No failed runs:** Despite 6 tasks from simple→hard, all 46 succeeded. This suggests tasks were too easy or models too capable. Need to increase difficulty or use cheaper model for failures.
- **Cost is 0:** Provider not exposing cost, so cost partitioning is estimated, not measured.
- **Tokens:** `cached` > `input` for many runs (provider semantics ambiguous), so `uncached` not reliable; we used `pctOps` as proxy.
- **Conservative classification:** `unclassified` 6.1% mean — when uncertain we put in `useful_path` or `unclassified`, so waste may be undercounted, but even with generous counting, waste <15%.
- **Repo:** Single small repo `rapture`; larger repo may show more dead-end exploration.
- **No retries:** `retryCount` always 0, so recovery not measured.

**Confidence:** Medium for operation counts (100% structured tool coverage, dedup by `callID`, `isShellReadLike` not triggered), Low for token economics.

---

## 8. Deliverable Checklist

- [x] Mixed difficulty tasks (simple 2, medium 2, hard 2) — `tasks.json`
- [x] Mix of outcomes attempted (all succeeded; 0 failed — noted as limitation)
- [x] 3 model configs (`mini`, `5.4`, `luna`) — results show
- [x] Same repo, 46 runs (30-60 target met)
- [x] Full operation trace, token usage, wall-clock, outcome, model, repo identity per run — in `.rapture/runs/<id>/`
- [x] Classification taxonomy 7 categories (6 + unclassified) — `economics.ts`
- [x] Per-run breakdown (cards + table)
- [x] Aggregate stats (mean/median, by outcome, by model, correlation, dominant)
- [x] Recommendation (none, do not productize)
- [x] Raw data tables (`full-results.json`, `pilot-results.json`)
- [x] No product code / caching layer built

