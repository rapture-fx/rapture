# Rapture

Rapture is performance engineering for autonomous software factories. It measures how efficiently
coding-agent fleets turn compute into independently validated, integrated software. It is a
local-first research CLI—not an agent launcher, command center, memory product, code reviewer, or
dashboard.

The research question is straightforward: as worker concurrency rises from 1 to 2 to 4 and beyond,
where does useful engineering throughput stop scaling, why, and what integration or future rework
does that concurrency create?

## What V0 measures

- accepted tasks per wall-clock hour
- speedup relative to the one-worker baseline
- parallel efficiency: `T(N) / (N * T(1))`
- median and p95 task duration
- validation and integration failure rates
- duplicate observable commands, test invocations, and build invocations
- tokens and provider cost per accepted task only when an adapter actually reports them

Rapture does not treat session count, process exit code, generated lines, natural-language success
claims, or PR count as accepted engineering output. In V0, task acceptance requires every explicit
deterministic validation command to pass. When integration is requested, throughput counts validated
tasks only if the combined patches and post-integration validation also pass.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Git
- Codex CLI only for an explicitly selected real-agent run

## Deterministic fixture experiment

Normal tests and the fixture use no model credentials or paid inference.

```sh
pnpm install
pnpm build
node fixtures/create-fixture.mjs fixtures/repository
node apps/cli/dist/index.js validate --tasks fixtures/tasks.json
node apps/cli/dist/index.js run \
  --repo fixtures/repository \
  --tasks fixtures/tasks.json \
  --workers 1,2,4 \
  --agent fake \
  --output runs \
  --integration \
  --integration-validation "node -e \"Promise.all([import('./add.mjs'), import('./multiply.mjs'), import('./divide.mjs'), import('./modulo.mjs')])\""
```

The built package also exposes the `rapture` binary when linked or installed. The four CLI commands
are:

```sh
rapture validate --tasks ./tasks.json
rapture run --repo ./fixture --tasks ./tasks.json --workers 1,2 --repetitions 3 --seed 20260817 --agent fake --output ./runs
rapture report ./runs/<experiment-id>
rapture inspect ./runs/<experiment-id>
```

`--repetitions` defaults to 1. `--seed` defaults to 0. The same repetition index always receives the
same seeded task order at every worker count. Add `--json` to `run`, `report`, or `inspect` for
machine-readable output. `report` re-derives trial and worker metrics from `events.jsonl`; it does
not rerun agents or overwrite raw artifacts.

## Task definition

```json
{
  "tasks": [
    {
      "id": "task-001",
      "description": "Implement the requested repository change.",
      "baseCommit": "HEAD",
      "validation": ["pnpm test -- feature.test.ts"],
      "timeoutSeconds": 900,
      "independent": true,
      "dependsOn": []
    }
  ]
}
```

Task IDs must be unique. Dependencies must exist and be acyclic. V0 validates dependency graphs but
executes only independent tasks; dependent execution fails closed instead of silently changing the
experiment. Validation commands are trusted experiment inputs, parsed into argv, and executed without
a shell. The target repository must be clean because isolated worktrees are created from recorded commits;
Rapture refuses to silently omit uncommitted target state.

## Real-agent opt-in

Real-agent execution never runs during tests or CI. If the local Codex CLI is installed and
authenticated, use a tiny bounded experiment:

```sh
rapture run \
  --repo fixtures/repository \
  --tasks experiments/codex-smoke.tasks.json \
  --workers 1 \
  --agent codex \
  --output runs
```

The first non-trivial real-agent suite is `fixtures/ledger-kit`: six independent TypeScript tasks with
validators stored beside the task file. Create a clean Git copy, then run fake-agent preflight or an
explicit Codex experiment:

```sh
node fixtures/ledger-kit/create.mjs /tmp/ledger-kit
rapture run \
  --repo /tmp/ledger-kit \
  --tasks fixtures/ledger-kit/tasks.json \
  --workers 1,2 \
  --repetitions 3 \
  --seed 20260817 \
  --agent fake \
  --output runs
```

The adapter tells Codex not to push, open PRs, deploy, or access secrets, and gives it a dedicated Git
worktree. A Git worktree is an isolation boundary for repository state, not a complete operating-system
sandbox; run real agents only against repositories and environments you are willing to expose to that
local process. See [docs/real-scale-2-report.md](docs/real-scale-2-report.md) for the first 1-vs-2
attempt and its infrastructure block.

## Artifact layout

Each experiment contains immutable `manifest.json`, append-only `events.jsonl`, final `outcome.json`,
and one `trials/<trial-id>/` directory per worker-count/repetition pair. Each trial stores
`trial.json`, `trial-outcome.json`, and `runs/<run-id>/` artifacts. Run artifacts include separate
redacted stdout and stderr logs, validation evidence, a Git patch, content hashes, phase timings, and
`result.json`. Interrupted experiments retain whatever events and run artifacts were durably written
before interruption.

See [docs/research-method.md](docs/research-method.md) for methodology and validity limits.
