import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ExecutionRecordSchema } from "../src/domain/execution-record.js";
import {
  EmailVerificationContract,
  EmailVerificationResultWireSchema,
} from "../src/operations/email-verification/contract.js";

describe("email verification OperationContract", () => {
  it("accepts only the V0 objective and bounded wire values", () => {
    expect(
      EmailVerificationContract.validateRequest({
        email: "controlled@example.test",
        objective: "safe_to_send",
        constraints: { maxCostMicroUsd: "1200", minimumConfidence: "high" },
      }).objective,
    ).toBe("safe_to_send");
    expect(() =>
      EmailVerificationContract.validateRequest({ email: "x@y", objective: "find_person" }),
    ).toThrow();
  });

  it("preserves null and unknown evidence", () => {
    const result = Schema.decodeUnknownSync(EmailVerificationResultWireSchema)({
      decision: "uncertain",
      confidence: "unknown",
      evidence: {
        syntax: "unknown",
        domain: "unknown",
        mailbox: "unknown",
        catchAll: null,
        disposable: null,
        roleBased: null,
      },
      economics: { costMicroUsd: "0", latencyMs: 0, attempts: 1 },
      execution: { provider: "fixture", fallbackUsed: false },
    });
    expect(result.evidence.mailbox).toBe("unknown");
  });
});

describe("ExecutionRecord", () => {
  it("requires an immutable-safe normalized shape and exact serialized cost", () => {
    const record = Schema.decodeUnknownSync(ExecutionRecordSchema)({
      id: "record-1",
      operation: "email_verification",
      operationVersion: 1,
      requestFingerprint: "a".repeat(64),
      providerId: "hunter",
      attempt: 1,
      startedAt: "2026-08-16T00:00:00.000Z",
      latencyMs: 12,
      costMicroUsd: "42",
      outcome: "success",
      decision: "uncertain",
      confidence: "unknown",
      mappingCode: "unknown",
      fallbackFromRecordId: null,
      evaluation: { decisive: false, useful: false, correct: null },
    });
    expect(record.costMicroUsd).toBe("42");
    expect(() =>
      Schema.decodeUnknownSync(ExecutionRecordSchema)({ ...record, costMicroUsd: "0.1" }),
    ).toThrow();
  });
});
