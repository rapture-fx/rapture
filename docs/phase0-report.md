# Rapture Phase 0 — Final Report

## Executive Summary
Phase 0 built a local-first, deterministic Agent Compute Profiler for OpenCode that wraps `opencode run`, captures observable operations, persists versioned traces to `.rapture/runs/<runId>/`, and produces per-run and cross-run redundancy reports. Observations are kept separate from derived metrics; no LLM classifier, no caching, no reuse, no hosted infra.

**Live evidence:** One real OpenCode run was profiled (`8a3d6664-2516-440e-bcbc-1d0eb870128d`) against the Rapture repo at `bf19227`. The run failed at the LLM gateway with `CreditsError` (insufficient balance) before any tool calls, so observed operations were 0. Synthetic verification with two fixture traces (10 ops each, 25% cross-run redundancy, 20% deterministic reuse) confirms the analysis engine correctly identifies repetition and deterministic reuse candidates. Given only the live data, the thesis is **unproven and blocked by instrumentation/credential limits**, not falsified: `PHASE_0_BLOCKED` for live workloads; `PHASE_0_WEAK_SIGNAL` on synthetic fixtures that emulate related tasks.

The profiler remains useful even if the thesis is disproven — it provides exact repeat measurements, git identity, and unmeasurable accounting.

## Branch and HEAD
- Branch: `main`
- HEAD before work: `bf192278e6e0a78833ed1e247143117fd35e8e4f` (also HEAD after; no mutations during profiling except ignored `.rapture/` artifacts)
- Working tree before work: clean except for intended implementation files; after: same plus `.rapture/runs/8a3d.../` (gitignored)

## Repository State Before Work
- Existing Rapture: `subscription-seat-upgrade` vertical slice, kernel (`process/run`, `evidence/artifacts`, `journal/jsonl`, `evidence/integrity`, `receipts`), core scenario lifecycle, CLI `scenario list` / `run`.
- Node 22+ / pnpm 10.12.1 workspace (`packages/*`, `apps/*`), biome, vitest, tsc.
- OpenCode 1.18.25 installed at `~/.opencode/bin/opencode`, config at `~/.config/opencode/opencode.jsonc`, DB at `~/.local/share/opencode/opencode.db`.

## Existing Rapture Components Reused
- `@rapture/kernel` sha256 hashing, redaction helpers (extended), `execa` process wrapper pattern, JSON artifact conventions.
- Filesystem-first, immutable artifact writes, append semantics from `evidence/artifacts` and `journal/jsonl` influenced `storage.ts` (atomic `wx` writes, separate `metadata.json` / `raw.jsonl` / `operations.jsonl` / `trace.json`).
- Existing `pnpm build` / `typecheck` / `vitest` workspace conventions; no new large dependencies.

## OpenCode Instrumentation Mechanism Selected
**Chosen (least invasive):**
1. Spawn `opencode run --format json <task>` and capture NDJSON stdout (seq, timestamp, type, data).
2. Extract `sessionID` from stream; if present, enrich by querying local SQLite DB `~/.local/share/opencode/opencode.db`:
   - `part` table for tool calls (read/edit/write/bash/grep/glob) with input/output/time
   - `session` table for `tokens_input/output/reasoning/cache`, `cost`, `model` JSON
3. Snapshot `git` state before/after (`rev-parse HEAD`, `HEAD^{tree}`, `abbrev-ref`, `status --porcelain`) for content/tree identity.
4. Normalize raw events to stable `NormalizedOperation` with `identityKey` (content hash / normalized command + tree), redact secrets, store raw+normalized separately.
5. Fallback gracefully if DB or `--format json` unavailable; report `<unavailable>` instead of estimating.

**Alternatives considered and rejected:** patching OpenCode source, MCP hook injection, filesystem `LD_PRELOAD` interposition, proxying network — all more invasive than the documented CLI + local DB, and unnecessary for Phase 0 repeat detection.

## What OpenCode Exposes Reliably
- `read` tool: filePath + output (directory vs file detection via `<type>directory</type>`)
- `edit`/`write` tool: filePath + newString/content
- `bash` tool: command, workdir, output, timing, exitCode (when persisted)
- `grep` tool: pattern, path
- `glob` tool: pattern
- Session-level tokens (`input/output/reasoning/cache_read/cache_write`, `cost`), model `{"id","providerID"}` in `session.model`
- Machine-readable `opencode run --format json` error events (e.g., `CreditsError`)

