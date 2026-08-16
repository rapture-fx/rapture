import type { Effect } from "effect";
import type { MicroUsd } from "./money.js";
import type {
  CanonicalEvidence,
  Confidence,
  Decision,
  EmailVerificationRequest,
} from "../operations/email-verification/contract.js";

export type ProviderFailureKind =
  | "authentication_failure"
  | "rate_limit"
  | "provider_timeout"
  | "transport_failure"
  | "provider_malformed_response";

export class ProviderFailure extends Error {
  readonly _tag = "ProviderFailure";
  constructor(
    readonly providerId: string,
    readonly kind: ProviderFailureKind,
    readonly retryable: boolean,
  ) {
    super(`${providerId} request failed: ${kind}`);
    this.name = "ProviderFailure";
  }
}

export interface NormalizedProviderOutcome {
  readonly decision: Decision;
  readonly confidence: Confidence;
  readonly evidence: CanonicalEvidence;
  /** Provider status identifier only; no raw response or sensitive payload. */
  readonly mappingCode: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly costPerAttempt: MicroUsd;
  readonly configured: boolean;
  readonly measuredP95LatencyMs?: number;
  readonly verify: (
    request: EmailVerificationRequest,
  ) => Effect.Effect<NormalizedProviderOutcome, ProviderFailure>;
}
