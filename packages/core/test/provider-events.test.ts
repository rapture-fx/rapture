import { describe, expect, it } from "vitest";
import {
  decomposeRunTime,
  deriveProviderTiming,
  extractRuntimeObservability,
  matchProviderSpans,
  parseOpenCodeEventStream,
  summarizeEventGaps,
} from "../src/provider-events.js";

const BASE = 1_787_321_503_174;

function line(type: string, offsetMs: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, timestamp: BASE + offsetMs, sessionID: "ses_test", ...extra });
}

const REALISTIC_STREAM = [
  line("step_start", 0),
  line("tool_use", 912),
  line("step_finish", 1162),
  line("step_start", 4492),
  line("tool_use", 6795),
  line("step_finish", 7268),
  line("text", 12000),
].join("\n");

describe("provider event timestamp parsing", () => {
  it("parses structured events and sorts them chronologically", () => {
    const events = parseOpenCodeEventStream(
      [line("step_finish", 100), line("step_start", 0)].join("\n"),
    );
    expect(events).not.toBeNull();
    expect(events?.map((event) => event.type)).toEqual(["step_start", "step_finish"]);
  });

  it("tolerates non-JSON lines and lines without timestamps", () => {
    const events = parseOpenCodeEventStream(
      ["not json at all", JSON.stringify({ type: "no-timestamp" }), line("step_start", 5), ""].join(
        "\n",
      ),
    );
    expect(events).toHaveLength(1);
    expect(events?.[0]?.type).toBe("step_start");
  });

  it("returns null for output without any structured events", () => {
    expect(parseOpenCodeEventStream("done\n")).toBeNull();
    expect(parseOpenCodeEventStream("")).toBeNull();
  });
});

describe("provider timing derivation", () => {
  it("computes provider wait from matched step spans", () => {
    const events = parseOpenCodeEventStream(REALISTIC_STREAM);
    expect(events).not.toBeNull();
    const timing = deriveProviderTiming(events ?? [], {
      processStartedAt: new Date(BASE - 500).toISOString(),
      processFinishedAt: new Date(BASE + 13000).toISOString(),
    });
    // span1: 0->1162 (1162ms); span2: 4492->7268 (2776ms)
    expect(timing.providerWaitMs).toBe(3938);
    expect(timing.modelStepCount).toBe(2);
    expect(timing.providerEventCount).toBe(4);
    expect(timing.toolEventCount).toBe(2);
    expect(timing.firstModelResponseAt).toBe(new Date(BASE + 1162).toISOString());
    expect(timing.lastModelResponseAt).toBe(new Date(BASE + 7268).toISOString());
    expect(timing.unmatchedStepStartCount).toBe(0);
    expect(timing.providerRetryCount).toBeNull();
    expect(timing.providerErrorCount).toBe(0);
    expect(timing.providerRateLimitSignal).toBeNull();
  });

  it("counts unmatched step starts explicitly", () => {
    const events = parseOpenCodeEventStream(line("step_start", 0));
    const timing = deriveProviderTiming(events ?? []);
    expect(timing.providerWaitMs).toBe(0);
    expect(timing.unmatchedStepStartCount).toBe(1);
  });

  it("detects error counts and rate-limit signals from structured error events", () => {
    const stream = [
      line("error", 10, { error: { data: { message: "HTTP 429 too many requests" } } }),
      line("error", 20, { error: { data: { message: "boom" } } }),
    ].join("\n");
    const timing = deriveProviderTiming(parseOpenCodeEventStream(stream) ?? []);
    expect(timing.providerErrorCount).toBe(2);
    expect(timing.providerRateLimitSignal).toBe(true);
  });
});

describe("run time decomposition", () => {
  it("partitions observed time into provider spans and inter-step gaps", () => {
    const events = parseOpenCodeEventStream(REALISTIC_STREAM);
    const timing = deriveProviderTiming(events ?? []);
    const decomposition = decomposeRunTime(timing, events, 20_000);
    expect(decomposition.observedWindowMs).toBe(12_000);
    expect(decomposition.providerWaitMs).toBe(3_938);
    // gap between the two steps: 4492-1162 = 3330ms
    expect(decomposition.interStepGapMs).toBe(3_330);
    expect(decomposition.outsideWindowMs).toBe(8_000);
    expect((decomposition.providerWaitFraction ?? 0) * 20000).toBeCloseTo(3_938, 6);
    // provider span + inter-step gap = observed window
    expect((decomposition.providerWaitMs ?? 0) + (decomposition.interStepGapMs ?? -1)).toBe(
      12_000 - 4_732,
    );
  });

  it("returns all-null decomposition without a structured stream", () => {
    const decomposition = decomposeRunTime(deriveProviderTiming([]), null, 5_000);
    expect(decomposition.providerWaitMs).toBeNull();
    expect(decomposition.interStepGapFraction).toBeNull();
    expect(decomposition.unobservedFraction).toBeNull();
  });
});

describe("event gap analysis", () => {
  it("excludes provider spans from gaps and reports handoff gaps", () => {
    const events = parseOpenCodeEventStream(REALISTIC_STREAM);
    const gaps = summarizeEventGaps(events ?? [], {
      processStartedAt: new Date(BASE - 500).toISOString(),
    });
    // gaps: start(0)->tool_use(912)=912; tool_use->finish=250;
    // finish(1162)->next start(4492)=3330 (also a handoff);
    // start(4492)->tool_use=2303; tool_use->finish=473; finish(7268)->text=4732
    expect(gaps.handoffGapsMs).toEqual([3_330]);
    expect(gaps.interEventGapsMs).toEqual([912, 250, 3_330, 2_303, 473, 4_732]);
    expect(gaps.launchToFirstEventMs).toBe(500);
  });

  it("handles single-event and empty streams with null/empty gaps", () => {
    const single = summarizeEventGaps(parseOpenCodeEventStream(line("step_start", 10)) ?? []);
    expect(single.launchToFirstEventMs).toBeNull();
    expect(summarizeEventGaps(null).interEventGapsMs).toEqual([]);
  });
});

describe("provider span matching", () => {
  it("pairs each start with the next later finish in epoch ms", () => {
    const events = parseOpenCodeEventStream(REALISTIC_STREAM);
    const spans = matchProviderSpans(events ?? []);
    expect(spans).toEqual([
      { startMs: BASE, endMs: BASE + 1_162 },
      { startMs: BASE + 4_492, endMs: BASE + 7_268 },
    ]);
  });
});

describe("extractRuntimeObservability", () => {
  it("marks stream availability false and keeps fields null for plain-text adapters", () => {
    const observation = extractRuntimeObservability("fake agent completed\n", { totalRunMs: 123 });
    expect(observation.streamAvailable).toBe(false);
    expect(observation.provider.providerWaitMs).toBeNull();
    expect(observation.decomposition.observedWindowMs).toBeNull();
    expect(observation.gaps.launchToFirstEventMs).toBeNull();
  });
});
