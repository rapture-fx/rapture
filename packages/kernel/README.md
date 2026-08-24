# @rapture/kernel

Deterministic verification primitives for autonomous software engineering.

**Zero product opinions. Zero LLM calls. Minimal runtime dependencies.**

## Modules

| Module | Purpose |
|---|---|
| `evidence/` | SHA-256 hashing, immutable artifact writes, tamper-evident integrity manifests |
| `checker/` | Shell-free command parsing and sequential validation runner |
| `journal/` | Append-only, fsync-per-record JSONL durability |
| `policy/` | Pure run-acceptance classification and state predicates |
| `judge/` | Hash-pinned external validator execution contract |
| `signals/` | Structural verification-weakening detectors; invariant-pack support |
| `receipts/` | DSSE-compatible signed attestations (ed25519) |
| `exec/` | Sandbox executor abstraction with test double |

## Principles

1. Deterministic: identical inputs produce identical verdicts
2. No model calls anywhere in the verification path
3. Every artifact hash-recorded; single-byte mutations are detectable
4. Receipts verify offline, without trusting the issuer

See `apps/cli` for the `rapture` binary that composes these modules.
