# Rapture

Rapture is performance engineering for autonomous software factories. It measures how efficiently
coding-agent fleets turn compute into independently validated, integrated software. It is a
local-first research CLI — and now a **verification-integrity toolkit** for the second half of
agent reliability: *not* "did it execute?" but **"can we trust what passing means after this change?"**

Two questions, one system:

- **Scaling research:** as worker concurrency rises 1→2→4+, where does useful throughput stop scaling and why?
- **Verification integrity:** did the change weaken the evidence (tests, CI, coverage, validators) that judges it?

> One-liner: **Rapture makes an autonomous agent's claim of "done" independently provable.**

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

## How it works

```
git diff (base..candidate)
        ↓
  10 structural detectors: deleted tests, skip markers, assertion drops,
  CI workflow changes, coverage/config drift, exit-code suppression,
  lint/type suppression, empty catches, strictness loosening,
  protected-path violations (via .rapture/invariants.json)
        ↓
  severity (critical/high/medium) + per-commit attribution
        ↓
  VERDICT: ACCEPT / WARN / REJECT  →  optional DSSE ed25519 receipt (offline-verifiable)
```

Complementary to AI reviewers (probabilistic opinions) and static analysis (code rules). Rapture checks **the checker**.

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

### Verification integrity — quick try (no agent needed)

```sh
# single change
node apps/cli/dist/index.js verify --repo . --base origin/main --candidate HEAD

# window audit with trust map + severity
node apps/cli/dist/index.js scan --repo . --base v1.0.0 --head HEAD --out audit.md

# trust map at a ref
node apps/cli/dist/index.js trustmap --repo . --ref HEAD

# signed, offline-verifiable
node apps/cli/dist/index.js keygen --dir ./keys
node apps/cli/dist/index.js scan --repo . --base v1.0.0 --head HEAD \
  --signing-key ./keys/rapture-signing-key.pem --receipt-out audit-receipt.json
node apps/cli/dist/index.js receipts-verify --receipt audit-receipt.json --key ./keys/rapture-signing-pub.pem

# per-repo invariant pack (auto-loaded from .rapture/invariants.json)
cat fixtures/invariants.example.json
```

### Install / Test / Adopt

**Install (today, private):**

```sh
git clone <rapture> && cd rapture
pnpm install && pnpm -r build
# binary is at apps/cli/dist/index.js ; alias it:
alias rapture="node $PWD/apps/cli/dist/index.js"
```

Publishing to npm (`@rapture/cli`, `@rapture/kernel`) is one PR away — gated on first paying audit.

**Test:**

```sh
pnpm test          # kernel 72/72 + core 226 passing (+4 known Node-v20 env failures)
pnpm check         # Biome
pnpm -r build && pnpm --filter @rapture/cli typecheck
```

Requires Node ≥22. On Node 20, `fixtures/ledger-kit` validators (`--experimental-strip-types`) fail.

**Adopt (free → paid):**

1. Developer reflex: `rapture verify` in a pre-merge hook (free, 2s)
2. Platform audit: `rapture scan` on a real window → markdown + signed receipt (fixed-fee service)
3. Enforcement: GitHub Action posting checks (`.github/actions/verify` — see below)
4. Embed: `@rapture/kernel` in agent tooling (commercial tier later)

The built package also exposes the `rapture` binary when linked or installed. The CLI commands are:

```sh
rapture validate --tasks ./tasks.json
rapture doctor --config experiments/real-scale-2.frozen.json --json
rapture run --repo ./fixture --tasks ./tasks.json --workers 1,2 --repetitions 3 --seed 20260817 --agent fake --output ./runs
rapture report ./runs/<experiment-id>
rapture inspect ./runs/<experiment-id>
```

`rapture doctor` inspects whether the current environment can execute an experiment. It never starts
task workers or paid inference. `--write-dir` persists `doctor.json` and `runner-fingerprint.json`.
Doctor exit `0` means required checks passed (warnings allowed), `2` means the environment is blocked,
`3` means the experiment definition is invalid, and `4` is an internal doctor failure.

`--repetitions` defaults to 1. `--seed` defaults to 0. The same repetition index always receives the
same seeded task order at every worker count. Add `--json` to `run`, `report`, `inspect`, or `doctor`
for machine-readable output. `report` re-derives trial and worker metrics from `events.jsonl`; it does
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

## GitHub Actions (frozen Codex 1-vs-2)

The frozen real-agent matrix runs on a single GitHub-hosted `ubuntu-24.04` runner via
`.github/workflows/real-scale-2-codex.yml`. It is `workflow_dispatch` only so pull requests cannot
spend Codex quota or read the secrets.

1. Create the GitHub Environment `real-scale-2` (or use repository secrets).
2. Set `OPENAI_API_KEY` or `CODEX_API_KEY`, or `CODEX_ACCESS_TOKEN`.
3. Dispatch **real-scale-2 Codex**. Use `preflight_only=true` to run doctor, fixture probes, and fingerprinting without Codex inference.
4. Download the `real-scale-2-<run-id>` artifact. It includes `doctor.json` and `runner-fingerprint.json`.

`rapture doctor` runs before `rapture run`. If secrets are missing on the real path, the job fails with
`REAL_SCALE_2_CREDENTIALS_MISSING` and never substitutes `--agent fake`. Preflight-only mode records
that same blocker as an expected diagnostic and does not start inference. Toolchain pins are Node
`22.14.0`, pnpm `10.12.1`, and `@openai/codex@0.147.0`. The Rapture command remains
`--workers 1,2 --repetitions 3 --seed 20260817 --agent codex`. Do not pool GitHub-hosted results
with other environment fingerprints.

## Artifact layout

Each experiment contains immutable `manifest.json`, append-only `events.jsonl`, final `outcome.json`,
and one `trials/<trial-id>/` directory per worker-count/repetition pair. Each trial stores
`trial.json`, `trial-outcome.json`, and `runs/<run-id>/` artifacts. Run artifacts include separate
redacted stdout and stderr logs, validation evidence, a Git patch, content hashes, phase timings, and
`result.json`. Interrupted experiments retain whatever events and run artifacts were durably written
before interruption.

See [docs/research-method.md](docs/research-method.md) for methodology and validity limits.
