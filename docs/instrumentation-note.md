# Instrumentation Note — Phase 0 Profiler

Date: 2026-08-29
Scope: Rapture Phase 0 Agent Compute Profiler for OpenCode

## Selected Mechanism

Least-invasive, local-first. No patching/forking of OpenCode.

1. **Primary**: `opencode run --format json` child-process spawn. The CLI is asked to run with `--format json` and the profiler captures stdout as newline-delimited JSON events. Each line is parsed as a raw event with sequence number and timestamp.

2. **Enrichment**: After the child exits, if a `sessionID` was observed in the JSON stream, the profiler queries the local OpenCode SQLite DB at `~/.local/share/opencode/opencode.db`:
   - `SELECT data FROM part WHERE session_id=? ORDER BY time_created` — fetches persisted tool calls (read, edit, write, bash, grep, glob, etc.) with input/output/status/time.
   - `SELECT tokens_input,... FROM session WHERE id=?` — fetches token/cost counters.
   - `SELECT model FROM session WHERE id=?` — fetches provider/model identifiers.

3. **Repository identity**: Before and after each run, the profiler runs `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git rev-parse --abbrev-ref HEAD`, and `git status --porcelain` via `execa`. This provides HEAD/tree/blob identity for cross-run comparison.

4. **Normalization**: Tool calls are mapped to stable operation classes (`file_read`, `file_write`, `directory_list`, `search`, `git`, `shell`, `test`, `build`, `install`, `agent_tool`, `unknown`) with deterministic identity keys including content hash or tree hash where applicable. Secret redaction is applied via regexes and env allow-list.

5. **Fallback**: If `opencode --version` or DB is unavailable, the trace still records wall-clock duration, exit code, and whatever raw JSON was emitted. Missing observability is reported as `<unavailable>` / `unmeasurable` rather than estimated.

## What Can Be Observed Reliably

- File reads/writes where OpenCode exposes `read`/`edit`/`write` tool activity (path + content snapshot).
- Search operations via `grep` tool (pattern, path).
- Directory listings via `read` on directories and `glob` tool (pattern).
- Shell commands via `bash` tool including classification into `git`, `test`, `build`, `install`, `shell` by deterministic regex (e.g., `^git`, `vitest|jest`, `pnpm build`).
- Git operations (as `bash` with `git` prefix) against a known tree.
- Token usage and model/provider when OpenCode persists them in the session DB (`tokens_input`, `tokens_output`, `tokens_cache_read`, `cost`).
- Repository HEAD/tree before/after, dirty state, wall-clock duration, exit code, opencode session ID.

## What Cannot Be Observed (Limitations)

- Private chain-of-thought / reasoning blocks are not collected (only `reasoning` token counts if exposed).
- Model input context composition details are not exposed by OpenCode; token counts are aggregate, not per-operation attributive, so repeated token cost can only be reported as unavailable or low confidence.
- File reads performed outside OpenCode's tool abstraction (e.g., direct LLM file access, or reads via shell `cat`) appear as generic `bash` commands, not `file_read` with content hash, unless the command classification captures them.
- Network operations are not separately observable; they are collapsed into `shell` or `unknown` unless an explicit tool exposes them.
- If no OpenCode DB is present (e.g., `opencode run` failure before session creation), only the JSON error event and git state are captured.
- Concurrent writes by the agent to the working tree between operation and `repoAfter` snapshot may cause tree identity to drift; per-operation tree is pinned to `repoBefore` tree for conservative repeat detection.
- Env secrets are redacted; raw env values are never persisted.

## Missing Gaps Must Not Be Silently Estimated

All derived metrics separate `unmeasurable`/`unknown` share. Cross-run analysis reports `unmeasurablePortion` and token confidence (`high`/`low`/`unmeasurable`). Estimated cost is only emitted when explicit pricing data is supplied (not implemented in Phase 0 — cost is shown only if provider returns it).

## Justification for Not Patching OpenCode

OpenCode's machine-readable output (`--format json`) plus its local SQLite journal already exposes sufficient structured data for Phase 0's repeat detection. Wrapping the child process adds <5ms overhead and preserves the agent's intended behavior. No OpenCode source modification is required.
