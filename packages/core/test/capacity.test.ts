import { describe, expect, it } from "vitest";
import {
  agentLatencyInflation,
  aggregateTelemetry,
  buildCapacityCurve,
  marginalThroughputGain,
  marginalWorkerYield,
} from "../src/capacity.js";
import type { HostTelemetrySample } from "../src/models.js";

function sample(overrides: Partial<HostTelemetrySample> = {}): HostTelemetrySample {
  return {
    timestamp: "2026-08-21T00:00:00.000Z",
    elapsedMs: 0,
    totalCpuUtilization: 0.5,
    perCoreCpuUtilization: [0.9, 0.1],
    loadAverage1m: 4,
    totalMemoryBytes: 100,
    freeMemoryBytes: 10,
    parentRssBytes: 5,
    activeAgentWorkers: 2,
    eventLoopLagMs: 20,
    ...overrides,
  };
}

describe("marginal throughput calculation", () => {
  it("computes T(N) - T(previous)", () => {
    expect(marginalThroughputGain(32.5, 42.02)).toBeCloseTo(9.52, 3);
    expect(marginalThroughputGain(42.02, 56.1)).toBeCloseTo(14.08, 3);
  });

  it("returns null when either side is unmeasured", () => {
    expect(marginalThroughputGain(null, 40)).toBeNull();
    expect(marginalThroughputGain(30, null)).toBeNull();
  });
});

describe("marginal worker yield calculation", () => {
  it("normalizes gain per added worker", () => {
    expect(marginalWorkerYield(32.5, 42.02, 1, 2)).toBeCloseTo(9.52, 3);
    expect(marginalWorkerYield(42.02, 56.1, 3, 4)).toBeCloseTo(14.08, 3);
  });

  it("handles multi-worker steps", () => {
    expect(marginalWorkerYield(32.5, 56.1, 1, 4)).toBeCloseTo(23.6 / 3, 3);
  });

  it("returns null for a zero-width step", () => {
    expect(marginalWorkerYield(30, 40, 2, 2)).toBeNull();
  });
});

describe("agent latency inflation calculation", () => {
  it("computes current/base for comparable durations", () => {
    expect(agentLatencyInflation(70_114, 93_353)).toBeCloseTo(1.3314, 3);
    expect(agentLatencyInflation(80_000, 160_000)).toBe(2);
  });

  it("returns null without a usable base", () => {
    expect(agentLatencyInflation(null, 100)).toBeNull();
    expect(agentLatencyInflation(0, 100)).toBeNull();
  });
});

describe("capacity curve aggregation", () => {
  const curve = buildCapacityCurve([
    {
      workerCount: 1,
      medianTasksPerHour: 32.5,
      minTasksPerHour: 26.83,
      maxTasksPerHour: 40.52,
      acceptedTasks: 15,
      taskRuns: 18,
      medianAgentExecutionMs: 82_786,
      validationDurationMs: 270,
      raptureOverheadMs: 0,
    },
    {
      workerCount: 2,
      medianTasksPerHour: 42.02,
      minTasksPerHour: 38.81,
      maxTasksPerHour: 63.31,
      acceptedTasks: 15,
      taskRuns: 18,
      medianAgentExecutionMs: 129_031,
      validationDurationMs: 477,
      raptureOverheadMs: 0,
    },
    {
      workerCount: 3,
      medianTasksPerHour: 50,
      minTasksPerHour: 48,
      maxTasksPerHour: 52,
      acceptedTasks: 16,
      taskRuns: 18,
      medianAgentExecutionMs: 140_000,
      validationDurationMs: 700,
      raptureOverheadMs: 0,
    },
  ]);

  it("computes speedup and parallel efficiency against N=1", () => {
    const point2 = curve.points.find((point) => point.workerCount === 2);
    expect(point2?.speedup).toBeCloseTo(42.02 / 32.5, 3);
    expect(point2?.parallelEfficiency).toBeCloseTo(42.02 / (2 * 32.5), 3);
    const point3 = curve.points.find((point) => point.workerCount === 3);
    expect(point3?.parallelEfficiency).toBeCloseTo(50 / (3 * 32.5), 3);
  });

  it("reports adjacent marginal metrics including incremental worker efficiency", () => {
    expect(curve.adjacentSteps).toHaveLength(2);
    const step = curve.adjacentSteps[0];
    expect(step?.fromWorkerCount).toBe(1);
    expect(step?.toWorkerCount).toBe(2);
    expect(step?.marginalThroughputGain).toBeCloseTo(9.52, 3);
    expect(step?.marginalWorkerYield).toBeCloseTo(9.52, 3);
    // incremental efficiency of the added worker = yield / T(1)
    expect(step?.incrementalWorkerEfficiency).toBeCloseTo(9.52 / 32.5, 3);
    expect(step?.agentLatencyInflation).toBeCloseTo(129_031 / 82_786, 3);
  });

  it("computes acceptance rate and latency inflation relative to baseline and previous", () => {
    const point3 = curve.points.find((point) => point.workerCount === 3);
    expect(point3?.acceptanceRate).toBeCloseTo(16 / 18, 6);
    expect(point3?.agentLatencyInflationVsBaseline).toBeCloseTo(140_000 / 82_786, 3);
    expect(point3?.agentLatencyInflationVsPrevious).toBeCloseTo(140_000 / 129_031, 3);
  });

  it("rejects duplicate or invalid worker counts deterministically", () => {
    const base = {
      medianTasksPerHour: 10,
      minTasksPerHour: 10,
      maxTasksPerHour: 10,
      acceptedTasks: 1,
      taskRuns: 1,
      medianAgentExecutionMs: 1,
      validationDurationMs: 1,
      raptureOverheadMs: 0,
    };
    expect(() =>
      buildCapacityCurve([
        { ...base, workerCount: 2 },
        { ...base, workerCount: 2 },
      ]),
    ).toThrow(/duplicate/u);
    expect(() => buildCapacityCurve([{ ...base, workerCount: -1 }])).toThrow(/invalid/u);
  });
});

describe("telemetry aggregation", () => {
  it("summarizes CPU, memory, and load from persisted samples", () => {
    const aggregate = aggregateTelemetry([
      sample({ totalCpuUtilization: 0.5, loadAverage1m: 4, freeMemoryBytes: 20 }),
      sample({ totalCpuUtilization: 0.7, loadAverage1m: 8, freeMemoryBytes: 10 }),
      sample({ totalCpuUtilization: 0.9, loadAverage1m: 12, freeMemoryBytes: 5 }),
    ]);
    expect(aggregate).not.toBeNull();
    expect(aggregate?.sampleCount).toBe(3);
    expect(aggregate?.cpuUtilizationMean).toBeCloseTo(0.7, 6);
    expect(aggregate?.cpuUtilizationP95).toBeCloseTo(0.9, 6);
    expect(aggregate?.perCoreMaxCpuMean).toBeCloseTo(0.9, 6);
    expect(aggregate?.loadAverage1mP95).toBe(12);
    expect(aggregate?.memoryTotalBytes).toBe(100);
    expect(aggregate?.memoryUsedFractionMean).toBeCloseTo(88.33 / 100, 3);
    expect(aggregate?.memoryAvailableBytesMin).toBe(5);
    expect(aggregate?.activeAgentsMax).toBe(2);
  });

  it("returns null for an empty sample set", () => {
    expect(aggregateTelemetry([])).toBeNull();
  });
});
