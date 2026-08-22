/**
 * Provider/runtime boundary observability from OpenCode's structured JSON
 * event stream (`opencode run --format json`).
 *
 * Strict provenance rules:
 * - Every derived number comes from structurally parsed events or process
 *   boundaries; nothing is scraped from terminal prose.
 * - Fields that cannot be derived remain `null`. UNKNOWN time is reported as
 *   an explicit bucket rather than being folded into a guessed phase.
 *
 * Observed stream shape (OpenCode CLI 1.18.x):
 *   {"type":"step_start","timestamp":<epoch ms>,...}      model request begins
 *   {"type":"step_finish","timestamp":<epoch ms>,...}     model response complete
 *   {"type":"tool_use","timestamp":<epoch ms>,...}        local tool event
 *   {"type":"text","timestamp":<epoch ms>,...}
 *   {"type":"error","timestamp":<epoch ms>,...}
 */

export interface OpenCodeStreamEvent {
  readonly type: string;
  readonly timestamp: number;
  readonly sessionID?: string;
  readonly raw: Record<string, unknown>;
}

/**
 * Parse the structured JSONL stream. Returns null when the output contains no
 * parseable structured events (e.g. adapters that do not emit JSON), so
 * callers can distinguish "no data" from "zero events".
 */
export function parseOpenCodeEventStream(stdout: string): readonly OpenCodeStreamEvent[] | null {
  const events: OpenCodeStreamEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string") continue;
    const timestamp = record.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    events.push({
      type: record.type,
      timestamp,
      ...(typeof record.sessionID === "string" ? { sessionID: record.sessionID } : {}),
      raw: record,
    });
  }
  return events.length === 0 ? null : events.sort((a, b) => a.timestamp - b.timestamp);
}

export interface ProviderTiming {
  readonly processStartedAt: string | null;
  readonly processFinishedAt: string | null;
  readonly firstStructuredEventAt: string | null;
  /** First completed model response (step_finish). */
  readonly firstModelResponseAt: string | null;
  readonly lastModelResponseAt: string | null;
  /**
   * Sum of matched [step_start -> step_finish] spans: wall time attributable to
   * waiting on remote model activity. Unmatched step starts are excluded and
   * counted separately.
   */
  readonly providerWaitMs: number | null;
  readonly providerEventCount: number | null;
  readonly modelStepCount: number | null;
  readonly toolEventCount: number | null;
  /** Structurally exposed retry count; null unless the stream exposes one. */
  readonly providerRetryCount: number | null;
  readonly providerErrorCount: number | null;
  readonly providerRateLimitSignal: boolean | null;
  readonly unmatchedStepStartCount: number | null;
}

const RATE_LIMIT_PATTERN = /(rate.?limit|429|quota|usage.?limit|too many requests)/iu;

function isoOrNull(epochMs: number | null): string | null {
  return epochMs === null ? null : new Date(epochMs).toISOString();
}

