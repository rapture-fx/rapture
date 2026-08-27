# PostgreSQL product-world evaluation

A falsification experiment, not a roadmap phase. The question is narrow:

> When the `subscription-seat-upgrade` scenario runs against real persistent business state
> instead of an in-memory object, does Rapture's scenario/world abstraction earn its
> existence — or does it just wrap an ordinary Vitest + Testcontainers integration test?

The experiment was run. The result is written up honestly below, including the parts where
Rapture loses.

**Verdict: `PRODUCT_PRIMITIVE_WEAK`.** The abstraction survived real persistence completely
intact — zero API changes were required — but it costs more code than the plain equivalent
and provides no leverage on the expensive part of the work.

## Infrastructure deviation (read this first)

The task specified Testcontainers. **Docker is not available in this environment**: no
`docker` CLI, no Docker Desktop, no podman/colima/OrbStack, and `/var/run/docker.sock` is a
stale symlink that refuses connections. Testcontainers cannot run here.

Rather than substitute SQLite or an in-memory fake — which would have destroyed the
experiment — the world was built against the **real local PostgreSQL 14.18 server** already
running on `127.0.0.1:5432`, creating and dropping a **fresh disposable database per run**.

This preserves everything the experiment actually depends on: real on-disk storage, real
transactions, real constraints, real SQL errors, real cross-connection visibility, and real
per-run disposal. What it changes is only *how the instance is acquired*, which is isolated
to ~69 lines and is called out separately in every comparison below so the numbers stay
honest.

## What code is what

`packages/core/src/reference/subscription-seat-upgrade-postgres.ts` is 386 lines:

| Category | Lines | Who writes it |
| --- | ---: | --- |
| Product-state SQL — schema DDL, seed, workflow, observation | **191** | You. Rapture provides nothing here. |
| Disposable-instance plumbing — connect, `CREATE`/`DROP DATABASE`, host guard | **69** | You. ~10 lines with Testcontainers. |
| World lifecycle wiring — the five `ScenarioWorld` methods | **85** | You, against Rapture's interface. |
| Imports and domain constants | 22 | You. |
| Test-only fault injection | 9 | You (experiment scaffolding). |
| **`ScenarioDefinition` — name, fixture, expectations, `createWorld`** | **10** | You. |

The last row is the important one. Swapping an in-memory world for a real PostgreSQL world
cost **ten lines** of scenario definition, because name, description, fixture and expectations
are reused verbatim from the in-memory scenario. That is the abstraction working as designed.

The first row is the other important one. **191 of 386 lines — roughly half — are SQL that
Rapture does not help you write.** Schema, seeding, the workflow itself, and the observation
query are exactly as much work as they would be in any integration test.

## Approximate line-count comparison

Writing the same verification as a direct Vitest + Testcontainers integration test:

| | Rapture (Testcontainers-normalised) | Plain Vitest + Testcontainers |
| --- | ---: | ---: |
| Schema DDL | 37 | 37 |
| Seed | 49 | 49 |
| Workflow SQL | 48 | 48 |
| Observation query + row type | 57 | 57 (or 0 — assert on rows directly) |
| Container lifecycle | ~10 | ~20 (`beforeAll` / `afterAll`) |
| World lifecycle wiring | 85 | 0 |
| Scenario definition | 10 | 0 |
| Assertions | 0 (declarative `expected`) | ~10 |
| **Total** | **~296** | **~221** |

**Plain Vitest + Testcontainers is roughly 75 lines shorter.** Rapture does not reduce line
count for a single scenario. It cannot: the SQL dominates, and Rapture adds an interface to
implement on top of it.

The line count would only invert if many scenarios shared one world — but building a second
scenario was explicitly out of scope, so that remains an untested hypothesis, not a finding.

## What Rapture genuinely centralises

These are real, and they are not things Vitest gives you:

1. **Disposal is structural, not a convention.** `runScenario` calls `disposeOrReset()` in a
   `finally` that covers PASS, FAIL, ERROR, *and* a failure inside `prepare` itself. Proven:
   after a PASS run, a FAIL run, and an ERROR run, zero `rapture_scenario_*` databases remain
   on a server that hosts 24 unrelated databases. In plain Vitest this is `afterAll`, which
   works — but `afterAll` runs with whatever partial state `beforeAll` left behind, and the
   "container reference is undefined because startup threw" bug is a real and common one.
   Rapture removes the opportunity to get it wrong rather than making it easier to get right.

