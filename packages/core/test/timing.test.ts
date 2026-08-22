import { describe, expect, it } from "vitest";
import type { PhaseTimings } from "../src/models.js";
import { incompletePhaseTimings, raptureOverheadMs, timePhase } from "../src/timing.js";

describe("phase timing", () => {
  it("measures an explicit monotonic duration", async () => {
    const timed = await timePhase(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "ok";
    });
    expect(timed.value).toBe("ok");
    expect(timed.durationMs).toBeGreaterThanOrEqual(15);
  });

  it("serializes complete phase timings without inferring missing work", () => {
    const timings: PhaseTimings = {
      worktreeSetupMs: 10,
      queueWaitMs: 4,
      agentExecutionMs: 40,
      validationMs: 15,
      artifactPersistenceMs: 3,
      integrationMs: null,
      worktreeCleanupMs: 5,
      otherOrchestrationMs: null,
      totalRunMs: 80,
    };
    expect(raptureOverheadMs(timings)).toBe(3);
  });

  it("treats incomplete agent or validation phases as missing overhead", () => {
    const incomplete = incompletePhaseTimings(12);
    expect(incomplete.agentExecutionMs).toBeNull();
    expect(incomplete.validationMs).toBeNull();
    expect(incomplete.integrationMs).toBeNull();
    expect(raptureOverheadMs(incomplete)).toBeNull();
  });

  it("does not convert a missing integration phase into invented agent time", () => {
    const timings: PhaseTimings = {
      worktreeSetupMs: 4,
      queueWaitMs: 2,
      agentExecutionMs: 10,
      validationMs: 6,
      artifactPersistenceMs: 1,
      integrationMs: null,
      worktreeCleanupMs: 3,
      otherOrchestrationMs: null,
      totalRunMs: 24,
    };
    expect(raptureOverheadMs(timings)).toBe(0);
  });
});
