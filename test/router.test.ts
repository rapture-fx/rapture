import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { microUsd } from "../src/domain/money.js";
import type {
  NormalizedProviderOutcome,
  ProviderAdapter,
} from "../src/domain/provider-adapter.js";
import type { ProviderProfile } from "../src/economics/provider-profile.js";
import {
  createInMemoryExecutionStore,
  PersistenceFailure,
  type ExecutionStore,
} from "../src/persistence/execution-store.js";
import { verifyEmail } from "../src/operations/email-verification/verify-email.js";
import {
  createOperationRouter,
  type RouterClock,
} from "../src/routing/operation-router.js";

const evidence: NormalizedProviderOutcome["evidence"] = {
  syntax: "valid",
  domain: "reachable",
  mailbox: "unknown",
  catchAll: null,
  disposable: false,
  roleBased: false,
};

const adapter = (
  id: string,
  cost: bigint,
  outcome: NormalizedProviderOutcome,
): ProviderAdapter => ({
  id,
  configured: true,
  costPerAttempt: microUsd(cost),
  verify: () => Effect.succeed(outcome),
});

const profile = (id: string, cost: bigint): ProviderProfile => ({
  providerId: id,
  configured: true,
  healthy: true,
  supportsCanonicalSemantics: true,
  costPerAttempt: microUsd(cost),
  latencySampleSize: 20,
  p95LatencyMs: 50,
  calibrationAttempts: 20,
  calibrationUsefulOutcomes: 10,
});

const clock = (): RouterClock => {
  let tick = 0;
  let id = 0;
  return {
    nowMs: () => (tick += 7),
    nowIso: () => "2026-08-16T00:00:00.000Z",
    recordId: () => `record-${++id}`,
  };
};

const request = {
  email: "controlled@example.test",
  objective: "safe_to_send" as const,
};

describe("OperationRouter", () => {
  it("falls back only after uncertainty and accounts for every attempt", async () => {
    const store = createInMemoryExecutionStore();
    const first = adapter("first", 3n, {
      decision: "uncertain",
      confidence: "low",
      evidence: { ...evidence, catchAll: true },
      mappingCode: "catch-all",
    });
    const second = adapter("second", 5n, {
      decision: "send",
      confidence: "high",
      evidence: { ...evidence, mailbox: "exists" },
      mappingCode: "valid",
    });
    const router = createOperationRouter({
      adapters: [first, second],
      profiles: [profile("first", 3n), profile("second", 5n)],
      policy: {
        calibrationId: "fixture",
        orderedProviderIds: ["first", "second"],
        minimumLatencySamples: 10,
      },
      store,
      clock: clock(),
    });
    const result = await Effect.runPromise(router.verifyEmail(request));
    expect(result).toMatchObject({
      decision: "send",
      economics: { costMicroUsd: "8", latencyMs: 14, attempts: 2 },
      execution: { provider: "second", fallbackUsed: true },
    });
    expect(store.records).toHaveLength(2);
    expect(store.records[1]?.fallbackFromRecordId).toBe("record-1");
    expect(store.records.map((record) => record.costMicroUsd)).toEqual([
      "3",
      "5",
    ]);
  });

  it("returns honest uncertainty when remaining budget prevents fallback", async () => {
    const store = createInMemoryExecutionStore();
    const router = createOperationRouter({
      adapters: [
        adapter("first", 3n, {
          decision: "uncertain",
          confidence: "low",
          evidence,
          mappingCode: "unknown",
        }),
        adapter("second", 5n, {
          decision: "send",
          confidence: "high",
          evidence,
          mappingCode: "valid",
        }),
      ],
      profiles: [profile("first", 3n), profile("second", 5n)],
      policy: {
        calibrationId: "fixture",
        orderedProviderIds: ["first", "second"],
        minimumLatencySamples: 10,
      },
      store,
      clock: clock(),
    });
    const result = await Effect.runPromise(
      router.verifyEmail({
        ...request,
        constraints: { maxCost: microUsd(7n) },
      }),
    );
    expect(result).toMatchObject({
      decision: "uncertain",
      economics: { costMicroUsd: "3", attempts: 1 },
    });
    expect(store.records).toHaveLength(1);
  });

  it("fails rather than claim success if paid-attempt persistence fails", async () => {
    const failedStore: ExecutionStore = {
      append: () => Effect.fail(new PersistenceFailure()),
    };
    const router = createOperationRouter({
      adapters: [
        adapter("first", 3n, {
          decision: "send",
          confidence: "high",
          evidence,
          mappingCode: "valid",
        }),
      ],
      profiles: [profile("first", 3n)],
      policy: {
        calibrationId: "fixture",
        orderedProviderIds: ["first"],
        minimumLatencySamples: 10,
      },
      store: failedStore,
      clock: clock(),
    });
    const exit = await Effect.runPromiseExit(router.verifyEmail(request));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("persistence_failure");
  });

  it("short-circuits invalid syntax without a billable attempt", async () => {
    const store = createInMemoryExecutionStore();
    const router = createOperationRouter({
      adapters: [],
      profiles: [],
      policy: {
        calibrationId: "fixture",
        orderedProviderIds: [],
        minimumLatencySamples: 10,
      },
      store,
    });
    const result = await Effect.runPromise(
      verifyEmail(router, { email: "not-an-email", objective: "safe_to_send" }),
    );
    expect(result).toMatchObject({
      decision: "do_not_send",
      economics: { costMicroUsd: "0", attempts: 0 },
      execution: { provider: "local_syntax" },
    });
    expect(store.records).toHaveLength(0);
  });
});
