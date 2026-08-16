# V0 engineering report

## Executive summary

The V0 engineering foundation is implemented for a single public operation,
`verifyEmail()`. Three real provider adapters normalize documented Hunter,
ZeroBounce, and Kickbox response shapes into an uncertainty-preserving contract.
Exact economics, deterministic calibration-derived selection, constrained
fallback, write-ahead attempt audit records, a privacy-safe frozen workload, and
a self-tested scorer are present.

No live provider credentials, actual account economics, or complete owned
ground-truth dataset were available on 2026-08-16. Therefore there are no live
provider or router results and the only honest decision is
`BLOCKED_LIVE_EVAL`.

## Branch and HEAD

Work is on `feat/v0-operation-router`. Exact HEAD is reported by the completion
handoff because a commit cannot contain its own hash. Nothing was pushed or
deployed.

## Architecture actually implemented

- Plain TypeScript domain primitives define exact micro-USD, the operation
  contract, provider outcomes, execution records, and evaluation.
- Effect is limited to HTTP, configuration, persistence, provider failures, and
  orchestration.
- Effect Schema validates caller wire data, provider JSON, and persisted audit
  records.
- Three fixed-host adapters contain provider-specific translation.
- A pure policy derives deterministic provider order from calibration cost per
  useful outcome using integer cross multiplication.
- The router filters eligibility, writes a durable attempt intent, executes once,
  records completion, and falls back only after failure or uncertainty within
  the remaining budget.
- A serialized, fsynced JSONL store is the minimal local durable measurement
  store. It persists no raw provider response.

## Public API

The package exports `verifyEmail(router, request)`, router construction, exact
money construction, provider adapters, measured profile types, and selection
derivation. The request contains only email, `safe_to_send`, and economic,
latency, or categorical-confidence constraints. No provider-specific input and
no `procure()` abstraction exists.

## OperationContract design

The result uses `send | do_not_send | uncertain` and categorical confidence
`high | medium | low | unknown`. Evidence separately represents syntax, domain,
mailbox, catch-all, disposable, and role-based state. Unknown and unsupported
semantics remain unknown/null. Provider scores are not treated as calibrated
probabilities.

## Provider adapters and mapping table

The exhaustive mapping and discarded-field rationale are in
`docs/provider-mappings.md`.

| Provider   | Explicit endpoint host | Decisive states                              | Uncertain states                        |
| ---------- | ---------------------- | -------------------------------------------- | --------------------------------------- |
| Hunter     | `api.hunter.io`        | valid/webmail, invalid, disposable           | accept-all, unknown, new states         |
| ZeroBounce | `api.zerobounce.net`   | valid, invalid, spamtrap, abuse, do-not-mail | catch-all, unknown, new states          |
| Kickbox    | `api.kickbox.com`      | deliverable, undeliverable                   | risky, unknown, unsuccessful/new states |

These are implemented and fixture-tested adapters, not live-credential proof.

## Current pricing/economic configuration used

No price was configured or used. Public/list pricing was deliberately not
substituted for actual account economics.

| Provider   | Required credential  | Required effective marginal cost | Current value |
| ---------- | -------------------- | -------------------------------- | ------------- |
| Hunter     | `HUNTER_API_KEY`     | `HUNTER_COST_MICRO_USD`          | absent        |
| ZeroBounce | `ZEROBOUNCE_API_KEY` | `ZEROBOUNCE_COST_MICRO_USD`      | absent        |
| Kickbox    | `KICKBOX_API_KEY`    | `KICKBOX_COST_MICRO_USD`         | absent        |

## Dataset construction

The committed privacy-safe manifest has 120 cases across all eight required
segments. Its SHA-256 is
`8de1a8243c2d92cf8dee1ecff2dc01f77ac6dbf6d8dd2c67ec7febd5d79352f5`.
Reserved domains and synthetic local parts avoid arbitrary personal addresses.
Seventy-five cases are intentionally marked live-ineligible until replaced with
addresses and domains actually controlled by the experiment owner.

## Calibration versus held-out evaluation split

