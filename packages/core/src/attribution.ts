import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { computeConcurrencyOverlap, computeProviderConcurrency } from "./concurrency-overlap.js";
import { percentile } from "./metrics.js";

/**
 * Focused N-vs-N+1 attribution analysis over persisted run records.
 *
 * All inputs are immutable artifacts on disk (result.json per attempt plus
 * derived metrics). Distributions are reported descriptively (min/p25/median/
 * p75/max); small samples never support significance claims here.
 */

const resultRunSchema = z.object({
  attemptId: z.string(),
  trialId: z.string(),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive(),
  taskId: z.string(),
  accepted: z.boolean(),
  runState: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  phaseTimings: z
    .object({
      agentExecutionMs: z.number().nonnegative().nullable(),
      validationMs: z.number().nonnegative().nullable(),
    })
    .passthrough()
    .optional(),
  runtimeObservability: z
    .object({
      streamAvailable: z.boolean(),
      provider: z.object({
        providerWaitMs: z.number().nullable(),
        modelStepCount: z.number().nullable(),
        toolEventCount: z.number().nullable(),
        providerErrorCount: z.number().nullable(),
        providerRateLimitSignal: z.boolean().nullable(),
        firstStructuredEventAt: z.string().nullable(),
        lastModelResponseAt: z.string().nullable(),
      }),
      providerSpans: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
      decomposition: z.object({
        observedWindowMs: z.number().nullable(),
        providerWaitMs: z.number().nullable(),
        interStepGapMs: z.number().nullable(),
        outsideWindowMs: z.number().nullable(),
        providerWaitFraction: z.number().nullable(),
        interStepGapFraction: z.number().nullable(),
        unobservedFraction: z.number().nullable(),
      }),
      gaps: z.object({
        handoffGapsMs: z.array(z.number()),
        launchToFirstEventMs: z.number().nullable(),
      }),
    })
    .nullable()
    .optional(),
});

