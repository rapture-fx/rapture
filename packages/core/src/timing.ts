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
    agentExecutionMs: null,
    validationMs: null,
    integrationMs: null,
    worktreeCleanupMs: null,
    totalRunMs,
  };
}

export function raptureOverheadMs(timings: PhaseTimings): number | null {
  if (timings.agentExecutionMs === null || timings.validationMs === null) {
    return null;
  }
  const integrationMs = timings.integrationMs ?? 0;
  return Math.max(
    0,
    timings.totalRunMs - timings.agentExecutionMs - timings.validationMs - integrationMs,
  );
}
