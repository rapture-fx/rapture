import { describe, expect, it } from "vitest";
import type { CapacityPointInput } from "../src/capacity.js";
import { buildCapacityCurve } from "../src/capacity.js";
import {
  BASELINE_CPU_SATURATION_FRACTION,
  BASELINE_MEMORY_PRESSURE_FRACTION,
  classifyObservedOutcome,
  cpuOnlyBaseline,
  evaluatePredictions,
  fixedConcurrencyBaseline,
  memoryOnlyBaseline,
  rapturePredictor,
  runAllPredictors,
  simpleResourceBaseline,
} from "../src/predictors.js";

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

function resources(cpu: number | null, memory: number | null) {
  return {
    sampleCount: 10,
    cpuUtilizationMean: cpu,
    cpuUtilizationP95: null,
    perCoreMaxCpuMean: null,
    perCoreMaxCpuP95: null,
    loadAverage1mMean: null,
    loadAverage1mP95: null,
    memoryUsedBytesMean: memory === null ? null : memory * 8_589_934_592,
    memoryAvailableBytesMin: memory === null ? null : (1 - memory) * 8_589_934_592,
    memoryTotalBytes: 8_589_934_592,
    memoryUsedFractionMean: memory,
    activeAgentsMax: 4,
  };
}

describe("baseline predictor behavior", () => {
  it("fixed-concurrency baseline always predicts PRODUCTIVE regardless of measurements", () => {
    const curve = buildCapacityCurve([point(1, 30), point(2, 30.1)], { 2: resources(1, 1) });
    const prediction = fixedConcurrencyBaseline({ curveSoFar: curve, targetWorkerCount: 3 });
    expect(prediction.predictedState).toBe("PRODUCTIVE");
    expect(prediction.predictor.id).toBe("fixed-concurrency");
  });

  it("cpu-only baseline predicts saturation only above the CPU threshold", () => {
    const calm = buildCapacityCurve([point(1, 30), point(2, 40)], { 2: resources(0.6, 0.5) });
    expect(cpuOnlyBaseline({ curveSoFar: calm, targetWorkerCount: 3 }).predictedState).toBe(
      "PRODUCTIVE",
    );
    const hot = buildCapacityCurve([point(1, 30), point(2, 33)], {
      2: resources(BASELINE_CPU_SATURATION_FRACTION, 0.5),
    });
    expect(cpuOnlyBaseline({ curveSoFar: hot, targetWorkerCount: 3 }).predictedState).toBe(
      "SATURATING",
    );
  });

  it("memory-only baseline reacts to memory pressure only", () => {
    const calm = buildCapacityCurve([point(1, 30)], { 1: resources(0.99, 0.5) });
    expect(memoryOnlyBaseline({ curveSoFar: calm, targetWorkerCount: 2 }).predictedState).toBe(
      "PRODUCTIVE",
    );
    const pressured = buildCapacityCurve([point(1, 30)], {
      1: resources(0.3, BASELINE_MEMORY_PRESSURE_FRACTION),
    });
    expect(memoryOnlyBaseline({ curveSoFar: pressured, targetWorkerCount: 2 }).predictedState).toBe(
      "SATURATING",
    );
  });

  it("cpu+memory baseline saturates when either resource crosses its threshold", () => {
    const cpuHot = buildCapacityCurve([point(1, 30)], { 1: resources(0.99, 0.5) });
    expect(
      simpleResourceBaseline({ curveSoFar: cpuHot, targetWorkerCount: 2 }).predictedState,
    ).toBe("SATURATING");
    const bothHot = buildCapacityCurve([point(1, 30)], {
      1: resources(BASELINE_CPU_SATURATION_FRACTION, BASELINE_MEMORY_PRESSURE_FRACTION),
    });
    expect(
      simpleResourceBaseline({ curveSoFar: bothHot, targetWorkerCount: 2 }).predictedState,
    ).toBe("DIMINISHING_RETURNS");
  });

  it("resource baselines ignore throughput and agent latency entirely", () => {
    // Same resources but wildly different engineering outcomes: identical verdicts.
    const good = buildCapacityCurve([point(1, 10), point(2, 60)], { 2: resources(0.99, 0.99) });
    const bad = buildCapacityCurve(
      [
        point(1, 60, { medianAgentExecutionMs: 50_000 }),
        point(2, 10, { medianAgentExecutionMs: 500_000 }),
      ],
      { 2: resources(0.99, 0.99) },
    );
    expect(cpuOnlyBaseline({ curveSoFar: good, targetWorkerCount: 3 }).predictedState).toEqual(
      cpuOnlyBaseline({ curveSoFar: bad, targetWorkerCount: 3 }).predictedState,
    );
  });
});

