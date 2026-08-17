import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveMetrics, median } from "../src/metrics.js";
import { incompletePhaseTimings } from "../src/timing.js";

function event(sequence: number, eventType: string, timestamp: string, data: object): object {
  return {
    schemaVersion: 1,
    sequence,
    eventType,
    experimentId: "experiment-1",
    timestamp,
    data,
  };
}

function phaseTimings(agentMs: number, validationMs: number, totalMs: number) {
  return {
    worktreeSetupMs: 5,
    agentExecutionMs: agentMs,
    validationMs,
    integrationMs: null,
    worktreeCleanupMs: 5,
    totalRunMs: totalMs,
  };
}

async function writeEvents(events: object[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rapture-metrics-"));
  const path = join(root, "events.jsonl");
  await writeFile(path, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return path;
}

describe("metrics", () => {
  it("derives speedup and parallel efficiency from persisted events", async () => {
    const events: object[] = [];
    let sequence = 0;
    for (const [workers, accepted] of [
      [1, 1],
      [2, 2],
    ] as const) {
      events.push(
        event(++sequence, "task_started", "2026-01-01T00:00:00.000Z", {
          workerCount: workers,
        }),
      );
      for (let index = 0; index < accepted; index += 1) {
        events.push(
          event(++sequence, "task_finished", "2026-01-01T01:00:00.000Z", {
            workerCount: workers,
            accepted: true,
            durationMs: 100,
            validationResult: "passed",
            commands: [["node", "--test"]],
            testInvocations: [["node", "--test"]],
            buildInvocations: [],
            tokenUsage: null,
            providerCost: null,
          }),
        );
      }
    }
    const metrics = await deriveMetrics(await writeEvents(events));
    expect(metrics.schemaVersion).toBe(2);
    expect(metrics.workerResults[0]?.acceptedTasksPerHour).toBe(1);
    expect(metrics.workerResults[1]?.speedup).toBe(2);
    expect(metrics.workerResults[1]?.parallelEfficiency).toBe(1);
    expect(metrics.workerResults[1]?.duplicateTestInvocations).toBe(1);
    expect(metrics.workerResults[1]?.tokenUsagePerAcceptedTask).toBeNull();
    expect(metrics.workerResults[1]?.providerCost).toBeNull();
  });

  it("aggregates repeated trials without merging their throughputs first", async () => {
    const events: object[] = [];
    let sequence = 0;
    const rows = [
      { workers: 1, repetition: 1, accepted: 2, durationMs: 3_600_000 },
      { workers: 1, repetition: 2, accepted: 1, durationMs: 3_600_000 },
      { workers: 1, repetition: 3, accepted: 2, durationMs: 1_800_000 },
      { workers: 2, repetition: 1, accepted: 2, durationMs: 1_800_000 },
      { workers: 2, repetition: 2, accepted: 2, durationMs: 1_800_000 },
      { workers: 2, repetition: 3, accepted: 2, durationMs: 1_200_000 },
    ];
    for (const row of rows) {
      const trialId = `workers-${row.workers}-trial-${row.repetition}`;
      events.push(
        event(++sequence, "trial_started", "2026-01-01T00:00:00.000Z", {
          trialId,
          workerCount: row.workers,
          repetition: row.repetition,
          trialSeed: 9,
          taskOrder: ["one", "two"],
        }),
      );
      for (let index = 0; index < 2; index += 1) {
        events.push(
          event(++sequence, "task_finished", "2026-01-01T00:30:00.000Z", {
            trialId,
            repetition: row.repetition,
            workerCount: row.workers,
            accepted: index < row.accepted,
            durationMs: 200,
            validationResult: index < row.accepted ? "passed" : "failed",
            commands: [["node", "--test"]],
            testInvocations: [["node", "--test"]],
            buildInvocations: [],
            tokenUsage: null,
            providerCost: null,
            phaseTimings: phaseTimings(80, 20, 200),
          }),
        );
      }
      events.push(
        event(++sequence, "trial_finished", "2026-01-01T01:00:00.000Z", {
          trialId,
          workerCount: row.workers,
          repetition: row.repetition,
          trialSeed: 9,
          taskOrder: ["one", "two"],
          durationMs: row.durationMs,
          status: "completed",
        }),
      );
    }
    const metrics = await deriveMetrics(await writeEvents(events));
    const one = metrics.workerResults[0];
    const two = metrics.workerResults[1];
    expect(one?.trialCount).toBe(3);
    expect(one?.acceptedTasksPerHourPerTrial).toEqual([2, 1, 4]);
    expect(one?.medianAcceptedTasksPerHour).toBe(2);
    expect(one?.minAcceptedTasksPerHour).toBe(1);
    expect(one?.maxAcceptedTasksPerHour).toBe(4);
    expect(two?.acceptedTasksPerHourPerTrial).toEqual([4, 4, 6]);
    expect(two?.medianAcceptedTasksPerHour).toBe(4);
    expect(two?.speedup).toBe(2);
    expect(two?.parallelEfficiency).toBe(1);
    expect(two?.pairedSpeedups).toEqual([2, 4, 1.5]);
    expect(metrics.trialResults).toHaveLength(6);
  });

  it("computes median throughput, speedup, and efficiency from raw trial values", () => {
    expect(median([1, 4, 2])).toBe(2);
    expect(median([2, 4])).toBe(3);
    const medianT1 = 2;
    const medianT2 = 3;
    expect(medianT2 / medianT1).toBe(1.5);
    expect(medianT2 / (2 * medianT1)).toBe(0.75);
  });

  it("keeps incomplete phase timings as null instead of zero", async () => {
    const incomplete = incompletePhaseTimings(15);
    const events = [
      event(1, "trial_started", "2026-01-01T00:00:00.000Z", {
        trialId: "workers-1-trial-1",
        workerCount: 1,
        repetition: 1,
        trialSeed: 1,
        taskOrder: ["one"],
      }),
      event(2, "task_finished", "2026-01-01T00:00:01.000Z", {
        trialId: "workers-1-trial-1",
        repetition: 1,
        workerCount: 1,
        accepted: false,
        durationMs: 15,
        validationResult: "not_run",
        commands: [],
        testInvocations: [],
        buildInvocations: [],
        tokenUsage: null,
        providerCost: null,
        phaseTimings: incomplete,
      }),
      event(3, "trial_finished", "2026-01-01T00:00:01.000Z", {
        trialId: "workers-1-trial-1",
        workerCount: 1,
        repetition: 1,
        durationMs: 15,
        status: "failed",
      }),
    ];
    const metrics = await deriveMetrics(await writeEvents(events));
    expect(metrics.trialResults[0]?.medianAgentExecutionMs).toBeNull();
    expect(metrics.trialResults[0]?.medianValidationMs).toBeNull();
    expect(metrics.trialResults[0]?.medianRaptureOverheadMs).toBeNull();
    expect(metrics.workerResults[0]?.tokenUsage).toBeNull();
  });
});
