# Rapture doctor and real-experiment preflight

## Executive summary

Rapture now has a first-class `rapture doctor` command and a GitHub Actions
preflight-only path. They validate runtime, frozen experiment integrity, ledger-kit
fixture behavior, agent binary presence, and credential *presence* before any
task worker or paid inference starts.

A live doctor run in this environment is **BLOCKED** only on `AGENT_AUTH`
(`REAL_SCALE_2_CREDENTIALS_MISSING`). That is an infrastructure classification,
not a coding-agent performance result. Measurement definitions, the frozen
1-vs-2 × 3 design, and the six ledger-kit tasks were not changed.

## Git baseline

Recorded before this change:

| Field | Value |
| --- | --- |
| Branch | `cursor/repeated-real-agent-scaling-ca4d` |
| HEAD | `fc148bdcdd0e3f9a0277346bbad975dddb735502` |
| Message | Add a GitHub Actions path for the frozen Codex 1-vs-2 experiment. |
| Working tree | dirty with doctor/preflight implementation; clean after this commit |

## What changed

- Typed doctor result model, composable checks, JSON and human output, exit codes 0/2/3/4
- Credential probing through the existing adapter boundary (`probeCredentials`)
- Frozen-input SHA-256 sidecar `experiments/real-scale-2.integrity.json`
- `rapture doctor` CLI (`--config`, `--agent`, `--json`, `--write-dir`)
- GitHub Actions: doctor before `rapture run`; `preflight_only` input; job summary; artifact upload of `doctor.json` and `runner-fingerprint.json`
- No optimizer, dashboard, extra provider, fake-agent fallback, or measurement-definition change

## Doctor architecture

`runDoctor` in `@rapture/core` runs checks sequentially, aggregates
READY / WARNING / BLOCKED, and always sets `scalingConclusion: null`. Adapters
expose `probeCredentials(env)` so Codex vs fake auth rules stay on the adapter,
not in CLI glue. Secret *values* are never returned; only env var names and
method labels are recorded. Serialized doctor output is scanned against the
three supported credential env vars before write or print.

## Checks implemented

| ID | Required for frozen Codex | Notes |
| --- | --- | --- |
| `NODE_RUNTIME` | yes | `>=22`; warning if not pinned `22.14.0` |
| `PNPM_RUNTIME` | yes | version recorded |
| `GIT_RUNTIME` | yes | version recorded |
| `EXPERIMENT_CONFIG` | yes | frozen 1/2 × 3 semantics + integrity hashes |
| `TASK_INTEGRITY` | yes | IDs, validators, independence |
| `FIXTURE_INTEGRITY` | yes | create ledger-kit, baseline must fail validators |
| `REPOSITORY_STATE` | yes | exists, git, clean, HEAD resolves |
| `WORKTREE_STATE` | yes | no leaked `.worktrees`; create/remove probe |
| `AGENT_BINARY` | yes | Codex `--version` via adapter |
| `AGENT_AUTH` | yes | presence only; `REAL_SCALE_2_CREDENTIALS_MISSING` |
| `MODEL_CONFIG` | warning if unpinned | records provider-default fact; reasoning unpinned |
| `OUTPUT_PATH` | yes | creatable; not `/`, `/etc`, `~/.codex` |

Any required BLOCKED check makes the overall status BLOCKED.

## Exit-code contract

| Code | Meaning |
| --- | --- |
| 0 | READY or WARNING (required checks passed) |
| 2 | BLOCKED; experiment must not start |
| 3 | Invalid configuration or frozen experiment definition |
| 4 | Internal doctor failure |

`rapture run` configuration errors remain unchanged (CLI exit 2).

## Frozen experiment integrity checks

`computeFrozenIntegrity` hashes, in sorted path order:

- `experiments/real-scale-2.frozen.json`
- `fixtures/ledger-kit/tasks.json`
- `fixtures/ledger-kit/create.mjs`
- `fixtures/ledger-kit/package.json` and `tsconfig.json`
- all files under `fixtures/ledger-kit/src` and `validation`

