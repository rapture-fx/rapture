# operation-router (temporary internal name)

Provider-independent email verification experiment. Applications call
`verifyEmail()` with an outcome and constraints; explicit provider adapters map
heterogeneous responses into one uncertainty-preserving contract.

This private V0 is an experiment, not a marketplace, API gateway, payment
system, agent framework, generic proxy, or published npm package.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm benchmark
```

See `docs/v0-methodology.md` for the preregistered evaluation method and
`docs/provider-mappings.md` for the canonical semantic mappings.
