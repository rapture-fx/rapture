import { describe, expect, it } from "vitest";
import {
  aggregateProcessTelemetry,
  attemptIdFromCommand,
  computeConcurrencyOverlap,
  computeProviderConcurrency,
} from "../src/index.js";
import { parseElapsedSeconds } from "../src/process-telemetry.js";

function sample(attemptId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-08-21T14:00:00.000Z",
    attemptId,
    pid: 100,
    ppid: 1,
    pcpuPercent: 50,
    rssKb: 200_000,
    elapsedSeconds: 10,
    commandSnippet: "opencode run --dir /x/.worktrees/attempt",
    ...overrides,
  };
}

describe("attempt id attribution", () => {
  it("extracts the attempt id from the worktree path in agent commands", () => {
    expect(
      attemptIdFromCommand(
        "opencode run --dir /repo/.worktrees/workers-3-trial-2-add-volume-discount-ea7bae4d --model m --agent build --format json Complete this task: long prompt ignored",
      ),
    ).toBe("workers-3-trial-2-add-volume-discount-ea7bae4d");
  });

  it("returns null for commands without a worktree marker", () => {
    expect(attemptIdFromCommand("opencode --version")).toBeNull();
  });
});

describe("process telemetry aggregation", () => {
  it("summarizes per-attempt RSS and CPU from persisted samples", () => {
    const summaries = aggregateProcessTelemetry([
      sample("a", { rssKb: 100_000, pcpuPercent: 40, timestamp: "2026-08-21T14:00:00Z" }),
      sample("a", { rssKb: 300_000, pcpuPercent: 80, timestamp: "2026-08-21T14:00:01Z" }),
      sample(null),
      sample("b", { rssKb: 50_000, pcpuPercent: 20 }),
    ]);
    const a = summaries.find((summary) => summary.attemptId === "a");
    expect(a?.sampleCount).toBe(2);
    expect(a?.rssMaxKb).toBe(300_000);
    expect(a?.rssMeanKb).toBe(200_000);
    expect(a?.pcpuMeanPercent).toBe(60);
    expect(a?.pcpuMaxPercent).toBe(80);
    expect(summaries.find((summary) => summary.attemptId === "b")?.rssMaxKb).toBe(50_000);
  });

  it("parses ps etime formats", () => {
    expect(parseElapsedSeconds("42")).toBe(42);
    expect(parseElapsedSeconds("05:30")).toBe(330);
    expect(parseElapsedSeconds("01:02:03")).toBe(3723);
    expect(parseElapsedSeconds("bad")).toBeNull();
  });
});

describe("concurrency overlap calculation", () => {
  it("computes time-weighted concurrency fractions", () => {
    // Two fully overlapping windows plus one solo window.
    const overlap = computeConcurrencyOverlap([
      { startMs: 0, endMs: 100 },
      { startMs: 0, endMs: 100 },
      { startMs: 100, endMs: 200 },
    ]);
    expect(overlap.coveredMs).toBe(200);
    expect(overlap.maxConcurrency).toBe(2);
    expect(overlap.meanConcurrency).toBeCloseTo((100 * 2 + 100 * 1) / 200, 9);
    expect(overlap.fractionByLevel[0]).toBeCloseTo(0.5, 9);
    expect(overlap.fractionByLevel[1]).toBeCloseTo(0.5, 9);
  });

  it("never double counts touching intervals", () => {
    const overlap = computeConcurrencyOverlap([
      { startMs: 0, endMs: 100 },
      { startMs: 100, endMs: 200 },
    ]);
    expect(overlap.coveredMs).toBe(200);
    expect(overlap.maxConcurrency).toBe(1);
  });

  it("ignores invalid intervals and handles empty input", () => {
    expect(computeConcurrencyOverlap([]).coveredMs).toBe(0);
    const overlap = computeConcurrencyOverlap([{ startMs: 50, endMs: 50 }]);
    expect(overlap.coveredMs).toBe(0);
    expect(overlap.windowMs).toBeNull();
  });

  it("reports provider-span concurrency with span counts", () => {
    const summary = computeProviderConcurrency([
      { startMs: 0, endMs: 100 },
      { startMs: 50, endMs: 150 },
    ]);
    expect(summary.spanCount).toBe(2);
    expect(summary.maxConcurrency).toBe(2);
    // union = 150ms; concurrency 1 for 50ms, 2 for 50ms, 1 for 50ms
    expect(summary.meanConcurrency).toBeCloseTo(200 / 150, 9);
  });
});