export function deriveProviderTiming(
  events: readonly OpenCodeStreamEvent[],
  bounds: { readonly processStartedAt?: string; readonly processFinishedAt?: string } = {},
): ProviderTiming {
  const stepFinishTimes = events
    .filter((event) => event.type === "step_finish")
    .map((e) => e.timestamp);
  const stepStartTimes = events.filter((event) => event.type === "step_start");
  const toolEvents = events.filter((event) => event.type === "tool_use");
  const errorEvents = events.filter((event) => event.type === "error");

  // Match each step start with the next step finish to form provider spans.
  let providerWaitMs = 0;
  let matchedSpans = 0;
  const finishQueue = [...stepFinishTimes];
  for (const start of [...stepStartTimes].sort((a, b) => a.timestamp - b.timestamp)) {
    const openStart = start.timestamp;
    const finishIndex = finishQueue.findIndex((t) => t >= openStart);
    if (finishIndex >= 0) {
      const [finishTime] = finishQueue.splice(finishIndex, 1);
      if (finishTime !== undefined) {
        providerWaitMs += Math.max(0, finishTime - openStart);
        matchedSpans += 1;
      }
    }
  }
  const unmatchedStepStartCount = stepStartTimes.length - matchedSpans;

  const hasSteps = stepStartTimes.length > 0 || stepFinishTimes.length > 0;
  const rateLimitSignal =
    errorEvents.length === 0
      ? null
      : errorEvents.some((event) => RATE_LIMIT_PATTERN.test(JSON.stringify(event.raw)));

  return {
    processStartedAt: bounds.processStartedAt ?? null,
    processFinishedAt: bounds.processFinishedAt ?? null,
    firstStructuredEventAt: isoOrNull(events[0]?.timestamp ?? null),
    firstModelResponseAt: isoOrNull(stepFinishTimes[0] ?? null),
    lastModelResponseAt: isoOrNull(stepFinishTimes[stepFinishTimes.length - 1] ?? null),
    providerWaitMs: hasSteps || stepFinishTimes.length > 0 ? providerWaitMs : null,
    providerEventCount: hasSteps ? stepStartTimes.length + stepFinishTimes.length : null,
    modelStepCount: stepFinishTimes.length,
    toolEventCount: toolEvents.length,
    providerRetryCount: null,
    providerErrorCount: errorEvents.length,
    providerRateLimitSignal: rateLimitSignal,
    unmatchedStepStartCount:
      hasSteps || stepFinishTimes.length > 0 ? unmatchedStepStartCount : null,
  };
}

export interface RunTimeDecomposition {
  readonly observedWindowMs: number | null;
  /** Wall time inside matched [step_start, step_finish] spans. */
  readonly providerWaitMs: number | null;
  /**
   * Gaps between a step_finish and the next step_start: local tool execution,
   * runtime handoff, and next-request preparation. The stream format does not
   * separate these sub-phases (tool_use parts are streamed inside provider
   * spans), so this bucket is deliberately not further decomposed.
   */
  readonly interStepGapMs: number | null;
  /** Time outside the first..last structured event window of totalRunMs. */
  readonly outsideWindowMs: number | null;
  readonly providerWaitFraction: number | null;
  readonly interStepGapFraction: number | null;
  /** Fraction of totalRunMs not covered by any structured event. */
  readonly unobservedFraction: number | null;
}

/**
 * Decompose total run wall time into explicit buckets. providerWaitMs and
 * interStepGapMs partition the observed structured-event window; the remainder
 * of totalRunMs is reported as unobserved rather than guessed.
 */
export function decomposeRunTime(
  timing: ProviderTiming,
  events: readonly OpenCodeStreamEvent[] | null,
  totalRunMs: number | null,
): RunTimeDecomposition {
  if (
    events === null ||
    totalRunMs === null ||
    timing.firstStructuredEventAt === null ||
    timing.lastModelResponseAt === null
  ) {
    return {
      observedWindowMs: null,
      providerWaitMs: null,
      interStepGapMs: null,
      outsideWindowMs: null,
      providerWaitFraction: null,
      interStepGapFraction: null,
      unobservedFraction: null,
    };
  }

  const first = Date.parse(timing.firstStructuredEventAt);
  // The observed window ends at the last structured event of any type.
  const lastEvent = events[events.length - 1];
  const observedWindowMs = lastEvent === undefined ? 0 : Math.max(0, lastEvent.timestamp - first);

  // Between-steps gaps: from each step_finish to the next step_start.
  let interStepGapMs = 0;
  const finishTimes = events
    .filter((event) => event.type === "step_finish")
    .map((e) => e.timestamp);
  for (const finish of finishTimes) {
    const nextStart = events.find(
      (event) => event.type === "step_start" && event.timestamp > finish,
    );
    if (nextStart === undefined) continue;
    interStepGapMs += Math.max(0, nextStart.timestamp - finish);
  }

  const providerWaitMs = timing.providerWaitMs ?? 0;
  const outsideWindowMs = Math.max(0, totalRunMs - observedWindowMs);

  return {
    observedWindowMs,
    providerWaitMs,
    interStepGapMs,
    outsideWindowMs,
    providerWaitFraction: totalRunMs > 0 ? providerWaitMs / totalRunMs : null,
    interStepGapFraction: totalRunMs > 0 ? interStepGapMs / totalRunMs : null,
    unobservedFraction: totalRunMs > 0 ? outsideWindowMs / totalRunMs : null,
  };
}

