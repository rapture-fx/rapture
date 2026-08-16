# V0 experiment methodology

Status: frozen before live measurements. Date: 2026-08-16.

## Question and boundary

V0 asks whether three real email-verification suppliers can honestly implement
one `email_verification` operation and whether deterministic routing improves
cost per useful outcome. It does not test a marketplace, generic procurement,
payments, an API gateway, an agent framework, or a product brand.

The customer job is: determine whether an address is appropriate to send to,
while preserving uncertainty and evidence. Provider identity is diagnostic and
must not be required by caller business logic.

## Evidence classes

1. Unit tests and documented response fixtures prove engineering behavior only.
2. Calibration runs measure provider behavior and justify a routing policy.
3. A held-out live run, with the same frozen workload and externally configured
   account economics, is required for any mechanism verdict.

No fixture, sandbox response, provider claim, or one provider's output is ground
truth for an ambiguous real-world address. When credentials, actual account
costs, or controlled ground truth are missing, the only valid decision is
`BLOCKED_LIVE_EVAL`.

## Dataset and split

The frozen workload manifest must contain at least 100 privacy-safe cases across
syntax failures, nonexistent domains, domains without usable MX, disposable
domains, controlled existing and missing mailboxes, safely controlled catch-all
domains, and ambiguous addresses used only for disagreement analysis. Arbitrary
personal addresses are prohibited.

The manifest assigns cases before execution: 40% calibration and 60% held-out,
stratified by segment. Calibration may define measured provider profiles and one
simple deterministic policy. The held-out set cannot change policy or mappings.
All four conditions receive the same cases. Condition order is deterministically
shuffled per repetition from a recorded seed.

## Metrics

Primary: exact micro-USD spent per high-confidence decisive outcome. Secondary:
total spend, spend/request, spend/decisive result, controlled correctness,
coverage, uncertainty, provider disagreement, median and p95 provider latency,
local router overhead, fallback frequency, billable attempts, provider mix, and
canonical mapping coverage.

Every provider call is an attempt and incurs its configured marginal cost unless
the account's documented billing behavior says otherwise. Fallback is allowed
only after failure or a non-decisive result and only within the remaining caller
budget. No invisible retry of a potentially billable request is permitted.
A durable intent is fsynced before each provider call, followed by an immutable
completion record. An intent without a completion is an explicitly unresolved
attempt after a crash or storage failure; it must be reconciled before replay.

## Frozen decisions

- `MECHANIC_PASS`: mapping coverage >=95%, and held-out routing improves the
  primary metric >=20% versus the best fixed baseline or materially improves
  quality/coverage near equal cost; controlled accuracy is within 2 percentage
  points of the strongest baseline; heterogeneity, not universal dominance,
  causes the gain.
- `NO_ROUTING_VALUE`: one provider dominates, gain is trivial, or fallback cost
  erases it.
- `ABSTRACTION_FAIL`: more than 5% of meaningful outcomes need caller-visible
  provider logic or normalization discards decision-essential information.
- `MECHANIC_FAIL`: the honest abstraction works but fair routing has no material
  economic or quality advantage.
- `BLOCKED_LIVE_EVAL`: credentials, exact account economics, or controlled data
  are unavailable.

The scorer must pass known-PASS and known-FAIL fixture tests before any live
result is interpreted.
