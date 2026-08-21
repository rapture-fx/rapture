import { describe, expect, it } from "vitest";
import type { CapacityPointInput } from "../src/capacity.js";
import { buildCapacityCurve } from "../src/capacity.js";
import {
  DEFAULT_KNEE_THRESHOLDS,
  detectCapacityKnee,
  type KneeDetectorThresholds,
} from "../src/knee.js";

function point(
  workerCount: number,
  medianTasksPerHour: number,
  overrides: Partial<CapacityPointInput> = {},
): CapacityPointInput {
  return {
    workerCount,
    medianTasksPerHour,
    minTasksPerHour: medianTasksPerHour,
    maxTasksPerHour: medianTasksPerHour,
    acceptedTasks: 18,
    taskRuns: 18,
    medianAgentExecutionMs: 80_000,
    validationDurationMs: 300,
    raptureOverheadMs: 0,
    ...overrides,
  };
}

const SATURATING_RESOURCES = (cpu: number, memory: number) => ({
  sampleCount: 10,
  cpuUtilizationMean: cpu,
  cpuUtilizationP95: Math.min(1, cpu + 0.05),
  perCoreMaxCpuMean: Math.min(1, cpu + 0.1),
  perCoreMaxCpuP95: 1,
  loadAverage1mMean: 8,
  loadAverage1mP95: 12,
  memoryUsedBytesMean: memory * 8_589_934_592,
  memoryAvailableBytesMin: (1 - memory) * 8_589_934_592,
  memoryTotalBytes: 8_589_934_592,
  memoryUsedFractionMean: memory,
  activeAgentsMax: 4,
});

describe("knee detector deterministic behavior", () => {
  it("is deterministic for identical inputs", () => {
    const inputs = [point(1, 32.5), point(2, 42.02), point(3, 43.5), point(4, 44), point(5, 44.2)];
    const curveA = buildCapacityCurve(inputs);
    const curveB = buildCapacityCurve([...inputs].reverse());
    expect(detectCapacityKnee(curveA)).toEqual(detectCapacityKnee(curveB));
  });

  it("returns INSUFFICIENT_EVIDENCE with fewer than two points", () => {
    const detection = detectCapacityKnee(buildCapacityCurve([point(1, 30)]));
    expect(detection.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(detection.candidateKnee).toBeNull();
    expect(detection.reasons.length).toBeGreaterThan(0);
  });

  it("returns NO_KNEE when marginal gains remain strong", () => {
    const detection = detectCapacityKnee(
      buildCapacityCurve([point(1, 30), point(2, 55), point(3, 82)]),
    );
    expect(detection.status).toBe("NO_KNEE_IN_MEASURED_RANGE");
    expect(detection.candidateKnee).toBeNull();
  });

  it("detects the knee after gains collapse with latency support", () => {
    const detection = detectCapacityKnee(
      buildCapacityCurve([
        point(1, 32.5, { medianAgentExecutionMs: 80_000 }),
        point(2, 42.02, { medianAgentExecutionMs: 100_000 }),
        // gain collapses to ~2% and latency inflates past the threshold
        point(3, 42.9, { medianAgentExecutionMs: 130_000 }),
      ]),
    );
    expect(detection.status).toBe("KNEE_DETECTED");
    expect(detection.candidateKnee).toBe(2);
    expect(detection.reasons.join(" ")).toMatch(/marginal gain/u);
    expect(detection.steps.every((step) => step.signals.lowMarginalGain !== null)).toBe(true);
  });

  it("requires cost-signal support, not just one weak step", () => {
    // 1% marginal gain at 4->5 with flat latency and parallel efficiency
    // still above the floor: no cost signal supports a knee.
    const detection = detectCapacityKnee(
      buildCapacityCurve([
        point(1, 30, { medianAgentExecutionMs: 100_000 }),
        point(4, 100, { medianAgentExecutionMs: 100_000 }),
        point(5, 101, { medianAgentExecutionMs: 100_500 }),
      ]),
    );
    expect(detection.status).toBe("NO_KNEE_IN_MEASURED_RANGE");
  });

  it("preserves conflicting evidence instead of requiring agreement", () => {
    const detection = detectCapacityKnee(
      buildCapacityCurve([point(1, 30), point(2, 31.5), point(3, 31.6)], {
        2: SATURATING_RESOURCES(0.95, 0.96),
        3: SATURATING_RESOURCES(0.95, 0.96),
      }),
    );
    expect(detection.status).toBe("KNEE_DETECTED");
    const lowGainStep = detection.steps.find((step) => step.workerCount === 2);
    expect(lowGainStep?.signals.cpuSaturation).toBe(true);
    expect(lowGainStep?.signals.memoryPressure).toBe(true);
    expect(lowGainStep?.signals.efficiencyCollapse).toBe(true);
  });

  it("exposes named thresholds and honors configuration changes", () => {
    const custom: KneeDetectorThresholds = {
      ...DEFAULT_KNEE_THRESHOLDS,
      lowMarginalGainFraction: 0.01,
    };
    // 10% then ~0.6% marginal gain: under the default 15% threshold BOTH
    // steps are low-gain, so the knee is detected after N=1; under a 1%
    // threshold only the second step is low-gain, moving the knee to N=2.
    const curve = buildCapacityCurve([point(1, 30), point(2, 33), point(3, 33.2)]);
    const strict = detectCapacityKnee(curve);
    const lenient = detectCapacityKnee(curve, custom);
    expect(strict.thresholds).toEqual(DEFAULT_KNEE_THRESHOLDS);
    expect(lenient.thresholds.lowMarginalGainFraction).toBe(0.01);
    expect(strict.status).toBe("KNEE_DETECTED");
    expect(strict.candidateKnee).toBe(1);
    expect(lenient.status).toBe("KNEE_DETECTED");
    expect(lenient.candidateKnee).toBe(2);
  });
});
