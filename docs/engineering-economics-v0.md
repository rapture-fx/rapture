# Engineering Economics V0

## Purpose

Rapture's existing metrics answer *how much* accepted engineering output an
autonomous coding configuration produces and how it scales. Engineering
Economics V0 answers the complementary question: **what did that output consume?**

It connects accepted outcomes to agent time, shared-host machine time, provider
token usage, and — only when explicitly configured — monetary cost. The goal is
transparent, reproducible economic accounting without inventing data that no
provider or user supplied.

This is a measurement capability. It does not introduce scheduling, scoring,
optimization, or any composite "efficiency score".

## Economic metric definitions

All economics fields are nullable. A metric is computed **only** when its inputs
exist; missing inputs produce `null`, never `Infinity`, `0`, or a guess.

### Agent-time economics

- `agentWallMsTotal`: sum of per-run `phaseTimings.agentExecutionMs` across all
  runs in a worker-count group (accepted, rejected, timed-out — every run that
  consumed an agent consumes time).
- `acceptedTasksPerAgentHour` = accepted tasks ÷ (agent wall time in hours).

Agent hours are per-agent: two parallel 30-minute agents accumulate one full
agent-hour even though only half an hour of wall time elapsed.

### Machine-time economics

- `machineWallMsTotal`: sum of trial wall durations (`trial_finished.durationMs`)
  for the worker group. This is **shared-host** wall clock. Concurrent workers on
  one host are counted once; machine cost is never multiplied by worker count.
- `acceptedTasksPerMachineHour` = accepted tasks ÷ (machine wall time in hours).

### Provider-cost economics

Two independent, clearly separated notions:

- **Provider-reported cost** (`providerReportedCost` / `providerReportedCostTotal`):
  a cost figure reported by the provider itself. Authoritative for what the
  provider claims, but Rapture did not derive it. Currency is whatever the
  provider metadata supplies (`null` if unstated).
- **Derived cost** (`derivedProviderCostTotal`): computed by Rapture from token
  categories × explicitly supplied unit prices. Only computed when every
  consumed category has a price.

### Accepted-output accounting

Cost-efficiency denominators use **accepted** outcomes only:
`providerCostPerAcceptedTask`, `machineCostPerAcceptedTask`,
`totalConfiguredCostPerAcceptedTask`, `acceptedTasksPerProviderDollar`,
`acceptedTasksPerTotalConfiguredDollar`.

But consumption totals include **every** run: rejected, validation-failed,
and timed-out runs still burned tokens and machine time. A rejected run makes
the accepted-output ratios worse — that is the point.

## Usage provenance

Every run may carry an `AgentUsage` record:

| Field | Meaning |
| --- | --- |
| `inputTokens` | prompt/input tokens |
| `outputTokens` | completion/output tokens |
| `cachedInputTokens` | cache-read tokens billed at cached rates |
| `reasoningTokens` | reasoning tokens if independently priced |
| `providerReportedCost` | cost stated by the provider (kept separate from derived cost) |
| `currency` | currency of the provider-reported figure, if stated |
| `usageSource` | provenance label, see below |
| `uncategorizedTokenCategories` | observed categories the pricing context cannot price |

`usageSource` values:

- `provider_reported` — usage came from the provider's own reporting.
- `cli_structured` — parsed from a stable structured CLI event stream.
- `derived_from_pricing` — computed by Rapture from supplied prices.
- `unavailable` — nothing reliable was available; numeric fields stay null.

Raw adapter stdout/stderr artifacts and their SHA-256 hashes were already
persisted per run; they remain the ground-truth provenance for anything parsed.

## Provider-reported vs derived cost

These are never merged into one number silently. Aggregates keep them in
separate fields. `totalConfiguredCost` combines *derived* provider cost with
configured machine cost; if neither exists but a provider reported costs, the
reported total is surfaced as `totalConfiguredCost` so reports stay useful while
remaining honest about origin.

## Machine-cost semantics

Machine cost requires an explicit `machineCostPerHour` in the pricing context.
Rapture never infers hardware depreciation, electricity, or laptop value.

```
machineCost = machineWallHours × machineCostPerHour
```

where `machineWallHours` is summed trial wall-clock time on the shared host.
Workers sharing one host are counted once — adding workers adds agent-hours,
not machines.

## Marginal worker economics

