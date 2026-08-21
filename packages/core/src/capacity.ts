import { percentile } from "./metrics.js";
import type { HostTelemetrySample } from "./models.js";

/**
 * Capacity-curve primitives.
 *
 * Every quantity below has an explicit formula and is derived only from
 * persisted aggregate measurements. Nothing here fits, learns, or adapts.
 *
 * Definitions:
 * - observed_throughput T(N): accepted engineering tasks divided by trial
 *   wall-clock time (tasks/hour), summarized as a median across trials.
 * - speedup S(N) = T(N) / T(1).
 * - parallel_efficiency E(N) = T(N) / (N * T(1)).
 * - marginal_throughput_gain(N, P) = T(N) - T(P) for the previously tested
 *   worker count P.
 * - marginal_worker_yield(N, P) = (T(N) - T(P)) / (N - P): additional accepted
 *   throughput attributable to each added worker between adjacent tested
 *   concurrency levels.
 * - agent_latency_inflation(base, current) = current / base for comparable
 *   task agent-execution durations.
 */

export interface CapacityResourceAggregate {
  readonly sampleCount: number;
  readonly cpuUtilizationMean: number | null;
  readonly cpuUtilizationP95: number | null;
  readonly perCoreMaxCpuMean: number | null;
  readonly perCoreMaxCpuP95: number | null;
  readonly loadAverage1mMean: number | null;
  readonly loadAverage1mP95: number | null;
  readonly memoryUsedBytesMean: number | null;
  readonly memoryAvailableBytesMin: number | null;
  readonly memoryTotalBytes: number | null;
  readonly memoryUsedFractionMean: number | null;
  readonly activeAgentsMax: number;
}

export interface CapacityPointInput {
  readonly workerCount: number;
  readonly medianTasksPerHour: number | null;
  readonly minTasksPerHour: number | null;
  readonly maxTasksPerHour: number | null;
  readonly acceptedTasks: number;
  readonly taskRuns: number;
  readonly medianAgentExecutionMs: number | null;
  readonly validationDurationMs: number | null;
  readonly raptureOverheadMs: number | null;
}

export interface CapacityPoint extends CapacityPointInput {
  readonly acceptanceRate: number | null;
  readonly speedup: number | null;
  readonly parallelEfficiency: number | null;
  /** Agent latency inflation relative to N=1. */
  readonly agentLatencyInflationVsBaseline: number | null;
  /** Agent latency inflation relative to the previously tested worker count. */
  readonly agentLatencyInflationVsPrevious: number | null;
  readonly resources: CapacityResourceAggregate | null;
}

export interface AdjacentCapacityStep {
  readonly fromWorkerCount: number;
  readonly toWorkerCount: number;
  readonly addedWorkers: number;
  /** T(to) - T(from). */
  readonly marginalThroughputGain: number | null;
  /** (T(to) - T(from)) / T(from). */
  readonly marginalThroughputGainFraction: number | null;
  /** (T(to) - T(from)) / addedWorkers. */
  readonly marginalWorkerYield: number | null;
  /** marginalWorkerYield / T(1): incremental efficiency of each added worker. */
  readonly incrementalWorkerEfficiency: number | null;
  /** Median agent latency change between the adjacent worker counts. */
  readonly agentLatencyInflation: number | null;
}

export interface CapacityCurve {
  readonly points: readonly CapacityPoint[];
  readonly adjacentSteps: readonly AdjacentCapacityStep[];
}

export function marginalThroughputGain(
  previous: number | null,
  current: number | null,
): number | null {
  if (previous === null || current === null) return null;
  return current - previous;
}

export function marginalWorkerYield(
  previous: number | null,
  current: number | null,
  previousWorkers: number,
  currentWorkers: number,
): number | null {
  const gain = marginalThroughputGain(previous, current);
  const delta = currentWorkers - previousWorkers;
  if (gain === null || delta === 0) return null;
  return gain / delta;
}