2. **FAIL is structurally distinct from ERROR.** This is the strongest finding. Plain Vitest
   has one failure channel: a Testcontainers startup timeout and a genuine business-state
   regression are both "test failed", differing only in message text. Rapture returns
   `status: "ERROR"` with a `failures[].phase` for the former and `status: "FAIL"` with a
   populated expectation diff for the latter, and the CLI exits `2` versus `1`. Demonstrated:

   ```
   FAIL  permissions.activeSeats expected=15 actual=10   → status FAIL,  failures []
   ERROR relation "billing_subscriptions" does not exist  → status ERROR, phase "action"
   ERROR connect ECONNREFUSED 127.0.0.1:59999             → status ERROR, phase "prepare"
   ```

   In the FAIL case the workflow committed successfully. An ordinary integration test that
   only asserted "the upgrade endpoint returned 200" would have passed.

3. **A world-independent deterministic result hash.** The in-memory world and the PostgreSQL
   world produce byte-identical `resultHash` values
   (`5ee0d1ffa62115ed7ada69427c0c3bc03a86257e5127d7185ba0260e24fda263`) because the hash covers
   business outcome only — no database name, port, row id, or timestamp reaches it. That is a
   genuine capability with no Vitest equivalent: it says *the business outcome is identical
   regardless of substrate*, which is exactly the claim Rapture's one-liner makes.

4. **Every expectation is evaluated and reported.** Six paths are always reported, PASS and
   FAIL alike. Hand-written `expect()` calls stop at the first failure, so you learn about one
   broken invariant per run. `expect(observed).toEqual(expected)` gets you most of the way,
   though — this is a modest win, not a large one.

## Where Rapture adds ceremony rather than removing it

Stated plainly, because the point is falsification:

1. **No leverage on the expensive part.** Half the file is SQL. Rapture helps with none of it.
   Fixtures, seeding, and observation queries remain fully bespoke.

2. **The lifecycle is rigid: exactly one action, exactly one observation.** Real integration
   tests routinely need *do A, assert, do B, assert*. `ScenarioWorld` cannot express that. The
   seat-upgrade scenario happens to fit the shape; many realistic workflows will not, and the
   only escape is a second scenario or a compound `run()` that hides intermediate state.

3. **Observation must be hand-mapped into a JSON-serializable shape.** `ObservationRow` →
   `SeatUpgradeObservation` is 57 lines of mapping that exists to feed the diff engine. A plain
   test asserts on query results directly and skips this layer entirely.

4. **Five closure methods versus two lifecycle hooks.** `createWorld` returning
   `{ prepare, seedOrRestore, run, observe, disposeOrReset }` with internal `undefined` guards
   is more machinery than `beforeAll` / `afterAll` plus a test body.

5. **Injecting a variant requires threading options through `createWorld`.** Because the
   definition owns world construction, the faulty implementation had to become a factory
   option and a re-declared `defineScenario`. In a plain test it is a function argument.

## Answers to the falsification questions

| Question | Answer |
| --- | --- |
| Does the same scenario definition work cleanly with a real PostgreSQL world? | **Yes, completely.** Zero changes to `ScenarioDefinition`, `ScenarioWorld`, `runScenario`, or the diff engine. Name, fixture, expectations and observation type reused verbatim. |
| Does Rapture remove meaningful fixture/reset/observation/diff boilerplate? | **Reset yes, diff partially, fixture and observation no.** |
| Is state diffing materially more useful than ordinary assertions? | **Marginally.** Full-path reporting beats first-failure-wins; `toEqual` on a whole object closes most of the gap. |
| Does finally-style world cleanup materially improve integration-test reliability? | **Yes, modestly.** It converts a discipline problem into a structural guarantee. |
| Can the developer reason about business outcome instead of test infrastructure? | **Yes at the definition layer** (10 lines, pure business). **No at the world layer** (376 lines, almost entirely infrastructure). |
| Would an experienced engineer prefer this over a direct Vitest + Testcontainers test? | **For one scenario, no.** The plain test is ~75 lines shorter and uses tools they already know. They might prefer Rapture for the ERROR/FAIL split and the result hash — neither of which requires the world abstraction to deliver. |
| If not, which part is redundant or incorrectly abstracted? | **`ScenarioWorld` is the weak member.** `runScenario`'s PASS/FAIL/ERROR trichotomy, the state diff, and the deterministic hash all carry their weight. The five-method world interface mostly renames `beforeAll`/`afterAll` while constraining the test to a single action. |

## Verdict

`PRODUCT_PRIMITIVE_WEAK`.

The abstraction is not broken — it survived contact with real persistent state without a single
API change, which is a genuine positive result and the main thing this experiment set out to
test. But it did not pay for itself on one scenario. The durable value found here lives in
`runScenario` (PASS/FAIL/ERROR) and the deterministic business-outcome hash, not in
`ScenarioWorld`.

The honest next question is not "what should we add?" but: **does a second scenario sharing one
world invert the line-count comparison?** If it does not, `ScenarioWorld` should be reconsidered
rather than extended.