export interface EventGapSummary {
  /** Gaps between consecutive structured events of any kind (ms). */
  readonly interEventGapsMs: readonly number[];
  /** step_finish -> next step_start gaps (local execution + handoff). */
  readonly handoffGapsMs: readonly number[];
  /** process launch -> first structured event. */
  readonly launchToFirstEventMs: number | null;
}

export function summarizeEventGaps(
  events: readonly OpenCodeStreamEvent[] | null,
  bounds: { readonly processStartedAt?: string } = {},
): EventGapSummary {
  if (events === null || events.length < 2) {
    return {
      interEventGapsMs: [],
      handoffGapsMs: [],
      launchToFirstEventMs:
        events !== null &&
        events.length === 1 &&
        bounds.processStartedAt !== undefined &&
        events[0] !== undefined
          ? Math.max(0, events[0].timestamp - Date.parse(bounds.processStartedAt))
          : null,
    };
  }
  const interEventGapsMs: number[] = [];
  const handoffGapsMs: number[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (previous === undefined || current === undefined) continue;
    const gap = current.timestamp - previous.timestamp;
    if (previous.type === "step_start" && current.type === "step_finish") {
      // Provider span; captured by providerWaitMs, not a gap.
      continue;
    }
    interEventGapsMs.push(Math.max(0, gap));
    if (previous.type === "step_finish" && current.type === "step_start") {
      handoffGapsMs.push(Math.max(0, gap));
    }
  }
  return {
    interEventGapsMs,
    handoffGapsMs,
    launchToFirstEventMs:
      bounds.processStartedAt === undefined || events[0] === undefined
        ? null
        : Math.max(0, events[0].timestamp - Date.parse(bounds.processStartedAt)),
  };
}

/** Matched [step_start -> step_finish] spans in absolute epoch ms. */
export interface ProviderSpan {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Match each step start with the next later step finish. Unmatched starts are
 * dropped and reported separately via unmatchedStepStartCount.
 */
export function matchProviderSpans(
  events: readonly OpenCodeStreamEvent[],
): readonly ProviderSpan[] {
  const finishes = events
    .filter((event) => event.type === "step_finish")
    .map((event) => event.timestamp)
    .sort((a, b) => a - b);
  const queue = [...finishes];
  const spans: ProviderSpan[] = [];
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.type !== "step_start") continue;
    const index = queue.findIndex((time) => time >= event.timestamp);
    if (index < 0) continue;
    const [end] = queue.splice(index, 1);
    if (end !== undefined && end >= event.timestamp) {
      spans.push({ startMs: event.timestamp, endMs: end });
    }
  }
  return spans.sort((a, b) => a.startMs - b.startMs);
}

/** Convenience wrapper used by the experiment runner. */
export type RuntimeObservability = {
  readonly streamAvailable: boolean;
  readonly provider: ProviderTiming;
  readonly providerSpans: readonly ProviderSpan[];
  readonly decomposition: RunTimeDecomposition;
  readonly gaps: EventGapSummary;
};

export function extractRuntimeObservability(
  stdout: string,
  bounds: {
    readonly processStartedAt?: string;
    readonly processFinishedAt?: string;
    readonly totalRunMs?: number;
  } = {},
): RuntimeObservability {
  const events = parseOpenCodeEventStream(stdout);
  const provider = deriveProviderTiming(events ?? [], bounds);
  const providerSpans = events === null ? [] : matchProviderSpans(events);
  const decomposition = decomposeRunTime(provider, events, bounds.totalRunMs ?? null);
  const gaps = summarizeEventGaps(events, bounds);
  return { streamAvailable: events !== null, provider, providerSpans, decomposition, gaps };
}
