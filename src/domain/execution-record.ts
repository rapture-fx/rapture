import * as Schema from "effect/Schema";

export const ExecutionRecordSchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.Literal("email_verification"),
  operationVersion: Schema.Literal(1),
  requestFingerprint: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  providerId: Schema.String,
  attempt: Schema.Int.pipe(Schema.positive()),
  startedAt: Schema.String,
  latencyMs: Schema.Int.pipe(Schema.nonNegative()),
  costMicroUsd: Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]*)$/)),
  outcome: Schema.Literal("success", "failure"),
  decision: Schema.optional(Schema.Literal("send", "do_not_send", "uncertain")),
  confidence: Schema.optional(
    Schema.Literal("high", "medium", "low", "unknown"),
  ),
  mappingCode: Schema.optional(Schema.String),
  failureKind: Schema.optional(
    Schema.Literal(
      "authentication_failure",
      "rate_limit",
      "provider_timeout",
      "transport_failure",
      "provider_malformed_response",
    ),
  ),
  fallbackFromRecordId: Schema.NullOr(Schema.String),
  evaluation: Schema.Struct({
    decisive: Schema.Boolean,
    useful: Schema.Boolean,
    groundTruth: Schema.optional(Schema.Literal("send", "do_not_send")),
    correct: Schema.NullOr(Schema.Boolean),
  }),
});

export type ExecutionRecord = typeof ExecutionRecordSchema.Type;