The aggregate and per-file digests are stored in
`experiments/real-scale-2.integrity.json` and copied into `doctor.json`.
Mismatch on a claimed `real-scale-2` run is BLOCKED. No signing, attestation,
or remote verification was added. Regenerator: `node scripts/real-scale-2/write-integrity.mjs`.

## GitHub Actions preflight integration

`.github/workflows/real-scale-2-codex.yml` still uses one `ubuntu-24.04` runner
and `workflow_dispatch`. It now:

1. Installs and builds Rapture, then installs pinned Codex CLI
2. Runs `node scripts/real-scale-2/ci.mjs doctor` → `rapture doctor --agent codex`
3. Writes `doctor.json` / `runner-fingerprint.json` under `experiments/real-scale-2/`
4. Appends a concise table to the GitHub job summary
5. On the real path, maps `AGENT_AUTH` BLOCKED to `REAL_SCALE_2_CREDENTIALS_MISSING` and **does not** call `ci.mjs run`
6. Never passes `--agent fake`

## Preflight-only behavior

`preflight_only` (default false) runs quality checks (`biome`, `typecheck`, `test`),
doctor, and artifact upload. It does not authenticate Codex and does not invoke
`rapture run`. If the only BLOCKED check is `AGENT_AUTH`, the workflow treats that
as an expected blocker and the job succeeds. Any other BLOCKED check still fails
the job. Preflight artifacts are not an agent experiment and must not be read as
T(1)/T(2)/S(2)/E(2).

## Security review

- Supported credential names only: `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`
- Values never appear in doctor JSON, fingerprints, logs, or remediation text
- Codex login still uses stdin; argv never receives the secret
- `GITHUB_TOKEN` and related Actions tokens are stripped from the Rapture/Codex child env
- Doctor does not make network calls to validate a key
- Checkout uses `persist-credentials: false`

## Tests and quality gates

- 68 `@rapture/core` tests (15 doctor tests) and 13 CI-script tests
- Unit: aggregation, Node/Git, frozen config, missing/present binary, missing auth without leak, model reporting, output path, deterministic hashes, JSON schema, exit mapping
- Integration: fake READY environment, dirty repo, frozen config without inference, GitHub doctor argv never starts `run`
- Gates: `pnpm biome check .`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`

## Credential-missing demonstration

Executed locally after build, with empty Codex/OpenAI env vars:

```text
rapture doctor --config experiments/real-scale-2.frozen.json
status: BLOCKED
exit: 2
AGENT_AUTH details.code: REAL_SCALE_2_CREDENTIALS_MISSING
scalingConclusion: null
```

All other frozen checks passed, including fixture baseline rejection and Codex
binary detection. No secret material was present in `doctor.json`.

## Known limitations

- Doctor does not call `codex login status` (that would overlap authentication, not structural readiness)
- Unpinned model/reasoning is a WARNING, matching the frozen file (`agentModel: null`)
- Three repetitions remain a variance probe, not a significance test
- Preflight-only success with missing auth is not permission to claim scaling results

## What remains blocked

Authenticated Codex inference. The frozen 1-vs-2 × 3 experiment has still not
produced real T(1), T(2), S(2), or E(2).

## Exact next operational action

1. Set GitHub Environment `real-scale-2` secret `OPENAI_API_KEY` or `CODEX_API_KEY`, or `CODEX_ACCESS_TOKEN`
2. Dispatch **real-scale-2 Codex** with `preflight_only=false`
3. Confirm doctor is READY (or WARNING only for unpinned model)
4. Let the existing frozen `rapture run` execute; do not change workers, seed, tasks, or agent

## Branch

`cursor/repeated-real-agent-scaling-ca4d`

## HEAD

This commit on `cursor/repeated-real-agent-scaling-ca4d`.

## Working-tree status

Clean after the doctor/preflight commit.

## PR status

https://github.com/wiramahendra/rapture/pull/2 (updated on this branch)

## Decision

`DOCTOR_PASS`

Doctor, frozen-input integrity, tests, and GitHub preflight-only integration are
complete and correctly classify missing Codex authentication as
`REAL_SCALE_2_CREDENTIALS_MISSING` before any experiment execution. The next
action is still adding credentials and dispatching the frozen Codex run, not
inventing a substitute study.
