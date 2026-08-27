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
