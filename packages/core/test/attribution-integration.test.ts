import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRunObservations, summarizeWorkerSide } from "../src/attribution.js";
import { loadCapacityContext } from "../src/capacity-report.js";
import { readEvents } from "../src/events.js";
import { resumeExperiment, runExperiment } from "../src/experiment.js";
import type { ExperimentConfig } from "../src/models.js";
import { createGitRepository, fakeTask, writeTaskFile } from "./helpers.js";

async function configFor(
  root: string,
  tasks: ExperimentConfig["tasks"],
): Promise<ExperimentConfig> {
  const repository = await createGitRepository(root);
  const taskFile = await writeTaskFile(root, tasks);
  return {
    repository,
    taskFile,
    tasks,
    workerCounts: [2],
    repetitions: 1,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "out"),
    budget: {},
    seed: 20260817,
    integration: false,
    integrationValidation: [],
    executionOrder: "worker-major",
  };
}

const STRUCTURED_FAKE_STDOUT = [
  JSON.stringify({ type: "step_start", timestamp: 1_000, sessionID: "ses_fixture" }),
  JSON.stringify({ type: "tool_use", timestamp: 1_200, sessionID: "ses_fixture" }),
  JSON.stringify({ type: "step_finish", timestamp: 1_800, sessionID: "ses_fixture" }),
  JSON.stringify({ type: "step_start", timestamp: 2_500, sessionID: "ses_fixture" }),
  JSON.stringify({ type: "step_finish", timestamp: 3_400, sessionID: "ses_fixture" }),
  "",
].join("\n");

describe("runtime attribution instrumentation", () => {
  it("decomposes a structured fake stream deterministically end-to-end", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-attribution-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", 'node -e "process.exit(0)"'),
      fakeTask("two", "two.txt", "two\n", 'node -e "process.exit(0)"'),
    ];
    const firstTask = tasks[0];
    const secondTask = tasks[1];
    if (firstTask === undefined || secondTask === undefined) {
      throw new Error("fixture task missing");
    }
    const structuredFirst: ExperimentConfig["tasks"][number] = {
      ...firstTask,
      fake: {
        files: { "one.txt": "one\n" },
        exitCode: 0,
        delayMs: 10,
        stdout: STRUCTURED_FAKE_STDOUT,
        stderr: "",
      },
    };
    const execution = await runExperiment(await configFor(root, [structuredFirst, secondTask]));
    const observations = await loadRunObservations(execution.directory);
    expect(observations).toHaveLength(2);
    const structured = observations.find((o) => o.taskId === "one");
    expect(structured?.streamAvailable).toBe(true);
    expect(structured?.providerWaitMs).toBe(800 + 900);
    expect(structured?.modelStepCount).toBe(2);
    expect(structured?.providerErrorCount).toBe(0);
    // regeneration reproduces the same attribution from persisted artifacts
    const regenerated = await loadRunObservations(execution.directory);
    expect(regenerated).toEqual(observations);
  });

  it("keeps adapters without structured streams working with null observability", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-attribution-"));
    const tasks = [fakeTask("plain", "plain.txt", "p\n", 'node -e "process.exit(0)"')];
    const execution = await runExperiment(await configFor(root, tasks));
    const observations = await loadRunObservations(execution.directory);
    const observation = observations[0];
    expect(observation?.streamAvailable).toBe(false);
    expect(observation?.providerWaitMs).toBeNull();
    expect(observation?.accepted).toBe(true);
    // process telemetry artifact exists even when no matching process was sampled
    await expect(
      readFile(join(execution.directory, "process-telemetry.jsonl"), "utf8"),
    ).resolves.toBeDefined();
  });

  it("preserves runtime chronology across resume without rewriting records", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-attribution-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", 'node -e "process.exit(0)"'),
      fakeTask("two", "two.txt", "two\n", 'node -e "process.exit(0)"'),
    ];
    const config = await configFor(root, tasks);
    const execution = await runExperiment(config);
    const before = await loadRunObservations(execution.directory);
    const resumed = await resumeExperiment(execution.directory);
    const after = await loadRunObservations(resumed.directory);
    expect(after.map((o) => [o.attemptId, o.providerWaitMs])).toEqual(
      before.map((o) => [o.attemptId, o.providerWaitMs]),
    );
  });

  it("summarizes worker sides including acceptance and stream coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-attribution-"));
    const tasks = [
      fakeTask("good", "good.txt", "g\n", 'node -e "process.exit(0)"'),
      fakeTask("bad", "bad.txt", "b\n", 'node -e "process.exit(1)"'),
    ];
    const execution = await runExperiment(await configFor(root, tasks));
    const observations = await loadRunObservations(execution.directory);
    const side = summarizeWorkerSide(observations, 2);
    expect(side.runs).toBe(2);
    expect(side.acceptedRuns).toBe(1);
    expect(side.acceptanceRate).toBeCloseTo(0.5, 9);
    expect(side.streamCoverage).toBe(0);
  });

  it("leaves historical capacity-prediction artifacts readable and immutable", async () => {
    // Uses the committed capacity experiment as a historical fixture.
    const directory = new URL(
      "../../../experiments/opencode-capacity-curve/exp-2026-08-21-2c5c7311-d6b",
      import.meta.url,
    );
    try {
      const context = await loadCapacityContext(decodeURIComponent(directory.pathname));
      expect(context.curve.points.length).toBeGreaterThan(0);
      const observations = await loadRunObservations(decodeURIComponent(directory.pathname));
      // Historical records predate runtimeObservability: strict-null semantics.
      for (const observation of observations) {
        expect(observation.streamAvailable).toBe(false);
        expect(observation.providerWaitMs).toBeNull();
      }
    } catch (error: unknown) {
      // The fixture must exist in this repository checkout.
      throw error;
    }
  }, 120_000);

  it("emits per-run events needed by attribution analysis", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-attribution-"));
    const tasks = [fakeTask("one", "one.txt", "one\n", 'node -e "process.exit(0)"')];
    const execution = await runExperiment(await configFor(root, tasks));
    const events = await readEvents(join(execution.directory, "events.jsonl"));
    const types = new Set(events.map((event) => event.eventType));
    expect(types.has("agent_process_started")).toBe(true);
    expect(types.has("agent_process_finished")).toBe(true);
  });
});