For each pair of adjacent worker counts (e.g. 2 → 4), the report includes:

- incremental accepted tasks
- incremental agent-hours and machine-hours
- incremental provider spend (derived or reported, when known)
- marginal provider cost per additional accepted task
- marginal configured total cost per additional accepted task
- additional accepted tasks per additional dollar

A null marginal value means the question could not be answered from available
data (for example zero incremental acceptance), not that the answer is zero or
infinite. Poor parallel efficiency alone is **not** an economic verdict;
economic judgment requires cost data.

## Missing-data rules

- All usage/pricing fields are nullable end to end.
- Any aggregate over a set containing missing members is null (all-or-nothing),
  so partial sums can never masquerade as totals.
- Zero or negative denominators yield null.
- Currencies are never collapsed; mixing currencies nulls the aggregate.
- If a nonzero token category has no price (or is listed in
  `uncategorizedTokenCategories`), derived cost is null.
- Historical experiments regenerate cleanly: their new economics fields are
  null/unavailable rather than errors.

## Currency handling

The pricing context carries exactly one `currency` code (3 letters). Derived
amounts are expressed in that currency. Provider-reported amounts carry their
own currency field, which may be null if the provider did not state one.
No conversion rates exist anywhere in Rapture.

## Pricing provenance

Pricing is supplied as a versioned JSON file passed with
`--pricing <path>`:

```json
{
  "provider": "opencode",
  "model": "opencode/deepseek-v4-flash-free",
  "currency": "USD",
  "inputCostPerMillionTokens": 0.27,
  "outputCostPerMillionTokens": 1.1,
  "cachedInputCostPerMillionTokens": 0.07,
  "reasoningCostPerMillionTokens": null,
  "machineCostPerHour": 1.2,
  "pricingSource": "vendor price sheet retrieved manually on 2026-08-21",
  "pricingEffectiveDate": "2026-08-21T00:00:00.000Z"
}
```

- The parsed pricing context is persisted inside the experiment manifest, so
  provenance survives resume and report regeneration.
- There is no network price lookup, ever. Prices come from the file or they do
  not exist.
- `rapture doctor --pricing <path>` validates the schema, currency code,
  effective date, non-negative machine rate, and warns on model-identity
  mismatch. Missing pricing is not a problem; invalid supplied pricing disables
  derived monetary metrics (WARNING) and the run refuses invalid pricing at
  config-build time (fail closed).

## Examples

Marginal economics between adjacent worker counts on a synthetic fixture
(see `packages/core/test/economics.test.ts`):

- 1 worker: 30 agent-minutes, 60 machine-minutes, 1 accepted task.
- 2 workers: 60 agent-minutes total (two parallel agents), 30 machine-minutes,
  2 accepted tasks.
- Marginal 1→2: +1 accepted task, +0 agent-hours, −0.5 machine-hours,
  marginal provider cost = exact token delta priced from the supplied context.

On the historical OpenCode diagnostic (regenerated read-only; see
`experiments/derived/opencode-scale-4-diagnostic.economics-view.json`):

| workers | accepted/agent-hour | accepted/machine-hour |
| --- | --- | --- |
| 1 | 32.7 | 32.4 |
| 2 | 25.0 | 45.9 |
| 4 | 19.0 | 56.6 |

Each additional worker bought zero incremental accepted tasks while consuming
more agent-hours — visible now as an explicit economic statement, with provider
cost correctly null because those runs carried no structured usage.

## Limitations

- OpenCode usage parsing accepts only well-formed `step_finish` events from the
  documented `--format json` stream; anything else yields null.
- OpenCode's `cache.write` tokens have no price slot in this V0 model; their
  presence forces derived cost to null via `uncategorizedTokenCategories`.
- Codex exposes no stable structured usage contract, so its usage stays null.
- Per-process CPU time and peak RSS are not yet captured; CPU-hour metrics
  return null until a measurable source exists.
- Machine cost reflects configured hourly rate × shared-host wall time; it is
  a normalization input, not an accounting system.

## What Rapture does not estimate

- Electricity, depreciation, or the value of your laptop.
- Provider prices. Not current ones, not historical ones, not "typical" ones.
- Token counts when none were reported.
- Any proprietary composite score combining throughput and cost.
- Whether a worker configuration is "worth it". It exposes the numbers;
  the judgment stays with you.