export interface RunObservation {
  readonly attemptId: string;
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly taskId: string;
  readonly accepted: boolean;
  readonly runState: string;
  readonly startedAt: string;
  readonly totalRunMs: number;
  readonly agentExecutionMs: number | null;
  readonly validationMs: number | null;
  readonly providerWaitMs: number | null;
  readonly providerWaitFraction: number | null;
  readonly interStepGapFraction: number | null;
  readonly unobservedFraction: number | null;
  readonly launchToFirstEventMs: number | null;
  readonly modelStepCount: number | null;
  readonly toolEventCount: number | null;
  readonly providerErrorCount: number | null;
  readonly providerRateLimitSignal: boolean | null;
  readonly streamAvailable: boolean;
  readonly providerSpans: readonly { readonly startMs: number; readonly endMs: number }[];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function listDirectories(path: string): Promise<readonly string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Load per-run observations from persisted result.json artifacts. */
export async function loadRunObservations(
  experimentDirectory: string,
): Promise<readonly RunObservation[]> {
  const directory = join(experimentDirectory);
  const observations: RunObservation[] = [];
  for (const trialName of await listDirectories(join(directory, "trials"))) {
    const runsRoot = join(directory, "trials", trialName, "runs");
    for (const runName of await listDirectories(runsRoot)) {
      let parsed: z.infer<typeof resultRunSchema>;
      try {
        parsed = resultRunSchema.parse(await readJson(join(runsRoot, runName, "result.json")));
      } catch {
        continue;
      }
      const observability = parsed.runtimeObservability ?? null;
      observations.push({
        attemptId: parsed.attemptId,
        trialId: parsed.trialId,
        workerCount: parsed.workerCount,
        repetition: parsed.repetition,
        taskId: parsed.taskId,
        accepted: parsed.accepted,
        runState: parsed.runState,
        startedAt: parsed.startedAt,
        totalRunMs: parsed.durationMs,
        agentExecutionMs: parsed.phaseTimings?.agentExecutionMs ?? null,
        validationMs: parsed.phaseTimings?.validationMs ?? null,
        providerWaitMs: observability?.provider.providerWaitMs ?? null,
        providerWaitFraction: observability?.decomposition.providerWaitFraction ?? null,
        interStepGapFraction: observability?.decomposition.interStepGapFraction ?? null,
        unobservedFraction: observability?.decomposition.unobservedFraction ?? null,
        launchToFirstEventMs: observability?.gaps.launchToFirstEventMs ?? null,
        modelStepCount: observability?.provider.modelStepCount ?? null,
        toolEventCount: observability?.provider.toolEventCount ?? null,
        providerErrorCount: observability?.provider.providerErrorCount ?? null,
        providerRateLimitSignal: observability?.provider.providerRateLimitSignal ?? null,
        streamAvailable: observability?.streamAvailable ?? false,
        providerSpans: observability?.providerSpans ?? [],
      });
    }
  }
  return observations.sort((a, b) => a.attemptId.localeCompare(b.attemptId));
}

export interface DistributionStats {
  readonly count: number;
  readonly min: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly max: number;
  readonly mean: number;
}

/** Descriptive distribution over finite values; null when empty. */
export function distributionStats(values: readonly (number | null)[]): DistributionStats | null {
  const present = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  const sorted = [...present].sort((a, b) => a - b);
  const mean = present.reduce((total, value) => total + value, 0) / present.length;
  return {
    count: present.length,
    min: sorted[0] ?? Number.NaN,
    p25: percentile(present, 0.25) ?? Number.NaN,
    median: percentile(present, 0.5) ?? Number.NaN,
    p75: percentile(present, 0.75) ?? Number.NaN,
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean,
  };
}

export interface WorkerSideSummary {
  readonly workerCount: number;
  readonly runs: number;
  readonly acceptedRuns: number;
  readonly acceptanceRate: number;
  readonly agentExecutionMs: DistributionStats | null;
  readonly providerWaitMs: DistributionStats | null;
  readonly providerWaitFraction: DistributionStats | null;
  readonly interStepGapFraction: DistributionStats | null;
  readonly unobservedFraction: DistributionStats | null;
  readonly launchToFirstEventMs: DistributionStats | null;
  readonly modelStepsPerRun: DistributionStats | null;
  readonly toolEventsPerRun: DistributionStats | null;
  readonly streamCoverage: number;
  readonly rateLimitSignals: number;
}

export function summarizeWorkerSide(
  observations: readonly RunObservation[],
  workerCount: number,
): WorkerSideSummary {
  const group = observations.filter((observation) => observation.workerCount === workerCount);
  const accepted = group.filter((observation) => observation.accepted).length;
  return {
    workerCount,
    runs: group.length,
    acceptedRuns: accepted,
    acceptanceRate: group.length > 0 ? accepted / group.length : 0,
    agentExecutionMs: distributionStats(group.map((o) => o.agentExecutionMs)),
    providerWaitMs: distributionStats(group.map((o) => o.providerWaitMs)),
    providerWaitFraction: distributionStats(group.map((o) => o.providerWaitFraction)),
    interStepGapFraction: distributionStats(group.map((o) => o.interStepGapFraction)),
    unobservedFraction: distributionStats(group.map((o) => o.unobservedFraction)),
    launchToFirstEventMs: distributionStats(group.map((o) => o.launchToFirstEventMs)),
    modelStepsPerRun: distributionStats(group.map((o) => o.modelStepCount)),
    toolEventsPerRun: distributionStats(group.map((o) => o.toolEventCount)),
    streamCoverage:
      group.length > 0 ? group.filter((o) => o.streamAvailable).length / group.length : 0,
    rateLimitSignals: group.filter((o) => o.providerRateLimitSignal === true).length,
  };
}

export interface EdgeComparison {
  readonly low: WorkerSideSummary;
  readonly high: WorkerSideSummary;
  /** Median-based ratios (high / low); null when either side lacks data. */
  readonly ratios: {
    readonly agentExecutionMs: number | null;
    readonly providerWaitMs: number | null;
    readonly providerWaitFraction: number | null;
    readonly interStepGapFraction: number | null;
    readonly launchToFirstEventMs: number | null;
  };
  /**
   * Actual simultaneous agent-process overlap per trial, computed from run
   * execution windows ([startedAt, startedAt+agentExecutionMs]).
   */
  readonly actualOverlapByTrial: readonly {
    readonly trialId: string;
    readonly workerCount: number;
    readonly maxConcurrent: number;
    readonly meanConcurrent: number | null;
    readonly fractionAtFullConcurrency: number | null;
  }[];
  /** Provider-span overlap across concurrent runs within each trial. */
  readonly providerOverlapByTrial: readonly {
    readonly trialId: string;
    readonly workerCount: number;
    readonly maxConcurrentProviderSpans: number;
    readonly meanConcurrentProviderSpans: number | null;
    readonly spanCount: number;
  }[];
}

function medianOfStats(stats: DistributionStats | null): number | null {
  return stats === null ? null : stats.median;
}

function ratio(high: number | null, low: number | null): number | null {
  if (high === null || low === null || low === 0) return null;
  return high / low;
}

export function compareWorkerEdge(
  observations: readonly RunObservation[],
  lowWorkers = 3,
  highWorkers = 4,
): EdgeComparison {
  const low = summarizeWorkerSide(observations, lowWorkers);
  const high = summarizeWorkerSide(observations, highWorkers);

  // Group execution windows by trial for overlap analysis.
  const windowsByTrial = new Map<
    string,
    { workerCount: number; intervals: { startMs: number; endMs: number }[] }
  >();
  const spansByTrial = new Map<
    string,
    { workerCount: number; spans: { startMs: number; endMs: number }[] }
  >();
  for (const observation of observations) {
    const key = observation.trialId;
    if (observation.agentExecutionMs !== null) {
      const started = Date.parse(observation.startedAt);
      if (!Number.isFinite(started)) continue;
      const entry = windowsByTrial.get(key) ?? {
        workerCount: observation.workerCount,
        intervals: [],
      };
      entry.intervals.push({
        startMs: started,
        endMs: started + observation.agentExecutionMs,
      });
      windowsByTrial.set(key, entry);
    }
    if (observation.providerSpans.length > 0) {
      const entry = spansByTrial.get(key) ?? {
        workerCount: observation.workerCount,
        spans: [],
      };
      for (const span of observation.providerSpans) {
        entry.spans.push({ startMs: span.startMs, endMs: span.endMs });
      }
      spansByTrial.set(key, entry);
    }
  }
  const actualOverlapByTrial = [...windowsByTrial.entries()]
    .map(([trialId, entry]) => {
      const overlap = computeConcurrencyOverlap(entry.intervals);
      return {
        trialId,
        workerCount: entry.workerCount,
        maxConcurrent: overlap.maxConcurrency,
        meanConcurrent: overlap.meanConcurrency,
        fractionAtFullConcurrency:
          entry.workerCount > 0 && overlap.fractionByLevel.length >= entry.workerCount
            ? (overlap.fractionByLevel[entry.workerCount - 1] ?? null)
            : null,
      };
    })
    .sort((a, b) => a.trialId.localeCompare(b.trialId));

  const providerOverlapByTrial = [...spansByTrial.entries()]
    .map(([trialId, entry]) => {
      const overlap = computeProviderConcurrency(entry.spans);
      return {
        trialId,
        workerCount: entry.workerCount,
        maxConcurrentProviderSpans: overlap.maxConcurrency,
        meanConcurrentProviderSpans: overlap.meanConcurrency,
        spanCount: overlap.spanCount,
      };
    })
    .sort((a, b) => a.trialId.localeCompare(b.trialId));

  return {
    low,
    high,
    ratios: {
      agentExecutionMs: ratio(
        medianOfStats(high.agentExecutionMs),
        medianOfStats(low.agentExecutionMs),
      ),
      providerWaitMs: ratio(medianOfStats(high.providerWaitMs), medianOfStats(low.providerWaitMs)),
      providerWaitFraction: ratio(
        medianOfStats(high.providerWaitFraction),
        medianOfStats(low.providerWaitFraction),
      ),
      interStepGapFraction: ratio(
        medianOfStats(high.interStepGapFraction),
        medianOfStats(low.interStepGapFraction),
      ),
      launchToFirstEventMs: ratio(
        medianOfStats(high.launchToFirstEventMs),
        medianOfStats(low.launchToFirstEventMs),
      ),
    },
    actualOverlapByTrial,
    providerOverlapByTrial,
  };
}
