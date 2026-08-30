# Rapture

A systems-engineering repository and an honest record of five closed product
bets.

Rapture is **not** an active multi-product surface, and it is not a startup
roadmap. What is maintained here is a small set of product-neutral integrity
primitives plus one deterministic reference scenario that exercises them. What is
archived here is the code from every product hypothesis that was tested against
real data and answered — mostly "no".

- **Maintained:** `packages/kernel`, `packages/core`, `apps/cli`.
- **Closed, archived, still buildable:** `archive/packages/*` — see
  [`docs/closed-bets.md`](docs/closed-bets.md) and
  [`archive/README.md`](archive/README.md).

If you are looking for the Change API, ProductionChange, the Deployment API, the
agent profiler, or verification-surface detection: they were real, they were
measured, and they were closed. The verdicts and the evidence are in
[`docs/closed-bets.md`](docs/closed-bets.md). Please read the do-not-revive
conditions there before reopening any of them.

## The maintained primitives

`packages/kernel` — shell-free argv process execution and external validation,
append-only fsynced JSONL journals, safe artifact paths, secret redaction,
immutable writes, SHA-256 hashing, tree integrity manifests, and an optional
Ed25519/DSSE-compatible receipt library.

These are load-bearing: all five archived bets built on them, and none of them
required the kernel to change to accommodate one provider or one product shape.
That is the main evidence that the primitives are the durable part.

`packages/core` — a typed scenario/world lifecycle, result model, path-level
state diff, and registry.

## The reference scenario

One deliberately small local scenario exercises the lifecycle end to end. It is a
reference implementation and a regression test, not a product.

Every scenario follows the same bounded lifecycle:

1. **GIVEN** — prepare a disposable world and seed known product state.
2. **WHEN** — execute the real workflow.
3. **OBSERVE** — read the resulting state through explicit observers.
4. **EXPECT** — compare expected and actual state at focused paths.
5. **RESET** — dispose or restore the world in finally-style cleanup.

Cleanup runs after PASS, business-state FAIL, and infrastructure ERROR. A FAIL
means the workflow ran but its business expectations were not met. An ERROR means
setup, action, observation, evidence recording, or cleanup failed.

## Quickstart

Requirements: Node.js 22+ and pnpm 10.12.1.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm rapture scenario list
pnpm rapture run subscription-seat-upgrade
pnpm rapture run subscription-seat-upgrade --json
```

The scenario starts with a team account at 10 seats, runs the actual local
seat-upgrade service, then verifies application seats, billing quantity,
permissions, invoice creation, audit history, and confirmation notification state
at 15 seats. It uses a deterministic in-memory state store and requires no
network, LLM, production credentials, or external service.

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

JSON mode emits the same path-level expectations plus schema version,
deterministic scenario ID, volatile start/completion timestamps, observed state,
failure details, cleanup stages, and a deterministic result hash.

The CLI surface is exactly `scenario list` and `run`. The `change`, `production`,
`deploy`, `deployment status`, `rollback`, `profile`, `runs`, `analyze`, and
`experiment` commands were removed when their bets closed.

## Repository

| Path | Status |
|---|---|
| `packages/kernel` | Maintained — product-neutral process, validation, journal, hashing, integrity, receipts |
| `packages/core` | Maintained — scenario/world lifecycle, result model, state diff, registry |
| `apps/cli` | Maintained — `scenario list` and `run` |
| `archive/packages/*` | **Historical** — code from closed bets, kept buildable and tested |
| `docs/closed-bets.md` | Every bet, verdict, evidence pointer, and do-not-revive condition |
| `docs/architecture.md` | Architecture and reset decisions |
| `docs/repo-cleanup-report.md` | What was kept, moved, and ignored in the cleanup |
| `docs/migration-inventory.md` | The pre-deletion KEEP/ADAPT/ARCHIVE/DELETE inventory |
| `HISTORY.md` | Research and product transition history, with frozen tags |
| `experiments/` | Experiment manifests and task definitions for the archived runs |

Raw experiment output lives in `.rapture/` and is gitignored. The reports in
`docs/` are the durable record.

## Current non-goals

This is not a browser framework, generic sandbox, simulation platform, agent
reliability layer, Git scanner, governance system, cloud service, dashboard,
scheduler, plugin system, LLM judge, or multi-tenant SaaS. It has no
authentication, billing, telemetry, remote execution, Stripe/email/queue
adapters, or production shadow traffic.

No new product direction is open. New abstractions must be justified by a real
workflow rather than by a hypothetical platform roadmap, and reviving an archived
bet requires meeting the explicit condition recorded for it in
[`docs/closed-bets.md`](docs/closed-bets.md).