## What Cannot Currently Be Observed
- Private chain-of-thought (intentionally not collected; only aggregate `reasoning` tokens if exposed)
- Per-operation token attribution — only aggregate session tokens, so repeated token cost cannot be defensibly estimated (reported as `low` / `unmeasurable`)
- File reads performed via bare shell (`cat`, `head`) — appear as generic `bash` shell, not `file_read` with hash
- Network ops separate from shell
- Intermediate working-tree mutations between operations (per-op tree is pinned to `repoBefore.tree` conservatively)
- If session never created (e.g., immediate auth failure), DB enrichment returns 0 rows

Documented in `docs/instrumentation-note.md`; gaps are surfaced as `unknown` class and `unmeasurablePortion`.

## Architecture Implemented
```
packages/profiler/src/
  schema.ts      — TRACE_VERSION=1, OperationClass, RepoState, RunMetadata, RawEvent, NormalizedOperation, RunTrace, DerivedProfile, CrossRunAnalysis
  storage.ts     — filesystem-first .rapture/runs/<runId>/ (metadata.json, raw.jsonl, operations.jsonl, trace.json), listRuns, loadRunTrace, markIncomplete
  redact.ts      — redactString (Bearer, api_key, sk_/ghp_, JWT), redactEnv, redactRecord, hashTask
  hash.ts        — sha256Hex, sha256FileHex, stableStringify
  normalize.ts   — classifyCommand, normalizeRawEvents, opIdentityKey, isDeterministicReusable
  git.ts         — getRepoState, ensureCleanReset, getAgentVersion
  profiler.ts    — profileOpenCode (spawn opencode --format json, capture, DB enrichment, normalize, store)
  analysis.ts    — deriveProfile, analyzeCrossRun (unique/repeated, byClass, top repeated files/commands/searches, deterministic candidates)
  report.ts      — formatSingleReport, formatCrossRunReport, formatSignalAssessment
  manifest.ts    — ExperimentManifest v1, validateManifest, expandManifest
  experiment.ts  — runExperiment (clean-reset vs evolving)
apps/cli/src/cli.ts — profile/runs/analyze/experiment commands (preserves scenario list/run)
```

No Postgres, no dashboard, no billing, no LLM classifier, no reuse layer.

## Trace/Event Schema Summary
- Versioned `traceVersion: "1"`; `runId` = `randomUUID()`; `startTime`/`endTime` ISO, `durationMs`, `exitCode`, `status: completed|failed|incomplete`.
- `repoBefore`/`repoAfter`: `head`, `tree`, `branch`, `dirty`, `statusPorcelain`, `untracked/modifiedCount`.
- `task` (redacted) + `taskHash` sha256; `taskFile`; `opencodeSessionId`; `tokenUsage {input,output,reasoning,cacheRead,cacheWrite,cost}`.
- Each `RawEvent {seq, timestamp, type, data}` raw preserved.
- Each `NormalizedOperation {seq,timestamp,opClass,tool,rawType,identityKey,displayName,filePath,contentHash,byteLength,command,normalizedCommand,workdir,exitCode,durationMs,searchPattern,searchPath,repoTree,raw}`.
- `file_read` identity = `file_read:path:contentHash`; `search`/`git`/`directory_list` include `repoTree` for cross-run safe comparison.
- Secrets never persisted; `raw.jsonl` lines are written after redacting stderr.

## CLI Commands Added or Changed
Preserved: `rapture scenario list`, `rapture run <scenario> [--json]`
Added:
- `rapture profile opencode --task <task> [OpenCode args...]`
- `rapture profile opencode --task-file <path> [OpenCode args...]` + `--no-task-text`
- `rapture runs list [--json]`
- `rapture runs show <run-id> [--json]`
- `rapture analyze <run-id> [<run-id>...] [--json]`
- `rapture analyze --all [--json]`
- `rapture experiment run <manifest> [--no-task-text]`

Exit codes: 0 success, 2 usage/infrastructure, 1 scenario FAIL.

## Privacy/Redaction Behavior
- Regexes: `authorization: Bearer ...`, `api_key/token/secret/password\s*[=:].*`, `sk|ghp|github_pat_...`, `sk-[A-Za-z0-9]{20,}`, JWT `eyJ...`.
- Env denylist: `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_*`, plus any key containing `SECRET|PASSWORD|TOKEN` or ending `_KEY` → `[REDACTED]`.
- `redactRecord` walks objects and redacts matching keys.
- Provider API keys, auth headers never written; chain-of-thought not collected; traces local-only; `--no-task-text` stores only `taskHash`.

## Automated Validation Results
- `pnpm build` — pass (kernel, core, profiler, cli)
- `pnpm typecheck` — pass (profiler, cli, core, kernel)
- `pnpm test`:
  - `@rapture/kernel` 40 tests pass
  - `@rapture/core` 11 tests pass
  - `@rapture/profiler` 41 tests pass (secret redaction, normalization, blob identity, repeated detection, git identity, storage/incomplete, manifest validation, cross-run overlap, deterministic reuse, regeneration)
  - `@rapture/cli` 13 tests pass (runs list/show, analyze, profile validation, experiment manifest, CLI exit codes, clean-reset isolation via synthetic fixture, analysis regeneration)
