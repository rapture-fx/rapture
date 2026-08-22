import { describe, expect, it } from "vitest";
import type { CapacityPointInput } from "../src/capacity.js";
import { buildCapacityCurve } from "../src/capacity.js";
import { simulateControllerStop } from "../src/counterfactual.js";

function point(
  workerCount: number,
  medianTasksPerHour: number,
  agentMs: number,
): CapacityPointInput {
  return {
    workerCount,
    medianTasksPerHour,
    minTasksPerHour: medianTasksPerHour,
    maxTasksPerHour: medianTasksPerHour,
    acceptedTasks: 18,
    taskRuns: 18,
    medianAgentExecutionMs: agentMs,
    validationDurationMs: 300,
    raptureOverheadMs: 0,
  };
}

describe("counterfactual controller simulation", () => {
  const curve = buildCapacityCurve([
    point(1, 32.5, 80_000),
    point(2, 42.02, 120_000),
    point(4, 56.1, 160_000),
  ]);

  it("is explicitly labelled as a retrospective simulation", () => {
    const simulation = simulateControllerStop(curve, 2, 100);
    expect(simulation.label).toBe("retrospective-simulation");
  });

  it("computes wall time and throughput from persisted medians", () => {
    const simulation = simulateControllerStop(curve, 2, 84);
    expect(simulation.throughputAtStopWorkers).toBeCloseTo(42.02, 3);
    expect(simulation.throughputAtMaxWorkers).toBeCloseTo(56.1, 3);
    expect(simulation.estimatedWallHoursAtStopWorkers).toBeCloseTo(84 / 42.02, 6);
    expect(simulation.estimatedWallHoursAtMaxWorkers).toBeCloseTo(84 / 56.1, 6);
    expect(simulation.wallTimeReductionFraction).not.toBeNull();
  });

  it("computes aggregate agent execution time and worker occupancy", () => {
    const simulation = simulateControllerStop(curve, 2, 84);
    // 84 tasks x 120 s of measured agent execution each
    expect(simulation.aggregateAgentExecutionMsAtStopWorkers).toBe(84 * 120_000);
    const stopWallHours = simulation.estimatedWallHoursAtStopWorkers;
    expect(stopWallHours).not.toBeNull();
    const occupancy = simulation.workerOccupancyAtStopWorkers;
    expect(occupancy).not.toBeNull();
    // occupancy = agent seconds / (workers x wall seconds)
    expect(occupancy).toBeCloseTo((84 * 120) / (2 * (stopWallHours ?? 1) * 3600), 5);
  });

  it("rejects concurrency levels that were never observed", () => {
    expect(() => simulateControllerStop(curve, 3, 84)).toThrow(/observed/u);
  });
});