export function agentLatencyInflation(base: number | null, current: number | null): number | null {
  if (base === null || base === 0 || current === null) return null;
  return current / base;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Aggregate persisted host-telemetry samples into the resource summary used by
 * capacity points, knee detection, and the resource baselines.
 */
export function aggregateTelemetry(
  samples: readonly HostTelemetrySample[],
): CapacityResourceAggregate | null {
  if (samples.length === 0) return null;
  const numbers = (values: readonly (number | null)[]): number[] =>
    values.filter((value): value is number => value !== null);
  const cpu = numbers(samples.map((sample) => sample.totalCpuUtilization));
  const perCoreMax = numbers(
    samples.map((sample) => {
      const cores = sample.perCoreCpuUtilization.filter((value): value is number => value !== null);
      return cores.length === 0 ? null : Math.max(...cores);
    }),
  );
  const load = numbers(samples.map((sample) => sample.loadAverage1m));
  const used = numbers(samples.map((sample) => sample.totalMemoryBytes - sample.freeMemoryBytes));
  const available = numbers(samples.map((sample) => sample.freeMemoryBytes));
  const totals = [...new Set(samples.map((sample) => sample.totalMemoryBytes))];
  const memoryTotalBytes = totals.length === 1 ? (totals[0] ?? null) : null;
  const usedFractions =
    memoryTotalBytes !== null && memoryTotalBytes > 0
      ? used.map((value) => value / memoryTotalBytes)
      : [];
  return {
    sampleCount: samples.length,
    cpuUtilizationMean: cpu.length === 0 ? null : cpu.reduce((a, b) => a + b, 0) / cpu.length,
    cpuUtilizationP95: percentile(cpu, 0.95),
    perCoreMaxCpuMean:
      perCoreMax.length === 0 ? null : perCoreMax.reduce((a, b) => a + b, 0) / perCoreMax.length,
    perCoreMaxCpuP95: percentile(perCoreMax, 0.95),
    loadAverage1mMean: load.length === 0 ? null : load.reduce((a, b) => a + b, 0) / load.length,
    loadAverage1mP95: percentile(load, 0.95),
    memoryUsedBytesMean: used.length === 0 ? null : used.reduce((a, b) => a + b, 0) / used.length,
    memoryAvailableBytesMin: available.length === 0 ? null : Math.min(...available),
    memoryTotalBytes,
    memoryUsedFractionMean:
      usedFractions.length === 0
        ? null
        : usedFractions.reduce((a, b) => a + b, 0) / usedFractions.length,
    activeAgentsMax: samples.reduce((max, sample) => Math.max(max, sample.activeAgentWorkers), 0),
  };
}

/**
 * Build the capacity curve from persisted per-worker aggregates, optionally
 * enriched with host-resource summaries. Points must carry strictly positive,
 * unique worker counts.
 */
export function buildCapacityCurve(
  inputs: readonly CapacityPointInput[],
  resourcesByWorkerCount: Readonly<Record<number, CapacityResourceAggregate>> = {},
): CapacityCurve {
  const sorted = [...inputs].sort((left, right) => left.workerCount - right.workerCount);
  const seen = new Set<number>();
  for (const point of sorted) {
    if (!Number.isInteger(point.workerCount) || point.workerCount <= 0) {
      throw new Error(`invalid worker count in capacity input: ${point.workerCount}`);
    }
    if (seen.has(point.workerCount)) {
      throw new Error(`duplicate worker count in capacity input: ${point.workerCount}`);
    }
    seen.add(point.workerCount);
  }

  const baselineThroughput =
    sorted.find((point) => point.workerCount === 1)?.medianTasksPerHour ?? null;
  const baselineLatency =
    sorted.find((point) => point.workerCount === 1)?.medianAgentExecutionMs ?? null;

  const points: CapacityPoint[] = sorted.map((point, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    return {
      ...point,
      acceptanceRate: point.taskRuns > 0 ? point.acceptedTasks / point.taskRuns : null,
      speedup: ratio(point.medianTasksPerHour, baselineThroughput),
      parallelEfficiency:
        baselineThroughput !== null && baselineThroughput > 0
          ? ratio(point.medianTasksPerHour, baselineThroughput * point.workerCount)
          : null,
      agentLatencyInflationVsBaseline: agentLatencyInflation(
        baselineLatency,
        point.medianAgentExecutionMs,
      ),
      agentLatencyInflationVsPrevious:
        previous === undefined
          ? null
          : agentLatencyInflation(previous.medianAgentExecutionMs, point.medianAgentExecutionMs),
      resources: resourcesByWorkerCount[point.workerCount] ?? null,
    };
  });

  const adjacentSteps: AdjacentCapacityStep[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index];
    const from = points[index - 1];
    if (to === undefined || from === undefined) continue;
    const gain = marginalThroughputGain(from.medianTasksPerHour, to.medianTasksPerHour);
    const addedWorkers = to.workerCount - from.workerCount;
    const yieldPerWorker = marginalWorkerYield(
      from.medianTasksPerHour,
      to.medianTasksPerHour,
      from.workerCount,
      to.workerCount,
    );
    adjacentSteps.push({
      fromWorkerCount: from.workerCount,
      toWorkerCount: to.workerCount,
      addedWorkers,
      marginalThroughputGain: gain,
      marginalThroughputGainFraction: ratio(gain, from.medianTasksPerHour),
      marginalWorkerYield: yieldPerWorker,
      incrementalWorkerEfficiency:
        baselineThroughput !== null && baselineThroughput > 0
          ? ratio(yieldPerWorker, baselineThroughput)
          : null,
      agentLatencyInflation: agentLatencyInflation(
        from.medianAgentExecutionMs,
        to.medianAgentExecutionMs,
      ),
    });
  }

  return { points, adjacentSteps };
}

export function formatFactor(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(3)}x`;
}