Each segment is assigned 40% calibration and 60% held-out before measurement:
48 calibration cases and 72 held-out cases. Selection can be derived only from
calibration counts. The held-out split is not available for tuning.

## Fixed-provider results

| Condition        | Live requests |        Spend | Useful/correct outcomes |      Latency |
| ---------------- | ------------: | -----------: | ----------------------: | -----------: |
| FIXED_PROVIDER_A |             0 | not measured |            not measured | not measured |
| FIXED_PROVIDER_B |             0 | not measured |            not measured | not measured |
| FIXED_PROVIDER_C |             0 | not measured |            not measured | not measured |

## OperationRouter results

| Condition        | Live requests |        Spend | Useful/correct outcomes |     Fallback |      Latency |
| ---------------- | ------------: | -----------: | ----------------------: | -----------: | -----------: |
| OPERATION_ROUTER |             0 | not measured |            not measured | not measured | not measured |

## Cost / quality / coverage / latency comparison

No comparison exists. Unit tests prove arithmetic and orchestration behavior,
not economics, quality, coverage, or network latency.

## Canonical abstraction leakage analysis

| Case                             | Caller escape hatch required | Current evidence      |
| -------------------------------- | ---------------------------: | --------------------- |
| Documented mapped fixture states |                           no | contract tests only   |
| Unrecognized provider state      |        no; becomes uncertain | regression tests only |
| Live meaningful provider states  |                      unknown | blocked               |

Mapping coverage and the 5% leakage criterion require live response-state
frequencies; source-code coverage cannot substitute for that measurement.

## Provider disagreement findings

None. No shared live workload was submitted to providers.

## Fallback findings

Deterministic tests establish that fallback occurs after uncertainty, respects
remaining exact budget, records every attempt and relationship, and returns
uncertainty when fallback is unaffordable. They do not establish live fallback
frequency, billing behavior, or economic value.

## Security review

- Credentials are environment-only, absent from errors, records, fixtures, and
  logs; incomplete credential/cost pairs fail closed.
- HTTP is HTTPS-only, rejects redirects, and enforces exact provider hosts. No
  arbitrary URL proxy is exposed.
- Provider JSON is schema-validated. HTTP bodies and raw responses are discarded
  rather than logged or persisted.
- Persisted identifiers are per-process salted hashes rather than raw emails or
  reusable unsalted hashes. JSONL files are forced to mode `0600`.
- A write-ahead intent is fsynced before a call. Missing completion is auditable
  as an unresolved, potentially billable attempt and must not be blindly replayed.
- No authentication/authorization surface exists because V0 is a local SDK, not
  a server. A future remote service would require a separate server-side tenant
  and authorization design.
- Production dependency audit reported no known vulnerabilities at verification.

## Verification commands/results

- `pnpm typecheck`: pass.
- `pnpm test`: 34 tests expected after the final durability regression; final
  count is reported by the handoff.
- `pnpm benchmark`: pass as a preflight; scorer self-tests return the expected
  `MECHANIC_PASS` and `MECHANIC_FAIL`, while the actual run is blocked.
- `pnpm build`: pass.
- `pnpm format:check`: pass.
- `pnpm audit --prod`: no known vulnerabilities.
- `git diff --check`: pass.

## Decision: BLOCKED_LIVE_EVAL

Blockers are all six credential/economic variables, 75 owned controlled-case
replacements, and absent live artifacts for all four conditions.

## What the evidence proves

The code can validate and normalize documented fixtures, preserve new states as
uncertain, select deterministically from measured inputs, enforce exact budgets,
account for fallback, retain crash-visible attempt intent, and reject a broken
benchmark scorer fixture.

## What the evidence does NOT prove

It does not prove provider access, current account billing, mapping frequency,
live correctness, provider heterogeneity, latency, fallback value, a 20% gain,
abstraction success, or product demand. It supports no positive or negative
mechanism verdict beyond the blocked status.

## Exactly one recommended next product experiment

Provision one owned email test domain with controlled existing, missing, and
catch-all mailboxes plus funded credentials and exact marginal-cost settings for
all three providers; privately freeze the 120-case replacements, then run the
four preregistered conditions once through calibration and held-out evaluation.
