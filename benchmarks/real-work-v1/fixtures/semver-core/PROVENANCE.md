# Provenance

This directory is **not** an unmodified upstream repository. It is a *minimized derived
snapshot* of `npm/node-semver`, reduced so that it can be materialized, executed, and
validated deterministically offline with no package installation.

- Upstream: https://github.com/npm/node-semver
- Upstream revision: `6e05b7637396ac66522cff8731f07cfe0ef49a29` (tag `v7.8.5`)
- License: ISC (retained verbatim in `LICENSE`)

See `benchmarks/real-work-v1/provenance.json` for the machine-readable record, including
the exact retained/removed path list and every post-acquisition transformation, and
`docs/real-work-external-validity-v1-report.md` for the full methodology.

Deliberate baseline defects have been introduced into this snapshot so that benchmark
tasks have something to repair. This snapshot therefore does **not** behave like released
`semver@7.8.5` and must not be used as a dependency.
