import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ExecutionRecord } from "../src/domain/execution-record.js";
import { createJsonlExecutionStore } from "../src/persistence/execution-store.js";

const record = (id: string): ExecutionRecord => ({
  recordType: "execution",
  id,
  operation: "email_verification",
  operationVersion: 1,
  requestFingerprint: "a".repeat(64),
  providerId: "fixture",
  attempt: 1,
  startedAt: "2026-08-16T00:00:00.000Z",
  latencyMs: 10,
  costMicroUsd: "2",
  outcome: "success",
  decision: "send",
  confidence: "high",
  mappingCode: "valid",
  fallbackFromRecordId: null,
  evaluation: { decisive: true, useful: true, correct: null },
});

describe("durable execution store", () => {
  it("serializes concurrent appends, fsyncs, and restricts file permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "operation-router-store-"));
    const path = join(directory, "nested", "executions.jsonl");
    try {
      const store = createJsonlExecutionStore(path);
      await Effect.runPromise(
        store.beginAttempt({
          recordType: "attempt_intent",
          id: "one",
          operation: "email_verification",
          operationVersion: 1,
          requestFingerprint: "a".repeat(64),
          providerId: "fixture",
          attempt: 1,
          startedAt: "2026-08-16T00:00:00.000Z",
          plannedCostMicroUsd: "2",
          fallbackFromRecordId: null,
        }),
      );
      await Effect.runPromise(store.append(record("one")));
      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(
        lines.map(
          (line) => (JSON.parse(line) as { recordType: string }).recordType,
        ),
      ).toEqual(["attempt_intent", "execution"]);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
