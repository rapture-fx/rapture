import { describe, expect, it } from "vitest";
import { microUsd } from "../src/domain/money.js";
import type { ProviderProfile } from "../src/economics/provider-profile.js";
import {
  deriveSelectionPolicy,
  providerEligibility,
  rankEligibleProviders,
  type SelectionPolicy,
} from "../src/routing/selection-policy.js";

const profile = (
  overrides: Partial<ProviderProfile> = {},
): ProviderProfile => ({
  providerId: "alpha",
  configured: true,
  healthy: true,
  supportsCanonicalSemantics: true,
  costPerAttempt: microUsd(5n),
  latencySampleSize: 20,
  p95LatencyMs: 100,
  calibrationAttempts: 20,
  calibrationUsefulOutcomes: 15,
  ...overrides,
});

const policy: SelectionPolicy = {
  calibrationId: "calibration-fixture-v1",
  orderedProviderIds: ["beta", "alpha"],
  minimumLatencySamples: 10,
};

describe("SelectionPolicy", () => {
  it("is deterministic independent of input profile order", () => {
    const alpha = profile();
    const beta = profile({ providerId: "beta" });
    expect(
      rankEligibleProviders([alpha, beta], policy, undefined, microUsd(0n)).map(
        (p) => p.providerId,
      ),
    ).toEqual(["beta", "alpha"]);
    expect(
      rankEligibleProviders([beta, alpha], policy, undefined, microUsd(0n)).map(
        (p) => p.providerId,
      ),
    ).toEqual(["beta", "alpha"]);
  });

  it("derives exact cost-per-useful ordering only from calibration counts", () => {
    const expensiveUseful = profile({
      providerId: "expensive-useful",
      costPerAttempt: microUsd(9_007_199_254_740_993n),
      calibrationAttempts: 20,
      calibrationUsefulOutcomes: 10,
    });
    const cheaperPerUseful = profile({
      providerId: "cheaper-per-useful",
      costPerAttempt: microUsd(9_007_199_254_740_994n),
      calibrationAttempts: 20,
      calibrationUsefulOutcomes: 20,
    });
    expect(
      deriveSelectionPolicy(
        [expensiveUseful, cheaperPerUseful],
        "calibration-hash",
      ).orderedProviderIds,
    ).toEqual(["cheaper-per-useful", "expensive-useful"]);
  });

  it("enforces remaining budget exactly", () => {
    expect(
      providerEligibility(
        profile(),
        { maxCost: microUsd(5n) },
        microUsd(0n),
        10,
      ).eligible,
    ).toBe(true);
    expect(
      providerEligibility(
        profile(),
        { maxCost: microUsd(5n) },
        microUsd(1n),
        10,
      ),
    ).toMatchObject({
      eligible: false,
      reason: "budget_ineligible",
    });
  });

  it("fails closed on latency constraints without enough measurements", () => {
    expect(
      providerEligibility(
        profile({ latencySampleSize: 2 }),
        { maxLatencyMs: 200 },
        microUsd(0n),
        10,
      ),
    ).toMatchObject({ eligible: false, reason: "latency_unmeasured" });
  });
});
