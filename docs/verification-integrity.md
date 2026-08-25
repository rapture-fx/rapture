# Verification Integrity — Quickstart

Rapture verifies that a software change did not weaken the evidence used to accept that same change.

## One-liner

> **Did this change weaken what “green” means?**

## Local zero-config use

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm -r build
node apps/cli/dist/index.js verify
```

What happens:

- `--repo` defaults to the current Git repository. Outside a Git checkout, Rapture fails with `not a git repository: run rapture verify from inside a git checkout or supply --repo`.
- `--candidate` defaults to `HEAD`.
- `--base` is auto-detected: remote default branch (`origin/HEAD`) when discoverable, otherwise `origin/main` / `origin/master` / `main` / `master` via merge-base. If no trustworthy base can be determined, Rapture fails closed — supply `--base` explicitly. It never silently picks an arbitrary commit.

Explicit overrides still work exactly as before:

```sh
node apps/cli/dist/index.js verify --repo ./my-repo --base origin/main --candidate HEAD
node apps/cli/dist/index.js verify --repo ./my-repo --base abc123 --candidate def456 --json
```

Exit codes:

- `0` — `ACCEPT` — verification surface intact
- `1` — `WARN` — production changed without test evidence (non-blocking by default)
- `2` — `REJECT` — verification weakening detected
- `2`/`3` — configuration/usage errors (including base-resolution failure)

Human output always starts with `VERIFICATION INTEGRITY` and ends with `VERDICT: ACCEPT|WARN|REJECT`. Each `FAIL` line includes `[SEVERITY] kind: path — detail`.

## GitHub pull-request check

Smallest working workflow (`.github/workflows/rapture-verify.yml`):

```yaml
name: Rapture Verify
on: pull_request
jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/verify
        with:
          # base/head auto-resolved from PR context when omitted
          # mode: verify (default) or scan
          # warn-as-error: "true" to make WARN fail the check
```

What the action does:

- Resolves PR base SHA and head SHA from `github.event.pull_request` when on `pull_request` / `pull_request_target`; otherwise uses inputs or defaults.
- Runs the existing CLI/core verification path — no duplicated detectors.
- Writes a concise summary to the GitHub Actions Summary (`VERIFICATION INTEGRITY`, verdict, base/candidate SHAs, signal count, human report excerpt).
- `REJECT` always fails the check (exit 2). `WARN` fails only when `warn-as-error: "true"`. Default `WARN` is non-blocking; repositories opt in explicitly.

No Rapture cloud account is required. No repository contents, diffs, or source code are uploaded. No telemetry is emitted. Forked PRs are handled via the standard `pull_request` checkout; the action does not execute untrusted repository code beyond the existing judge/executor contract.

## Invariants

Per-repository policy lives in `.rapture/invariants.json` and is auto-loaded when present:

```json
{
  "schemaVersion": 1,
  "protectedPaths": ["validation/**", ".github/workflows/deploy.yml"],
  "testFilePatterns": ["**/*.test.ts"],
  "ignorePaths": ["generated/**"]
}
```

- `protectedPaths` — glob or exact path; violations become `protected_file_modified` (medium→high on sensitive paths).
- `testFilePatterns` — override default test-file heuristics for `assertions_removed` and `WARN` logic.
- `ignorePaths` — suppress signals/changes matching these globs.

Override: `rapture verify --invariants ./my-invariants.json`

## Structured JSON output

```sh
rapture verify --repo . --json > report.json
rapture verify --repo . --candidate HEAD --base main --json | jq .verdict
```

The JSON serializes the existing `VerificationIntegrityReport` deterministically (no second verdict model):

- `schemaVersion`, `verdict` (`ACCEPT`|`WARN`|`REJECT`), `baseRef` + `baseSha`, `candidateRef` + `candidateSha`, `filesChanged`, `signals[]` (each with `kind`, `path`, `detail`, severity via `signalSeverity`), `signalCounts`, `productionChangeWithoutTestEvidence`, `invariants` (`source`, `path`, `protectedPaths`, `ignorePaths`), `generatedAt`

Human-readable output remains the default.

## Product boundary

Rapture verifies **verification integrity** — whether the mechanisms that decide acceptance were weakened. It does not prove arbitrary semantic correctness of code, replace SAST, or review code via LLM. Repository contents remain inside the user's environment; verification runs locally or in the user's GitHub runner.

## Related

- `rapture scan` — window audit across commits (same invariants, same verdict model)
- `rapture trustmap` — which claims rest on agent-modifiable evidence
- `rapture keygen` / `rapture receipts-verify` — DSSE ed25519 receipts, offline-verifiable

