# Rapture history

## v1.0 research

Rapture, formerly SWEScale, began as empirical research into autonomous software engineering
scaling, bottlenecks, reproducibility, and long-horizon behavior. That publishable research state
is frozen at annotated tag `v1.0-research`
(`321d9c00df65add0d1fd2cf35d8c1691753dc726`).

## v1.0 verification integrity

The next product deterministically checked whether a code change weakened the tests, CI,
coverage configuration, or validators used to approve that same change. Its final state includes
the CLI, ten structural detectors, invariants, trust maps, window scans, GitHub Action, and signed
receipts.

It was frozen because the engineering was complete enough to test the thesis, while commercial
urgency remained unproven. Further detector work would not materially reduce that uncertainty.
The complete product remains recoverable at annotated tag `v1.0-verification-integrity`
(`83221a678178da6f5b5d099ad405af9408fb1bd2`).

## Stateful product testing

Main now explores a narrower question: did a real workflow leave the product in the correct
business state? Rapture creates a disposable product world, establishes initial state, runs the
workflow, observes state, reports focused expected-versus-actual differences, and resets.

This is a hard product reset with preserved Git history, not a compatibility release. The first
implementation contains exactly one local subscription seat-upgrade scenario and no platform
surface beyond what that scenario requires.

## Product bets, closed

Between 2026-08-28 and 2026-08-30 five product hypotheses were built on the
retained kernel and tested against real data: agent compute profiling, the
Software Change API, ProductionChange, the Deployment API, and
verification-surface detection.

All five are closed — four by evidence (`PHASE_0D_KILL`,
`SOFTWARE_CHANGE_API_RETHINK`, `DEPLOYMENT_API_KILL`,
`VERIFICATION_SURFACE_KILL`) and one by an honest `PRODUCTION_CHANGE_BLOCKED`
after four attempts to find a second real runtime provider failed.

Unlike the `v1.0` transitions above, this was not a hard reset and nothing was
frozen to a tag: the code was moved to `archive/packages/*` in the working tree,
where it remains buildable and tested. See `docs/closed-bets.md` for each bet's
thesis, verdict, evidence, and do-not-revive condition.

No new product direction was opened in its place.
