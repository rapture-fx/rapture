# Market Test Protocol — Prospective Retrospective

Run Rapture across your last 30 agent-authored PRs. For every `WARN`/`REJECT`, answer five questions. Source stays inside your environment — share only what you are comfortable sharing.

## One-command local run (no upload, no account)

```sh
# from your repository root
pnpm install --frozen-lockfile && pnpm -r build
./scripts/pr-retrospective.sh --limit 30 --repo . > retrospective.json
# or without the helper, per PR:
node apps/cli/dist/index.js verify --base <pr-base-sha> --candidate <pr-head-sha> --json
```

The helper reuses the existing CLI/core path (`runVerificationIntegrity`, `detectIntegritySignals`, `signalSeverity`) — no duplicated detectors, no LLM, no network in the verification path, no telemetry.

If you prefer PR context, the GitHub Action resolves base/head SHAs from `github.event.pull_request` automatically:

```yaml
- uses: ./.github/actions/verify
  # no base/head needed on pull_request — auto from PR context
```

## The five questions (per WARN/REJECT)

For each flagged PR, tell us:

1. Was this already suspicious to you?
2. Did your existing process catch it?
3. Would you have wanted this to block merge?
4. Did any finding surprise you?
5. Would you keep this check enabled?

## How to read the result

**Strongest signal — product evidence:**

```
Rapture REJECTS PR #184 → "we merged this and later regretted it"
→ existing review/CI missed it → team enables required check
```

**Useful but weak incremental value:**

```
12 issues → "yes, but we already knew all of these"
→ detector accurate, product not yet needed
```

**Noise:**

```
lots of WARN/REJECT → engineers disagree → no behavior change
→ Rapture is noise for this repo
```

## What to share back

- Verdict counts (how many of 30 were `ACCEPT`/`WARN`/`REJECT`)
- For each `WARN`/`REJECT`, your five answers (one line each is enough)
- Whether you would keep the check enabled, and under what policy (`warn-as-error: "true"` or not)

No source code, diffs, or reports need to leave your environment unless you choose to share them. The retrospective is the interview — harder to answer politely than "interesting."

## Exit semantics (for reference)

- `0` `ACCEPT` — verification surface intact
- `1` `WARN` — production changed without test evidence (non-blocking by default)
- `2` `REJECT` — verification weakening detected (always failing)
- `WARN` becomes blocking only with `warn-as-error: "true"`
