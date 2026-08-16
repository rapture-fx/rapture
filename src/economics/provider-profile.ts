import type { MicroUsd } from "../domain/money.js";

export interface ProviderProfile {
  readonly providerId: string;
  readonly configured: boolean;
  readonly healthy: boolean;
  readonly supportsCanonicalSemantics: boolean;
  readonly costPerAttempt: MicroUsd;
  readonly latencySampleSize: number;
  readonly p95LatencyMs?: number;
  readonly calibrationAttempts: number;
  readonly calibrationUsefulOutcomes: number;
}

export const profileIsMeasured = (profile: ProviderProfile): boolean =>
  profile.calibrationAttempts > 0 && profile.calibrationUsefulOutcomes > 0;
