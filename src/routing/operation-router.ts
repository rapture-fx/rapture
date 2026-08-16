import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Effect, Either } from "effect";
import type { ExecutionRecord } from "../domain/execution-record.js";
import {
  addMoney,
  microUsd,
  serializeMoney,
  type MicroUsd,
} from "../domain/money.js";
import type {
  NormalizedProviderOutcome,
  ProviderAdapter,
} from "../domain/provider-adapter.js";
import type { ProviderProfile } from "../economics/provider-profile.js";
import type { ExecutionStore } from "../persistence/execution-store.js";
import type {
  EmailVerificationRequest,
  EmailVerificationResultWire,
} from "../operations/email-verification/contract.js";
import { evaluateOutcome } from "../operations/email-verification/evaluator.js";
import {
  rankEligibleProviders,
  type SelectionPolicy,
} from "./selection-policy.js";

export type RoutingFailureKind =
  "no_eligible_provider" | "providers_exhausted" | "persistence_failure";

export class RoutingFailure extends Error {
  readonly _tag = "RoutingFailure";
  constructor(readonly kind: RoutingFailureKind) {
    super(`email verification routing failed: ${kind}`);
    this.name = "RoutingFailure";
  }
}

export interface RouterClock {
  readonly nowMs: () => number;
  readonly nowIso: () => string;
  readonly recordId: () => string;
}

const systemClock: RouterClock = {
  nowMs: () => performance.now(),
  nowIso: () => new Date().toISOString(),
  recordId: randomUUID,
};

export interface OperationRouter {
  readonly verifyEmail: (
    request: EmailVerificationRequest,
  ) => Effect.Effect<EmailVerificationResultWire, RoutingFailure>;
}

export const createOperationRouter = (options: {
  readonly adapters: readonly ProviderAdapter[];
  readonly profiles: readonly ProviderProfile[];
  readonly policy: SelectionPolicy;
  readonly store: ExecutionStore;
  readonly clock?: RouterClock;
}): OperationRouter => {
  const clock = options.clock ?? systemClock;
  const adapters = new Map(
    options.adapters.map((adapter) => [adapter.id, adapter]),
  );
  const fingerprintSalt = randomBytes(32);
  const requestFingerprint = (email: string): string =>
    createHash("sha256")
      .update(fingerprintSalt)
      .update(email.trim().toLowerCase(), "utf8")
      .digest("hex");

  return {
    verifyEmail: (request) =>
      Effect.gen(function* () {
        let spent = microUsd(0n);
        let totalLatencyMs = 0;
        let fallbackFromRecordId: string | null = null;
        let attempt = 0;
        const attemptedProviderIds = new Set<string>();
        let lastNonDecisive:
          | {
              readonly outcome: NormalizedProviderOutcome;
              readonly providerId: string;
            }
          | undefined;

        while (true) {
          const candidates = rankEligibleProviders(
            options.profiles,
            options.policy,
            request.constraints,
            spent,
          ).filter((profile) => {
            const adapter = adapters.get(profile.providerId);
            return (
              adapter !== undefined &&
              adapter.configured &&
              adapter.costPerAttempt === profile.costPerAttempt
            );
          });
          const profile = candidates.find(
            (candidate) => !attemptedProviderIds.has(candidate.providerId),
          );
          if (profile === undefined) {
            if (lastNonDecisive !== undefined) {
              return {
                decision: lastNonDecisive.outcome.decision,
                confidence: lastNonDecisive.outcome.confidence,
                evidence: lastNonDecisive.outcome.evidence,
                economics: {
                  costMicroUsd: serializeMoney(spent),
                  latencyMs: totalLatencyMs,
                  attempts: attempt,
                },
                execution: {
                  provider: lastNonDecisive.providerId,
                  fallbackUsed: attempt > 1,
                },
              };
            }
            return yield* Effect.fail(
              new RoutingFailure(
                attempt === 0 ? "no_eligible_provider" : "providers_exhausted",
              ),
            );
          }
          attemptedProviderIds.add(profile.providerId);
          const adapter = adapters.get(profile.providerId);
          if (adapter === undefined)
            return yield* Effect.fail(
              new RoutingFailure("no_eligible_provider"),
            );

          attempt += 1;
          const id = clock.recordId();
          const startedAt = clock.nowIso();
          const before = clock.nowMs();
          const execution = yield* Effect.either(adapter.verify(request));
          const latencyMs = Math.max(0, Math.round(clock.nowMs() - before));
          totalLatencyMs += latencyMs;
          spent = addMoney(spent, adapter.costPerAttempt);

          if (Either.isLeft(execution)) {
            const record: ExecutionRecord = {
              id,
              operation: "email_verification",
              operationVersion: 1,
              requestFingerprint: requestFingerprint(request.email),
              providerId: adapter.id,
              attempt,
              startedAt,
              latencyMs,
              costMicroUsd: serializeMoney(adapter.costPerAttempt),
              outcome: "failure",
              failureKind: execution.left.kind,
              fallbackFromRecordId,
              evaluation: { decisive: false, useful: false, correct: null },
            };
            const persisted = yield* Effect.either(
              options.store.append(record),
            );
            if (Either.isLeft(persisted))
              return yield* Effect.fail(
                new RoutingFailure("persistence_failure"),
              );
            fallbackFromRecordId = id;
            continue;
          }

          const outcome = execution.right;
          const evaluation = evaluateOutcome(
            outcome.decision,
            outcome.confidence,
          );
          const record: ExecutionRecord = {
            id,
            operation: "email_verification",
            operationVersion: 1,
            requestFingerprint: requestFingerprint(request.email),
            providerId: adapter.id,
            attempt,
            startedAt,
            latencyMs,
            costMicroUsd: serializeMoney(adapter.costPerAttempt),
            outcome: "success",
            decision: outcome.decision,
            confidence: outcome.confidence,
            mappingCode: outcome.mappingCode,
            fallbackFromRecordId,
            evaluation,
          };
          const persisted = yield* Effect.either(options.store.append(record));
          if (Either.isLeft(persisted))
            return yield* Effect.fail(
              new RoutingFailure("persistence_failure"),
            );

          if (!evaluation.decisive) {
            lastNonDecisive = { outcome, providerId: adapter.id };
            fallbackFromRecordId = id;
            continue;
          }
          return {
            decision: outcome.decision,
            confidence: outcome.confidence,
            evidence: outcome.evidence,
            economics: {
              costMicroUsd: serializeMoney(spent),
              latencyMs: totalLatencyMs,
              attempts: attempt,
            },
            execution: { provider: adapter.id, fallbackUsed: attempt > 1 },
          };
        }
      }),
  };
};
