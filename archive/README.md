# archive/

Code from **closed product bets**. Nothing here is an active product direction,
a roadmap item, or a supported interface.

Each package below was built to test a specific hypothesis against real data.
Every hypothesis was answered — most of them "no". The verdicts, the evidence,
and the do-not-revive conditions are recorded in
[`docs/closed-bets.md`](../docs/closed-bets.md), which links to the full
experiment reports in `docs/`.

| Package | Bet | Verdict |
|---|---|---|
| `packages/profiler` | Agent compute is measurably wasteful in a way worth optimizing | `PHASE_0D_KILL` (0C `KILL_SIGNAL`) |
| `packages/change` | A canonical cross-vendor `Change` object is worth more than a Git SHA | `SOFTWARE_CHANGE_API_RETHINK` |
| `packages/production-change` | Runtime identity generalizes across deployment providers | `PRODUCTION_CHANGE_BLOCKED` (1 of 2 required real runtimes) |
| `packages/production-change` (deployment surface) | A canonical deploy/status/rollback API beats native provider CLIs | `DEPLOYMENT_API_KILL` |
| `packages/verification-surface` | Agent PRs measurably weaken verification | `VERIFICATION_SURFACE_KILL` (0% prevalence, n=50) |

## Why this is kept, not deleted

The code encodes the kill lessons. `production-change`'s deployment adapters are
the reason we know a canonical deploy API cannot model *where a service's source
lives*; `verification-surface`'s detector is the reason we know its precision is
undefined rather than high. Deleting the code would leave the reports asserting
conclusions with nothing to check them against.

## Status

These packages are still pnpm workspace members (see `pnpm-workspace.yaml`), so
they continue to build, typecheck, and run their tests. That is deliberate: it
keeps them honest and non-rotting, and it costs nothing. It is **not** a signal
that they are maintained.

- They are not exported from the `rapture` CLI. The CLI surface is
  `scenario list` and `run` only.
- No new adapters, detectors, providers, or commands should be added here.
- `packages/production-change/src/deployment/vercel.ts` runs `git checkout <sha>`
  in the repo root and mutates the live working tree. Do not invoke it casually.

Preserved, actively-maintained engineering lives in `packages/kernel` and
`packages/core`.
