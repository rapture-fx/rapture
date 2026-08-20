import { performance } from "node:perf_hooks";
import type { PhaseTimings } from "./models.js";

export async function timePhase<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly durationMs: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round(performance.now() - started) };
}

export function incompletePhaseTimings(totalRunMs: number): PhaseTimings {
  return {
    worktreeSetupMs: null,
    queueWaitMs: null,
    agentExecutionMs: null,
    validationMs: null,
    artifactPersistenceMs: null,
    integrationMs: null,
    worktreeCleanupMs: null,
    otherOrchestrationMs: null,
    totalRunMs,
  };
}

export function raptureOverheadMs(timings: PhaseTimings): number | null {
  if (timings.agentExecutionMs === null || timings.validationMs === null) {
    return null;
  }
  const integrationMs = timings.integrationMs ?? 0;
  const accountedFor =
    (timings.worktreeSetupMs ?? 0) +
    (timings.queueWaitMs ?? 0) +
    timings.agentExecutionMs +
    timings.validationMs +
    (timings.artifactPersistenceMs ?? 0) +
    integrationMs +
    (timings.worktreeCleanupMs ?? 0);
  return Math.max(0, timings.totalRunMs - accountedFor);
}

export function phaseOverheadMs(timings: PhaseTimings): number | null {
  if (timings.agentExecutionMs === null || timings.validationMs === null) {
    return null;
  }
  const rapture = raptureOverheadMs(timings);
  if (rapture === null) return null;
  return rapture + (timings.worktreeSetupMs ?? 0) + (timings.queueWaitMs ?? 0);
}
