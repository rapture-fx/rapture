# ledger-kit real-agent task suite

This suite is a purpose-built TypeScript repository. It is not the Rapture repository.
Each task is independent, has deterministic validation, and is intended to require a real
implementation change rather than adding a constant.

Official acceptance is the `validation/*.ts` scripts referenced by
`fixtures/ledger-kit/tasks.json`. Those scripts live beside the task file and are resolved
to absolute paths before execution, so they are not part of the agent worktree.

## Tasks

| ID | Kind | Module | Why it exists | Validation | Independence | Expected difficulty |
| --- | --- | --- | --- | --- | --- | --- |
| `fix-parse-money` | small bug fix | `src/money.ts` | The baseline strips non-digits and drops the decimal, a realistic parsing bug. | Imports `parseMoney` and checks `$12.50`, commas, half-up cents rounding, and invalid input. Catches integer-stripping and missing `$`/comma handling. | Only `src/money.ts` | Medium. Requires parsing rules, not a one-line swap. |
| `add-volume-discount` | small feature | `src/discount.ts` | Adds a missing pricing rule with explicit thresholds. | Checks 0/9/10/49/50 boundaries, rounding, and negative/NaN rejection. Catches `>` instead of `>=`. | Only `src/discount.ts` | Medium-small. Threshold logic plus rounding. |
| `validate-sku` | input validation | `src/sku.ts` | The baseline concatenates unchecked strings. | Requires `ABC-1234` shape and rejects lowercase, wrong length, and non-digits. | Only `src/sku.ts` | Medium-small. Validation rules must be exact. |
| `one-based-pagination` | API behavior change | `src/pagination.ts` | The baseline is 0-based, which is a common off-by-one API mistake. | Page 1 is the first slice; page 0 and non-integers throw. Catches leaving 0-based indexing in place. | Only `src/pagination.ts` | Medium-small. Easy to “fix” the wrong way. |
| `extract-normalize-email` | refactor with preserved behavior | `src/email.ts` | Two functions duplicate trim/lowercase logic. | Requires exported `normalizeEmail` plus unchanged `formatContact`/`emailKey` behavior. | Only `src/email.ts` | Smallest of the six, but still requires reading both call sites. |
| `parse-config-comments` | configuration parsing | `src/config.ts` | The baseline cannot skip comments or quoted values. | Comments, quoted `#`, last-wins duplicates, empty values, and missing `=`. | Only `src/config.ts` | Medium. Several parsing cases must land together. |

## Incorrect implementations each validator is intended to catch

- `fix-parse-money`: `parseInt` after stripping non-digits; ignoring `$` or commas; returning unrounded floats for `1.005`.
- `add-volume-discount`: using `>` instead of `>=`; applying 10% at 10 items; not rounding.
- `validate-sku`: accepting lowercase departments or short ids.
- `one-based-pagination`: leaving page 0 as the first page.
- `extract-normalize-email`: changing trim/case behavior or omitting the exported helper.
- `parse-config-comments`: treating `# heading` as a key or dropping quoted `#` text.

## What this suite is not

These tasks measure whether a coding agent can make independently validated edits. They do not
measure long-horizon changeability, shared memory, or whether Rapture should recommend a worker
count.
