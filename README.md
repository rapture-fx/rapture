# Rapture

Rapture creates disposable product worlds where teams can run a real workflow and verify that
the resulting business state is correct before shipping.

**Test mode for stateful products.**

Rapture's source of truth is the business state after a workflow, not whether a button was
clicked or a request returned 200. The first release proves that primitive with one deliberately
small local scenario.

## How it works

Every scenario follows the same bounded lifecycle:

1. **GIVEN** — prepare a disposable world and seed known product state.
2. **WHEN** — execute the product's real workflow.
3. **OBSERVE** — read the resulting state through explicit observers.
4. **EXPECT** — compare expected and actual state at focused paths.
5. **RESET** — dispose or restore the world in finally-style cleanup.

Cleanup runs after PASS, business-state FAIL, and infrastructure ERROR. A FAIL means the workflow
ran but its business expectations were not met. An ERROR means setup, action, observation,
evidence recording, or cleanup failed.

## Quickstart

Requirements: Node.js 22+ and pnpm 10.12.1.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm rapture scenario list
pnpm rapture run subscription-seat-upgrade
pnpm rapture run subscription-seat-upgrade --json
```

The reference scenario starts with a team account at 10 seats, runs the actual local seat-upgrade
service, then verifies application seats, billing quantity, permissions, invoice creation, audit
history, and confirmation notification state at 15 seats. It uses a deterministic in-memory
state store and requires no network, LLM, production credentials, or external service.

Example output:

```text
RAPTURE
Scenario: subscription-seat-upgrade

World
PASS world prepared
PASS fixture loaded

Action
PASS workflow executed

State
PASS account.seats expected=15 actual=15
PASS auditEventCreated expected=true actual=true
PASS billing.quantity expected=15 actual=15
PASS confirmationNotificationCreated expected=true actual=true
PASS permissions.activeSeats expected=15 actual=15
PASS prorationInvoiceCreated expected=true actual=true

RESULT: PASS
```

JSON mode emits the same path-level expectations plus schema version, deterministic scenario ID,
volatile start/completion timestamps, observed state, failure details, cleanup stages, and a
deterministic result hash.

## Relationship to existing tools

- Cypress and Playwright can drive user behavior; Rapture evaluates the resulting business state.
- Storybook owns isolated component states; Rapture covers whole product workflows and backend
  state.
- Testcontainers provides disposable infrastructure; Rapture defines and checks the meaningful
  product world above it.
- Traditional integration tests can assemble this manually; Rapture standardizes the lifecycle,
  focused state differences, cleanup semantics, and evidence seams.

Rapture complements these tools. It does not replace them.

## Repository

- `packages/kernel` — retained product-neutral process, validation, journal, hashing, integrity,
  and optional receipt primitives.
- `packages/core` — typed scenario/world lifecycle, result model, state diff, registry, and the
  single reference scenario.
- `apps/cli` — the minimal `scenario list` and `run` interface.
- `docs/architecture.md` — architecture and reset decisions.
- `docs/migration-inventory.md` — the pre-deletion KEEP/ADAPT/ARCHIVE/DELETE inventory.
- `HISTORY.md` — research and product transition history.

## Current non-goals

This is not a browser framework, generic sandbox, simulation platform, agent reliability layer,
Git scanner, governance system, cloud service, dashboard, scheduler, plugin system, LLM judge, or
multi-tenant SaaS. It has no authentication, billing, telemetry, remote execution, Stripe/email/
queue adapters, or production shadow traffic.

Only the subscription seat-upgrade scenario is supported. New abstractions must be justified by
another real workflow rather than by a hypothetical platform roadmap.
