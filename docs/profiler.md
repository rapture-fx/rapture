# Rapture Agent Compute Profiler (Phase 0)

Local-first, deterministic profiler for OpenCode tasks. It measures repeated computation before any optimization is attempted.

## CLI

```
rapture profile opencode --task "Fix the auth refresh bug"
rapture profile opencode --task-file ./task.txt --agent build --model opencode/muse-spark-1.2-contributor-free
rapture profile opencode --task "hello" --no-task-text   # hash task instead of storing text

rapture runs list
rapture runs list --json
rapture runs show <run-id>
rapture runs show <run-id> --json

rapture analyze <run-id> [<run-id> ...]   # single or cross-run
rapture analyze --all
rapture analyze <run-id> --json

rapture experiment run <manifest.json> [--no-task-text]
```

## Trace Storage

Default: `.rapture/runs/<runId>/`

- `metadata.json` — versioned run metadata (timestamps, agent/model, git HEAD/tree, token usage, status)
- `raw.jsonl` — raw JSON events (one per line, seq + timestamp)
- `operations.jsonl` — normalized operations (opClass, identityKey, file/content hash, command, etc.)
- `trace.json` — combined metadata + operations (versioned)

Corrupted or incomplete runs do not affect other runs. Interrupted runs are marked `status: incomplete`.

## Operation Classes

`file_read`, `file_write`, `file_stat`, `directory_list`, `search`, `git`, `shell`, `test`, `build`, `install`, `network`, `agent_tool`, `unknown`

Raw event data is preserved alongside normalized `identityKey` for reproducible cross-run comparison.

## Privacy

- `authorization: Bearer ...`, `api_key=...`, `sk_...`, `ghp_...`, JWTs are redacted to `[REDACTED]`.
- Env keys containing `SECRET`, `PASSWORD`, `TOKEN`, `*_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, etc. are redacted.
- Raw provider API keys and auth headers are never persisted.
- Private chain-of-thought is not collected.
- All artifacts remain local; nothing is uploaded.
- Use `--no-task-text` to store only `taskHash` (sha256) instead of task text.

## Experiment Manifest

```json
{
  "version": 1,
  "agent": "opencode",
  "mode": "clean-reset",
  "repository": "/Users/wira/Documents/rapture/rapture",
  "runsDir": ".rapture/runs",
  "tasks": [
    { "id": "add-logging", "task": "Add logging to src/foo.ts", "repetitions": 2 },
    { "id": "fix-auth", "taskFile": "./tasks/fix-auth.txt" }
  ]
}
```

- `mode: clean-reset` — `git reset --hard HEAD && git clean -fd` before each task (isolation).
- `mode: evolving` — repository state accumulates across tasks (later experiments).
- `repetitions` — repeat same task N times (measures same-task overlap).
- `tasks` order is execution order.

See `experiments/manifest.example.json`.

## Analysis Metrics

Per-run: total/unique/repeated ops, repeat %, file reads / unique content reads / repeated unchanged reads, bytes read, shell commands + duplicates, searches + repeats, git/test/build counts, tool-call counts, token usage where available, potential deterministic reuse.

Cross-run: same-content file reads across runs, same command against equivalent tree, same search against equivalent tree, overlap by class, top repeated files/commands/searches/tests/builds, token/cost overlap (defensible only), `deterministicReuseCandidates` (strict mechanical rules), `unmeasurablePortion`.

Reports clearly separate **repeated** from **safely reusable**. No LLM classifier is used in the profiling path.

## Deterministic Reuse Rules

Only mechanically reproducible operations are candidates:

- Exact unchanged file/blob reads (`file_read` with content hash)
- Deterministic repository searches against identical tree (`search` with tree)
- Directory listings against identical tree
- Git queries against identical tree

Free-form model reasoning and arbitrary shell commands without input identity are never marked reusable.

## Exit Codes

- `0` — success (PASS or completed profile)
- `1` — scenario FAIL or explicit error
- `2` — usage / infrastructure error

## Limitations

See `docs/instrumentation-note.md` for observability gaps and why missing data is not estimated.