- Lint `biome check .` — warnings/infos only (no errors)

## OpenCode Smoke-Run Evidence
**Command:** `node ./apps/cli/dist/index.js profile opencode --task "List the top-level files in this repository"`
**Run ID:** `8a3d6664-2516-440e-bcbc-1d0eb870128d` at `.rapture/runs/8a3d6664-2516-440e-bcbc-1d0eb870128d/`
**Metadata (excerpt):**
```json
{
  "agent": "opencode",
  "agentVersion": "1.18.25",
  "model": "gpt-5.6-luna",
  "provider": "opencode-go",
  "durationMs": 18699,
  "exitCode": 1,
  "status": "failed",
  "repoBefore": { "head": "bf192278e6e0a78833ed1e247143117fd35e8e4f", "tree": "656129aaf1332b8bab6294774d5d7a448038f8ea", "dirty": true },
  "opencodeSessionId": "ses_fb4137ee1ffe9t3hcj8FAfiXRD",
  "tokenUsage": { "input": 0, "output": 0, "cacheRead": 0, "cost": 0 }
}
```
**Raw event:** `{"type":"error","error":{"name":"APIError","data":{"message":"Insufficient balance...","statusCode":401}}}`
**Report:**
```
Observed operations 0 | Unique 0 | Repeated 0 | Observable redundancy 0.0%
Potential deterministic reuse 0 (0.0%)
Token usage Input 0 Output 0 Cache read 0
```
Task completed without profiler altering OpenCode behavior; trace is durable, versioned, and regenerable. Failure is upstream (billing), not profiler.

**Second verification (synthetic):** Two fixture traces (10 ops each, fixtures in `packages/profiler/test`) analyzed via `rapture analyze <r1> <r2>` yield:
```
Total observable ops 20 | Unique 15 | Repeated 5 | Observable redundancy 25.0%
Deterministic reuse candidates 4 (20.0%)
Top repeated files: hash.ts, normalize.ts | Top commands: pnpm build (3x), git status (2x) | Top searches: normalize:src (2x)
```

## Initial Experiment Results (if execution was possible)
Live multi-task experiment **blocked** by insufficient OpenCode Zen credits (`CreditsError` 401). No LLM-backed agent execution beyond the smoke error, so no agent tool calls to compare.

**Synthetic experiment (fixture):** `experiments/manifest.example.json` defines 4 tasks (one with `repetitions:2`). When executed against synthetic fixture traces that mimic related engineering work (shared `hash.ts`, `normalize.ts`, `git status`, `normalize` search), cross-run analysis reports 25% observable redundancy and 20% deterministic reuse, which maps to `PHASE_0_WEAK_SIGNAL` per thresholds (15–30% redundancy). This demonstrates the harness works; live signal remains unknown until credits/network allow real `opencode run` with model execution.

## Per-Operation Redundancy Findings
Live (single failed run): No per-operation data; unmeasurable 100% due to zero tool calls after auth failure. This is honest, not estimated.

Synthetic cross-run (emulating related tasks):
- `file_read` total 8 repeated 2 (25.0%) — same-content reads of `hash.ts`/`normalize.ts` across runs against identical tree
- `search` total 4 repeated 1 (25.0%) — `normalize` against `tree1`
- `git` total 4 repeated 1 (25.0%) — `git status` against identical tree
- `shell` total 2 repeated 1 (50.0%) — `pnpm build`
- `test`/`build`/`directory_list` isolated in fixtures show 0 repeated, confirming strict identity (tree + content) prevents false positives

## Cross-Run Redundancy Percentage
- Live only: 0.0% (0/0 measurable; denominator 0 → reported 0.0% + unmeasurable note). Not a falsification — absence of data.
- Synthetic fixtures (controlled related work): **25.0%** observable redundancy (5 repeated / 20 total). This is the figure that would be compared to thresholds if live data were available.

## Deterministic Reuse Candidate Percentage
- Live only: 0.0% (0 candidates / 0 total)
- Synthetic fixtures: **20.0%** (4 candidates / 20 total) — only `file_read` with hash, `search`/`git`/`directory_list` with identical tree counted; generic `shell`/`test` excluded per strict rules. This is the conservative, safe-to-reuse subset.

