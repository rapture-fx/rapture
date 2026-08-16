import * as Schema from "effect/Schema";
import type { OperationContract } from "../../domain/operation-contract.js";
import type { MicroUsd } from "../../domain/money.js";

export const EvidenceValueSchema = Schema.Literal(
  "valid",
  "invalid",
  "unknown",
);
export const DomainEvidenceSchema = Schema.Literal(
  "reachable",
  "unreachable",
  "unknown",
);
export const MailboxEvidenceSchema = Schema.Literal(
  "exists",
  "missing",
  "unknown",
);
export const ConfidenceSchema = Schema.Literal(
  "high",
  "medium",
  "low",
  "unknown",
);
export const DecisionSchema = Schema.Literal(
  "send",
  "do_not_send",
  "uncertain",
);

export type Confidence = typeof ConfidenceSchema.Type;
export type Decision = typeof DecisionSchema.Type;

export interface EmailVerificationConstraints {
  readonly maxCost?: MicroUsd;
  readonly maxLatencyMs?: number;
  readonly minimumConfidence?: Exclude<Confidence, "unknown">;
}

export interface EmailVerificationRequest {
  readonly email: string;
  readonly objective: "safe_to_send";
  readonly constraints?: EmailVerificationConstraints;
}

export const EmailVerificationRequestWireSchema = Schema.Struct({
  email: Schema.String.pipe(Schema.minLength(3), Schema.maxLength(320)),
  objective: Schema.Literal("safe_to_send"),
  constraints: Schema.optional(
    Schema.Struct({
      maxCostMicroUsd: Schema.optional(
        Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]*)$/)),
      ),
      maxLatencyMs: Schema.optional(Schema.Int.pipe(Schema.positive())),
      minimumConfidence: Schema.optional(
        Schema.Literal("high", "medium", "low"),
      ),
    }),
  ),
});

export const CanonicalEvidenceSchema = Schema.Struct({
  syntax: EvidenceValueSchema,
  domain: DomainEvidenceSchema,
  mailbox: MailboxEvidenceSchema,
  catchAll: Schema.NullOr(Schema.Boolean),
  disposable: Schema.NullOr(Schema.Boolean),
  roleBased: Schema.NullOr(Schema.Boolean),
});

export const EmailVerificationResultWireSchema = Schema.Struct({
  decision: DecisionSchema,
  confidence: ConfidenceSchema,
  evidence: CanonicalEvidenceSchema,
  economics: Schema.Struct({
    costMicroUsd: Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]*)$/)),
    latencyMs: Schema.Int.pipe(Schema.nonNegative()),
    attempts: Schema.Int.pipe(Schema.nonNegative()),
  }),
  execution: Schema.Struct({
    provider: Schema.String,
    fallbackUsed: Schema.Boolean,
  }),
});

export type CanonicalEvidence = typeof CanonicalEvidenceSchema.Type;
export type EmailVerificationResultWire =
  typeof EmailVerificationResultWireSchema.Type;

export const EmailVerificationContract: OperationContract<
  "email_verification",
  typeof EmailVerificationRequestWireSchema.Type,
  EmailVerificationResultWire
> = {
  name: "email_verification",
  version: 1,
  validateRequest: Schema.decodeUnknownSync(EmailVerificationRequestWireSchema),
  validateResult: Schema.decodeUnknownSync(EmailVerificationResultWireSchema),
};
