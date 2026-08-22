/**
 * Single source of truth for research evidence that must never be rewritten in place.
 *
 * These trees are integrity-hashed somewhere: experiment integrity sidecars hash frozen
 * configs and the ledger-kit fixture, and benchmark manifests hash fixtures, validators,
 * known-good overlays and provenance. A formatter that "tidies" any of them silently
 * invalidates a suite fingerprint or a historical frozen experiment, so byte stability
 * matters more here than house style.
 */

export const protectedEvidenceRoots = Object.freeze([
  // Frozen experiment configs, integrity sidecars, persisted raw run evidence and
  // prediction chronology artifacts.
  "experiments",
  // Benchmark fixtures, external validators, known-good overlays, manifests, provenance.
  // Every one of these is hash-pinned by a manifest or an integrity sidecar.
  "benchmarks",
  // Hashed by six historical experiment integrity sidecars.
  "fixtures/ledger-kit",
]);

/** Files a temp workspace needs for Biome to resolve the same configuration. */
export const configFiles = Object.freeze(["biome.json", "package.json"]);
