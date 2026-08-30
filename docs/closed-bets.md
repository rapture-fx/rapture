# Closed bets

Every product hypothesis this repo has tested, what answered it, and what would
have to be true to reopen it. Nothing on this page is an active direction.

The rule that produced this page: a bet is closed by **real data or an honest
`BLOCKED`**, never by losing interest. Where a run was blocked, it is recorded as
blocked — not as a kill and not as a success.

| # | Bet | Thesis (one line) | Verdict | Evidence | Code |
|---|---|---|---|---|---|
| 1 | Agent compute profiling | Agent runs contain enough observable redundancy to be worth a reuse layer | `PHASE_0_BLOCKED` → `PHASE_0B_WEAK_SIGNAL` → `PHASE_0C_KILL_SIGNAL` → `PHASE_0D_KILL` | [phase0](phase0-report.md), [0B](phase0b-report.md), [0C](phase0c-report.md), [0D](phase0d-report.md) | `archive/packages/profiler` |
| 2 | Software Change API | A canonical cross-vendor `Change` object is worth more than a Git SHA | `SOFTWARE_CHANGE_API_RETHINK` | [report](change-api-report.md), [architecture](change-api-architecture.md) | `archive/packages/change` |
| 3 | ProductionChange | Runtime identity (current/previous deployment ↔ source commit) generalizes across providers | `PRODUCTION_CHANGE_CONTINUE` (V0, narrow) → `PRODUCTION_CHANGE_BLOCKED` (V1–V1C) | [V0](production-change-report.md), [V1](production-change-v1-report.md), [V1B](production-change-v1b-report.md), [V1B-retry](production-change-v1b-retry-report.md), [V1C](production-change-v1c-report.md) | `archive/packages/production-change` |
| 4 | Deployment API | A canonical deploy / status / rollback surface beats native provider CLIs | `DEPLOYMENT_API_KILL` | [report](deployment-api-v0-report.md), [semantics](deployment-api-semantics.md) | `archive/packages/production-change` (deployment surface) |
| 5 | Verification-surface delta | Agent-authored PRs measurably weaken the verification system | `VERIFICATION_SURFACE_KILL` | [report](verification-surface-phase-a-b-report.md) | `archive/packages/verification-surface` |

---

## 1. Agent compute profiling — `PHASE_0D_KILL`

**Thesis.** Coding-agent runs repeat enough work (re-reads, dead-end searches,
retries) that a deterministic reuse or caching layer would pay for itself.

**What happened.** Four phases, escalating rigor:

- **Phase 0** — instrumentation only. The single live OpenCode run failed at the
  LLM gateway with `CreditsError` before any tool call, so 0 operations were
  observed. Recorded `PHASE_0_BLOCKED`, not "no redundancy".
- **Phase 0B** — 24 real runs across 4 cohorts. Related tasks showed 20.4%
  observable redundancy and 20.4% deterministic reuse against a 2.2% unrelated
  control. Real, but below the pre-registered strong-signal threshold of ≥30%
  redundancy + ≥15% reuse. **Weak signal.**
- **Phase 0C** — the direct test: precompute the working set (exact paths +
  content hashes) and hand it to the agent. 30 runs, 15 paired. Treatment did
  **not** help: median file reads +20%, ops 0%, uncached tokens +3.3%, duration
  +15.7%. The artifact itself cost ~3,041 tokens, erasing the gross savings.
  **`KILL_SIGNAL`.**
- **Phase 0D** — trajectory economics, 46 runs × 3 models. Even under generous
  counting, total waste was **<15%** with no dominant waste class. The report's
  own recommendation: *"none, do not productize"*. **`KILL`.**

**Why it is closed.** There is no dominant waste class to attack, and the one
wedge that was actually tried lost to the provider's own caching.

**Do not revive unless:** a workload shows ≥30% redundancy *and* ≥15%
deterministic reuse on a corpus that is not this repo, with failed and retried
trajectories actually present (Phase 0D had zero failures across 46 runs — the
tasks were too easy, which is a real limitation, not a result).

---

## 2. Software Change API — `SOFTWARE_CHANGE_API_RETHINK`

**Thesis.** A versioned canonical `Change` object joining intent → PR → commit →
check → artifact → deployment → production effect is worth more than the Git SHA
teams already have.

**What happened.** Built and tested against 5 real historical changes in this
repo. Deterministic PR ↔ commit ↔ CI joins genuinely work. But **Git SHA plus PR
merge SHA already delivers ~80% of the value**, and of the five integrated
systems, three (Vercel, Sentry, Linear) had no deterministic linkage in the
corpus — only explicit, sparse references. The canonical object passed its
leakage test but was heading toward a bag of optional nulls.

**Why it is closed.** `RETHINK`, not `KILL` — the narrow GitHub + Actions + Git
core was sound. But the narrowing was never pursued, and the vendor-normalization
line it belonged to is closed. It is recorded here as closed, not as pending.

**Do not revive unless:** there is a concrete consumer that needs PR→commit→CI
joins *and* cannot get them from `gh` plus a SHA — and the scope is the three
systems with deterministic data, never five.

---

## 3. ProductionChange — `PRODUCTION_CHANGE_BLOCKED`

