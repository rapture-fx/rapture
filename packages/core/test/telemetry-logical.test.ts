import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTelemetryFileSink } from "../src/experiment.js";
import {
  canonicalExperimentIdentity,
  isRerunEligibleState,
  isTerminalRunState,
  logicalRunIdFor,
} from "../src/logical-run.js";
import type { HostTelemetrySample } from "../src/models.js";
import { createHostTelemetrySampler } from "../src/telemetry.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("host telemetry", () => {
  it("writes samples to the file sink with active agent workers", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-telemetry-"));
    const path = join(root, "telemetry.jsonl");
    const sink = createTelemetryFileSink(path);
    const active = { value: 3 };
    const sampler = createHostTelemetrySampler(sink, {
      intervalMs: 30,
      activeAgentWorkers: () => active.value,
    });
    sampler.start();
    await wait(120);
    await sampler.stop();
    const lines = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as HostTelemetrySample);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const sample of lines) {
      expect(sample.activeAgentWorkers).toBe(3);
      expect(sample.timestamp).toBeDefined();
      expect(sample.totalMemoryBytes).toBeGreaterThan(0);
      expect(sample.parentRssBytes).toBeGreaterThan(0);
    }
  });

  it("surfaces sink write failures through the error callback without crashing", async () => {
    const failing: HostTelemetrySample = {
      timestamp: "2026-01-01T00:00:00.000Z",
      elapsedMs: 1,
      totalCpuUtilization: null,
      perCoreCpuUtilization: [],
      loadAverage1m: null,
      totalMemoryBytes: 1,
      freeMemoryBytes: 1,
      parentRssBytes: 1,
      activeAgentWorkers: 0,
      eventLoopLagMs: null,
    };
    const errors: unknown[] = [];
    const sampler = createHostTelemetrySampler(
      {
        write: async () => {
          throw new Error("sink exploded");
        },
        close: async () => undefined,
      },
      { intervalMs: 10, activeAgentWorkers: () => 0, onError: (error) => errors.push(error) },
    );
    sampler.start();
    await wait(60);
    await sampler.stop();
    expect(errors.length).toBeGreaterThan(0);
    expect(failing.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("logical run identity", () => {
  it("derives a stable logical run id from the full identity", () => {
    const identity = {
      repositoryFingerprint: "repo-fp",
      taskSetHash: "tasks-hash",
      workerCounts: [1, 2],
      repetitions: 3,
      seed: 7,
      agent: "fake",
      agentModel: null,
      agentVersion: "1",
      integration: false,
    };
    const experimentHash = canonicalExperimentIdentity(identity);
    const id = logicalRunIdFor({
      experimentIdentityHash: experimentHash,
      workerCount: 1,
      repetition: 1,
      taskId: "one",
      trialSeed: 42,
      agent: "fake",
      agentModel: null,
      agentVersion: "1",
    });
    const again = logicalRunIdFor({
      experimentIdentityHash: experimentHash,
      workerCount: 1,
      repetition: 1,
      taskId: "one",
      trialSeed: 42,
      agent: "fake",
      agentModel: null,
      agentVersion: "1",
    });
    expect(id).toBe(again);
    expect(id.length).toBe(64);
  });

  it("changes the logical run id when the worker count or task changes", () => {
    const identity = {
      repositoryFingerprint: "repo-fp",
      taskSetHash: "tasks-hash",
      workerCounts: [1, 2],
      repetitions: 3,
      seed: 7,
      agent: "fake",
      agentModel: null,
      agentVersion: "1",
      integration: false,
    };
    const experimentHash = canonicalExperimentIdentity(identity);
    const base = {
      experimentIdentityHash: experimentHash,
      repetition: 1,
      taskId: "one",
      trialSeed: 42,
      agent: "fake",
      agentModel: null,
      agentVersion: "1",
    };
    const workerOne = logicalRunIdFor({ ...base, workerCount: 1 });
    const workerTwo = logicalRunIdFor({ ...base, workerCount: 2 });
    const otherTask = logicalRunIdFor({ ...base, workerCount: 1, taskId: "two" });
    expect(workerOne).not.toBe(workerTwo);
    expect(workerOne).not.toBe(otherTask);
  });

  it("distinguishes terminal, rerun-eligible, and other states", () => {
    expect(isTerminalRunState("accepted")).toBe(true);
    expect(isTerminalRunState("rejected")).toBe(true);
    expect(isTerminalRunState("timed_out")).toBe(true);
    expect(isTerminalRunState("pending")).toBe(false);
    expect(isTerminalRunState("running")).toBe(false);
    expect(isTerminalRunState("provider_blocked")).toBe(false);
    expect(isTerminalRunState("interrupted")).toBe(false);
    expect(isTerminalRunState("infrastructure_failed")).toBe(false);
    expect(isRerunEligibleState("provider_blocked")).toBe(true);
    expect(isRerunEligibleState("infrastructure_failed")).toBe(true);
    expect(isRerunEligibleState("interrupted")).toBe(false);
    expect(isRerunEligibleState("accepted")).toBe(false);
  });
});