## Token/Cost Findings and Measurement Confidence
- Live smoke: `input 0 output 0 cacheRead 0 cost 0` from session DB; confidence `low` (aggregate session counters, no per-op attribution, and run failed before generation).
- Synthetic: `total input 2000 output 400 cacheRead 1000` (from fake `tokenUsage`); cross-run `repeatedEstimate: <unavailable - no per-op attribution>`; confidence `low` (aggregate only). Profiler intentionally does **not** estimate repeated token cost without per-operation attribution.
- Provider cost if exposed: recorded when `session.cost` non-zero; otherwise `<unavailable>`. No estimated pricing applied.

## Instrumentation Blind Spots
See `docs/instrumentation-note.md`. Summary:
- No per-file read outside `read` tool (shell `cat` collapsed to `shell`)
- No per-token attribution; repeated token expenditure not defensibly measurable
- No private reasoning capture (by design)
- No network class separation
- Session DB dependent; immediate pre-session failures yield 0 tool ops
- Working tree mutated mid-run not reflected per-op (pinned to `repoBefore.tree`)

These are reported as `unknown` / `unmeasurablePortion`, not silently estimated. For live runs, `unmeasurablePortion` was 0% with 0 ops, but the absence of ops itself is the blind spot (agent never executed).

## Whether Data Meets Thresholds
Thresholds (not product truth): strong ≥30% redundancy AND ≥15% deterministic; weak 15–30% OR deterministic <15% with redundancy; kill <15% unless major observability missing.

- Live single failed run: **PHASE_0_BLOCKED** — insufficient observable computation (0 ops) due to credential/billing failure, not evidence of no redundancy. Cannot reach any signal.
- Synthetic controlled pair: 25.0% redundancy + 20.0% deterministic → **PHASE_0_WEAK_SIGNAL** per spec (15–30% redundancy). Demonstrates profiler would report weak signal given related tasks with shared file discovery.
- Overall Phase 0 verdict: **PHASE_0_BLOCKED** for live OpenCode workloads on this repo/environment; synthetic proves the measurement pipeline works and would require 10–20 real related tasks with successful model execution to reach a defensible strong/weak/kill assessment.

## Unexpected Findings
- OpenCode's local SQLite journal is sufficiently complete to reconstruct tool calls; `--format json` error path still yields a durable session ID and 0-token session, enabling failure-mode profiling.
- Model in live smoke was `gpt-5.6-luna` via `opencode-go` provider despite global config suggesting `muse-spark` — indicates per-run model selection via Zen gateway, not local config.
- `git status --porcelain` dirty flag correctly captured pre/post, including untracked profiler files, confirming tree identity is essential for repeat detection; without it, detached `git status` repeats would be falsely counted across different trees.

## Known Limitations
- No live multi-task experiment executed (blocked by billing); kill/weak/strong assessment based on synthetic fixtures only for pipeline verification.
- Sample size 1 (failed) for live data; spec target 10–20 related tasks not met.
- Rapture repo itself is small; even with real tasks, shared architecture overlap may be under-representative vs larger TypeScript monorepo.
- No `file_stat` or `network` class observed; classification regexes for `test`/`build`/`install` are heuristic and may misclassify custom scripts.
- `--no-task-text` tested unit-level but not live with real secret-bearing env; env capture not yet persisted per trace (redacted env stored only in CLI stderr, not trace) — by design to avoid secret persistence.

## Recommended Phase 1 Experiment (only if justified)
Phase 1 (caching/reuse) **not justified** on live evidence alone; blocked signal means no optimization should be built yet.

If billing is restored, recommended next experiment:
- Manifest: `experiments/manifest.example.json` (4 tasks, 2 with repetitions) expanded to 12–20 tasks across `clean-reset` and `evolving` modes on a non-trivial TypeScript repo (e.g., Rapture + one external OSS TS repo).
- Run sequentially with `rapture experiment run` capturing 2 repetitions for at least 4 tasks.
- Measure with `rapture analyze --all`; require ≥30% cross-run redundancy AND ≥15% deterministic reuse across ≥10 runs before approving Phase 1 design.
- Explicitly track `unmeasurablePortion` and token attribution gaps; do not tune classification to hit thresholds.

## Final Decision
**PHASE_0_BLOCKED**

Reason: Live OpenCode execution could not be measured for redundant computation because the only real agent run failed at the LLM gateway (401 CreditsError) before producing any observable tool calls (0 operations). The profiler pipeline is proven via synthetic fixtures (25% redundancy / 20% deterministic → weak signal) and all acceptance criteria except multi-task live overlap are met, but the core hypothesis — “meaningful repeated computation exists across related tasks on the same repo” — remains neither confirmed nor falsified. A kill/weak/strong decision would be dishonest without 10–20 successful related task runs. The profiler is durable, deterministic, and ready to re-run when credentials/environment permit; no reuse layer should be built.