describe("rapture predictor", () => {
  it("predicts PRODUCTIVE while marginal gains stay strong", () => {
    const curve = buildCapacityCurve(
      [
        point(1, 32.5, { medianAgentExecutionMs: 80_000 }),
        point(2, 45, { medianAgentExecutionMs: 90_000 }),
      ],
      { 2: resources(0.7, 0.8) },
    );
    expect(rapturePredictor({ curveSoFar: curve, targetWorkerCount: 3 }).predictedState).toBe(
      "PRODUCTIVE",
    );
  });

  it("predicts DIMINISHING_RETURNS on collapsed gain with efficiency collapse", () => {
    const curve = buildCapacityCurve(
      [
        point(1, 30),
        point(2, 31, { medianAgentExecutionMs: 80_000 }),
        point(3, 31.1, { medianAgentExecutionMs: 110_000 }),
      ],
      { 3: resources(0.7, 0.8) },
    );
    const prediction = rapturePredictor({ curveSoFar: curve, targetWorkerCount: 4 });
    expect(prediction.predictedState).toBe("DIMINISHING_RETURNS");
    expect(prediction.confidence === "high" || prediction.confidence === "medium").toBe(true);
  });

  it("predicts SATURATING for low-but-positive gain without collapse or latency", () => {
    const curve = buildCapacityCurve(
      [
        point(1, 30, { medianAgentExecutionMs: 100_000 }),
        point(2, 54, { medianAgentExecutionMs: 101_000 }),
        point(3, 60, { medianAgentExecutionMs: 102_000 }),
      ],
      { 3: resources(0.92, 0.96) },
    );
    // Last step: +11% gain (below threshold) but E(3)=0.667 stays above the
    // floor and latency inflation is only 1.02x, so this is saturation, not
    // diminishing returns.
    const prediction = rapturePredictor({ curveSoFar: curve, targetWorkerCount: 4 });
    expect(prediction.predictedState).toBe("SATURATING");
  });

  it("falls back to acceptance evidence with a single observed worker count", () => {
    const healthy = buildCapacityCurve([point(1, 30)]);
    expect(rapturePredictor({ curveSoFar: healthy, targetWorkerCount: 2 }).predictedState).toBe(
      "PRODUCTIVE",
    );
  });

  it("runs every predictor for a step and keeps their identities distinct", () => {
    const curve = buildCapacityCurve([point(1, 30), point(2, 44)], { 2: resources(0.6, 0.6) });
    const predictions = runAllPredictors({ curveSoFar: curve, targetWorkerCount: 3 });
    expect(predictions.map((prediction) => prediction.predictor.id)).toEqual([
      "fixed-concurrency",
      "cpu-only",
      "memory-only",
      "cpu-memory",
      "rapture",
    ]);
  });
});

describe("observed outcome classification and evaluation", () => {
  const curve = buildCapacityCurve([point(1, 30), point(2, 40), point(3, 42)]);

  it("classifies productive and weak-marginal steps from persisted aggregates", () => {
    expect(classifyObservedOutcome(curve, 2).outcomeClass).toBe("productive");
    expect(classifyObservedOutcome(curve, 2).marginalThroughputGainFraction).toBeCloseTo(1 / 3, 6);
    expect(classifyObservedOutcome(curve, 3).outcomeClass).toBe("weak-marginal");
  });

  it("scores predictions against held-out outcomes without significance claims", () => {
    const predictions = runAllPredictors({
      curveSoFar: buildCapacityCurve([point(1, 30)]),
      targetWorkerCount: 2,
    });
    const evaluation = evaluatePredictions(predictions, [classifyObservedOutcome(curve, 2)]);
    const fixed = evaluation.find((item) => item.predictorId === "fixed-concurrency");
    const others = evaluation.filter((item) => item.predictorId !== "fixed-concurrency");
    expect(fixed?.correctSteps).toBe(1);
    expect(fixed?.agreementFraction).toBe(1);
    // The other predictors predicted PRODUCTIVE from N=1 evidence too.
    for (const item of others) {
      expect(item.correctSteps).toBe(item.evaluableSteps);
    }
  });

  it("never scores INSUFFICIENT_EVIDENCE or unresolved outcomes as correct", () => {
    const predictions = runAllPredictors({
      curveSoFar: buildCapacityCurve([]),
      targetWorkerCount: 2,
    });
    const evaluation = evaluatePredictions(predictions, []);
    expect(evaluation.every((item) => item.evaluableSteps === 0)).toBe(true);
  });
});