**Thesis.** A narrow runtime-identity primitive — what is running in this
environment right now, what was running before it, and which commit it came from
— generalizes across deployment providers.

**What happened.** V0 validated well on **one** provider: 15 real Vercel
production deployments, 100% source-commit linkage, 93% previous-state
resolution, no provider branching in the consumer. Verdict `CONTINUE`, narrowly.

The acceptance criterion for V1 was **two real runtime providers**. Four attempts
failed to find a second:

- **V1** — no Kubernetes or ECS available (`kubectl`, `aws`, `docker` absent).
- **V1B** — attempted a disposable local cluster; `brew install kind` was still
  building Go after 5 minutes.
- **V1B-retry** — two 600s `brew install` attempts timed out with no output.
- **V1C** — swept Cloudflare, Railway, Render, Fly, AWS, GCP, Azure, Netlify,
  Heroku, Supabase, Firebase. None installed, none authenticated.

Each time the honest report was `BLOCKED` rather than a fixture-backed claim of
validation. Notably, **no product code was changed to accommodate a provider that
had not been observed** — the correct discipline.

**Why it is closed.** Cross-runtime portability was never demonstrated, and bet 4
subsequently found that the primitive's stored `previous` pointers were broken on
real data anyway (see below).

**Do not revive unless:** a second real, authorized runtime provider with ≥10
real deployment events is genuinely accessible — and the dangling-reference
defect from bet 4 is fixed and regression-tested first.

---

## 4. Deployment API — `DEPLOYMENT_API_KILL`

**Thesis.** A canonical `deploy` / `status` / `rollback` surface over multiple
providers is worth more than each provider's own CLI.

**What happened.** This is the one bet that was **not** blocked. Both provider
CLIs were installed and authenticated, and **6 real production mutations** were
executed against two real services. The abstraction did not survive contact:

- **8 defects, all found by real execution rather than inspection.** Two were
  dangerous: canonical `status` returned **`ready` for a deployment ID that
  cannot exist**, and **every** `previousProductionChangeId` in the store was a
  **dangling reference** — meaning ProductionChange-backed rollback had never
  worked on real data at any point.
- **Deploy is worse than cosmetic.** `DeployInput` models `service +
  sourceRevision` but has no model of *where that service's source lives or how
  it is built*. All 3 Vercel deploys failed at build. The 3 Cloudflare deploys
  succeeded only because Pages uploads static files and the "service source"
  happened to be this repo.
- **Status adds nothing.** Both provider CLIs block until terminal, so **zero
  intermediate state transitions were observable** across all 6 mutations.
- **Rollback could not be executed on either provider.**

**Why it is closed.** The one component with demonstrated value — the rollback
*plan* — is already shipped by the provider as `vercel rollback <id> --yes`: one
command, no source needed, and it works. `DEPLOYMENT_API_BLOCKED` and
`DEPLOYMENT_API_RETHINK_ROLLBACK` were both explicitly considered and rejected in
the report.

**Do not revive unless:** a canonical surface can model service source provenance
and build inputs (not just `service + revision`), *and* rollback is verified
working on two real providers.

---

## 5. Verification-surface delta — `VERIFICATION_SURFACE_KILL`

**Thesis.** Agent-authored PRs materially weaken the verification system — skips,
lowered coverage thresholds, removed CI test invocations, deleted tests — often
enough and structurally enough to detect deterministically.

**What happened.** Corpus of **50 real, independently-authored, merged agent PRs**
from 30 repositories and 6 distinct agent identities, frozen before the detector
was built. Across 96 verification-relevant files, manual material-weakening
prevalence was **0%** — not low, zero. No added skip markers, no lowered coverage
thresholds, no removed CI test invocations, no test file deleted whose subject
survived. The single PR showing any assertion loss was a feature deletion
carrying its own tests.

The detector produced 1 false positive and 0 true positives on its first run,
then 0 positives of any kind after one conservative tuning pass. **Precision is
undefined, not high** — there was nothing in the sample to be precise about.

**Why it is closed.** The kill criterion (prevalence <3%, no severe repeated
cases) was met unambiguously.

**Important caveat, preserved.** The most useful finding is *why* the number is
zero. The corpus can only observe **PR-submitting agent bots**, while the
incidents that motivated the hypothesis were reported from **interactive local
agent sessions**. This experiment does not refute those reports — it shows they
are not visible in the artifact this detector consumes. A future bet on this
theme would need a fundamentally different observation surface, not a better
detector.

---

## What survived

Not a product — engineering. See [`architecture.md`](architecture.md).

- `packages/kernel` — shell-free argv exec, append-only fsynced JSONL journal,
  safe artifact paths, redaction, SHA-256, tree integrity manifests, optional
  Ed25519/DSSE receipts.
- `packages/core` — scenario/world lifecycle, result model, path-level state
  diff, registry, and the one reference scenario.
- `apps/cli` — `scenario list` and `run`.

Every closed bet above reused `@rapture/kernel` for hashing, redaction, safe
paths, and durable journalling. That reuse is the evidence that the kernel
primitives are real: they were load-bearing across five independent product
attempts and never needed to change to accommodate one.
