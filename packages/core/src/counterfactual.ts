import type { CapacityCurve } from "./capacity.js";

/**
 * Retrospective counterfactual controller simulation.
 *
 * Using completed immutable trial data only, estimate what would have happened
 * if execution had stopped increasing concurrency at a predicted knee instead
 * of always running at maximum concurrency. This is retrospective arithmetic
 * over measured medians — NOT evidence from a live adaptive controller, and it
 * does not establish causal savings.
 */

export interface CounterfactualSimulation {
  readonly label: "retrospective-simulation";
  readonly stopAtWorkers: number;
  readonly maxWorkers: number;
  readonly totalAcceptedTasks: number;
  /** Median accepted tasks/hour at the simulated constant concurrency. */
  readonly throughputAtStopWorkers: number | null;
  readonly throughputAtMaxWorkers: number | null;
  /** Estimated wall-clock hours to complete totalAcceptedTasks at each level. */
  readonly estimatedWallHoursAtStopWorkers: number | null;
  readonly estimatedWallHoursAtMaxWorkers: number | null;
  readonly wallTimeReductionFraction: number | null;
  /** Aggregate agent execution time (ms) = tasks x median agent execution ms. */
  readonly aggregateAgentExecutionMsAtStopWorkers: number | null;
  readonly aggregateAgentExecutionMsAtMaxWorkers: number | null;
  /** Worker-time actually spent executing agents divided by worker-time available. */
  readonly workerOccupancyAtStopWorkers: number | null;
  readonly workerOccupancyAtMaxWorkers: number | null;
}

function pointAt(curve: CapacityCurve, workerCount: number) {
  return curve.points.find((point) => point.workerCount === workerCount);
}

export function simulateControllerStop(
  curve: CapacityCurve,
  stopAtWorkers: number,
  totalAcceptedTasks: number,
): CounterfactualSimulation {
  const stopPoint = pointAt(curve, stopAtWorkers);
  const maxPoint = pointAt(curve, Math.max(...curve.points.map((point) => point.workerCount)));
  if (stopPoint === undefined || maxPoint === undefined) {
    throw new Error(
      "counterfactual simulation requires observed points at both concurrency levels",
    );
  }

  const wallHours = (throughput: number | null): number | null =>
    throughput !== null && throughput > 0 ? totalAcceptedTasks / throughput : null;

  const stopWall = wallHours(stopPoint.medianTasksPerHour);
  const maxWall = wallHours(maxPoint.medianTasksPerHour);

  const aggregateAgentExecutionMs = (agentExecutionMs: number | null): number | null =>
    agentExecutionMs === null ? null : agentExecutionMs * totalAcceptedTasks;

  const occupancy = (
    workers: number,
    agentExecutionMs: number | null,
    wallHoursValue: number | null,
  ): number | null => {
    if (agentExecutionMs === null || wallHoursValue === null || wallHoursValue <= 0) return null;
    const agentSecondsTotal = (agentExecutionMs * totalAcceptedTasks) / 1_000;
    const workerSecondsAvailable = workers * wallHoursValue * 3_600;
    return workerSecondsAvailable > 0 ? agentSecondsTotal / workerSecondsAvailable : null;
  };

  const wallReduction =
    stopWall !== null && maxWall !== null && maxWall > 0 ? 1 - stopWall / maxWall : null;

  return {
    label: "retrospective-simulation",
    stopAtWorkers,
    maxWorkers: maxPoint.workerCount,
    totalAcceptedTasks,
    throughputAtStopWorkers: stopPoint.medianTasksPerHour,
    throughputAtMaxWorkers: maxPoint.medianTasksPerHour,
    estimatedWallHoursAtStopWorkers: stopWall,
    estimatedWallHoursAtMaxWorkers: maxWall,
    // Positive when stopping at the knee finishes FASTER than max concurrency.
    wallTimeReductionFraction: wallReduction,
    aggregateAgentExecutionMsAtStopWorkers: aggregateAgentExecutionMs(
      stopPoint.medianAgentExecutionMs,
    ),
    aggregateAgentExecutionMsAtMaxWorkers: aggregateAgentExecutionMs(
      maxPoint.medianAgentExecutionMs,
    ),
    workerOccupancyAtStopWorkers: occupancy(
      stopPoint.workerCount,
      stopPoint.medianAgentExecutionMs,
      stopWall,
    ),
    workerOccupancyAtMaxWorkers: occupancy(
      maxPoint.workerCount,
      maxPoint.medianAgentExecutionMs,
      maxWall,
    ),
  };
}
