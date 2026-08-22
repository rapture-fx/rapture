/**
 * Concurrency-overlap model.
 *
 * Measures actual simultaneous expensive work rather than the configured
 * worker count. Inputs are persisted intervals (process telemetry windows,
 * provider spans, or run windows); all math is pure and inspectable.
 */

export interface ConcurrencyInterval {
  readonly startMs: number;
  readonly endMs: number;
  /** Optional label used for grouped overlap analysis. */
  readonly id?: string;
}

export interface ConcurrencyOverlap {
  /** Wall time covered by at least one interval (union). */
  readonly coveredMs: number;
  readonly windowMs: number | null;
  /** Fraction of union wall time spent at exactly k concurrent intervals, indexed by k. */
  readonly fractionByLevel: readonly number[];
  /** Time-weighted mean concurrency across the covered window. */
  readonly meanConcurrency: number | null;
  readonly maxConcurrency: number;
}

/**
 * Compute time-weighted concurrency levels over the union of intervals.
 * Deterministic: boundary ties are resolved by closing before opening.
 */
export function computeConcurrencyOverlap(
  intervals: readonly ConcurrencyInterval[],
): ConcurrencyOverlap {
  const valid = intervals.filter(
    (interval) => Number.isFinite(interval.startMs) && interval.endMs > interval.startMs,
  );
  if (valid.length === 0) {
    return {
      coveredMs: 0,
      windowMs: null,
      fractionByLevel: [],
      meanConcurrency: null,
      maxConcurrency: 0,
    };
  }
  const minStart = Math.min(...valid.map((interval) => interval.startMs));
  const maxEnd = Math.max(...valid.map((interval) => interval.endMs));

  type Boundary = { time: number; delta: number };
  const boundaries: Boundary[] = [];
  for (const interval of valid) {
    boundaries.push({ time: interval.startMs, delta: 1 });
    boundaries.push({ time: interval.endMs, delta: -1 });
  }
  // Close (-1) before open (+1) so touching intervals never double count.
  boundaries.sort((a, b) => a.time - b.time || a.delta - b.delta);

  const levelDurations = new Map<number, number>();
  let current = 0;
  let previousTime = minStart;
  let coveredMs = 0;
  let weightedSum = 0;
  let maxConcurrency = 0;

  for (const boundary of boundaries) {
    if (boundary.time > previousTime && current > 0) {
      const duration = boundary.time - previousTime;
      levelDurations.set(current, (levelDurations.get(current) ?? 0) + duration);
      coveredMs += duration;
      weightedSum += duration * current;
    }
    current += boundary.delta;
    if (current > maxConcurrency) maxConcurrency = current;
    previousTime = Math.max(previousTime, boundary.time);
  }

  const fractionByLevel: number[] = [];
  const levels = [...levelDurations.keys()];
  const maxLevel = levels.length > 0 ? Math.max(...levels) : 0;
  for (let level = 1; level <= maxLevel; level += 1) {
    fractionByLevel.push((levelDurations.get(level) ?? 0) / coveredMs);
  }

  return {
    coveredMs,
    windowMs: maxEnd - minStart,
    fractionByLevel,
    meanConcurrency: coveredMs > 0 ? weightedSum / coveredMs : null,
    maxConcurrency,
  };
}

export interface ProviderConcurrencySummary extends ConcurrencyOverlap {
  /** Total number of provider spans considered. */
  readonly spanCount: number;
}

/**
 * Overlap of provider-active spans ([step_start, step_finish]) across
 * concurrent runs within a trial — provider-visible request concurrency.
 */
export function computeProviderConcurrency(
  spans: readonly ConcurrencyInterval[],
): ProviderConcurrencySummary {
  return { ...computeConcurrencyOverlap(spans), spanCount: spans.length };
}
