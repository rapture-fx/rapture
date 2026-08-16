import { addMoney, isWithinBudget, type MicroUsd } from "../domain/money.js";
import type { ProviderProfile } from "../economics/provider-profile.js";
import type { EmailVerificationConstraints } from "../operations/email-verification/contract.js";

export type IneligibilityReason =
  | "not_configured"
  | "unhealthy"
  | "semantics_unsupported"
  | "budget_ineligible"
  | "latency_unmeasured"
  | "latency_ineligible";

export interface ProviderEligibility {
  readonly providerId: string;
  readonly eligible: boolean;
  readonly reason?: IneligibilityReason;
}

export interface SelectionPolicy {
  readonly calibrationId: string;
  readonly orderedProviderIds: readonly string[];
  readonly minimumLatencySamples: number;
}

/** Derive order from calibration cost per useful outcome using exact cross multiplication. */
export const deriveSelectionPolicy = (
  profiles: readonly ProviderProfile[],
  calibrationId: string,
  minimumLatencySamples = 20,
): SelectionPolicy => ({
  calibrationId,
  minimumLatencySamples,
  orderedProviderIds: [...profiles]
    .sort((left, right) => {
      const leftMeasured =
        left.calibrationAttempts > 0 && left.calibrationUsefulOutcomes > 0;
      const rightMeasured =
        right.calibrationAttempts > 0 && right.calibrationUsefulOutcomes > 0;
      if (leftMeasured !== rightMeasured) return leftMeasured ? -1 : 1;
      if (leftMeasured && rightMeasured) {
        const leftTotal =
          left.costPerAttempt * BigInt(left.calibrationAttempts);
        const rightTotal =
          right.costPerAttempt * BigInt(right.calibrationAttempts);
        const comparison =
          leftTotal * BigInt(right.calibrationUsefulOutcomes) -
          rightTotal * BigInt(left.calibrationUsefulOutcomes);
        if (comparison !== 0n) return comparison < 0n ? -1 : 1;
      }
      return left.providerId.localeCompare(right.providerId);
    })
    .map((profile) => profile.providerId),
});

export const providerEligibility = (
  profile: ProviderProfile,
  constraints: EmailVerificationConstraints | undefined,
  spent: MicroUsd,
  minimumLatencySamples: number,
): ProviderEligibility => {
  if (!profile.configured)
    return {
      providerId: profile.providerId,
      eligible: false,
      reason: "not_configured",
    };
  if (!profile.healthy)
    return {
      providerId: profile.providerId,
      eligible: false,
      reason: "unhealthy",
    };
  if (!profile.supportsCanonicalSemantics)
    return {
      providerId: profile.providerId,
      eligible: false,
      reason: "semantics_unsupported",
    };
  if (
    !isWithinBudget(
      addMoney(spent, profile.costPerAttempt),
      constraints?.maxCost,
    )
  )
    return {
      providerId: profile.providerId,
      eligible: false,
      reason: "budget_ineligible",
    };
  if (constraints?.maxLatencyMs !== undefined) {
    if (
      profile.latencySampleSize < minimumLatencySamples ||
      profile.p95LatencyMs === undefined
    )
      return {
        providerId: profile.providerId,
        eligible: false,
        reason: "latency_unmeasured",
      };
    if (profile.p95LatencyMs > constraints.maxLatencyMs)
      return {
        providerId: profile.providerId,
        eligible: false,
        reason: "latency_ineligible",
      };
  }
  return { providerId: profile.providerId, eligible: true };
};

export const rankEligibleProviders = (
  profiles: readonly ProviderProfile[],
  policy: SelectionPolicy,
  constraints: EmailVerificationConstraints | undefined,
  spent: MicroUsd,
): readonly ProviderProfile[] => {
  const priority = new Map(
    policy.orderedProviderIds.map((id, index) => [id, index]),
  );
  return profiles
    .filter(
      (profile) =>
        providerEligibility(
          profile,
          constraints,
          spent,
          policy.minimumLatencySamples,
        ).eligible,
    )
    .sort((left, right) => {
      const leftRank = priority.get(left.providerId) ?? Number.MAX_SAFE_INTEGER;
      const rightRank =
        priority.get(right.providerId) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftRank - rightRank || left.providerId.localeCompare(right.providerId)
      );
    });
};
