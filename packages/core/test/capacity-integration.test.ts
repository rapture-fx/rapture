import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapacityContext, regenerateStepPredictions } from "../src/capacity-report.js";
import { readEvents } from "../src/events.js";
import { resumeExperiment, runExperiment } from "../src/experiment.js";
import { computeFrozenIntegrity, integrityDrift, loadExpectedIntegrity } from "../src/integrity.js";
import type { ExperimentConfig } from "../src/models.js";
import {
  createPredictionStore,
  PredictionAlreadyExistsError,
  type PredictionRecord,
} from "../src/prediction-store.js";
import { regenerateReport } from "../src/report.js";
import { createGitRepository, fakeTask, writeTaskFile } from "./helpers.js";

async function configFor(
  root: string,
  workerCounts: readonly number[],
  repetitions = 2,
): Promise<ExperimentConfig> {
  const repository = await createGitRepository(root);
  const tasks = [
    fakeTask("one", "one.txt", "one\n", 'node -e "process.exit(0)"'),
    fakeTask("two", "two.txt", "two\n", 'node -e "process.exit(0)"'),
  ];
  const taskFile = await writeTaskFile(root, tasks);
  return {
    repository,
    taskFile,
    tasks,
    workerCounts,
    repetitions,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "runs"),
    budget: {},
    seed: 20260817,
    integration: false,
    integrationValidation: [],
    executionOrder: "worker-major",
  };
}

describe("capacity-prediction integration", () => {
  it("persists predictions before held-out worker counts execute", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-capacity-"));
    const config = await configFor(root, [1, 2, 3]);
    const execution = await runExperiment(config);
    const store = await createPredictionStore(join(execution.directory, "predictions.jsonl"));
    const { predictions, outcomes } = await store.read();
    // 5 predictors x steps (1->2, 2->3)
    expect(predictions).toHaveLength(10);
    expect(outcomes).toHaveLength(2);

    const events = await readEvents(join(execution.directory, "events.jsonl"));
    for (const target of [2, 3]) {
      const firstTargetTrialStart = Math.min(
        ...events
          .filter(
            (event) =>
              event.eventType === "trial_started" &&
              (event.data as { workerCount?: number }).workerCount === target,
          )
          .map((event) => Date.parse(event.timestamp)),
      );
      const stepPredictions = predictions.filter(
        (prediction) => prediction.targetWorkerCount === target,
      );
      expect(stepPredictions.length).toBeGreaterThan(0);
      for (const prediction of stepPredictions) {
        expect(Date.parse(prediction.persistedAt)).toBeLessThan(firstTargetTrialStart);
        // The information set must exclude the held-out worker count.
        expect(prediction.observedWorkerCounts).not.toContain(target);
      }
    }
  });

  it("cannot overwrite predictions and appends each outcome only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-capacity-"));
    const config = await configFor(root, [1, 2]);
    const execution = await runExperiment(config);
    const store = await createPredictionStore(join(execution.directory, "predictions.jsonl"));
    const before = await store.read();
    expect(before.predictions.length).toBeGreaterThan(0);
    await expect(
      store.appendPrediction({ ...before.predictions[0] } as PredictionRecord),
    ).rejects.toThrow(PredictionAlreadyExistsError);
    const after = await store.read();
    expect(after.predictions).toEqual(before.predictions);
  });

  it("regenerates identical predictions from persisted restricted evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-capacity-"));
    const config = await configFor(root, [1, 2, 3]);
    const execution = await runExperiment(config);
    const context = await loadCapacityContext(execution.directory);
    const regenerated = regenerateStepPredictions(context, [1, 2, 3], 2);
    const store = await createPredictionStore(join(execution.directory, "predictions.jsonl"));
    const { predictions } = await store.read();
    let compared = 0;
    for (const step of regenerated) {
      for (const prediction of step.predictions) {
        const storedMatch = predictions.find(
          (item) =>
            item.predictorId === prediction.predictor.id &&
            item.targetWorkerCount === prediction.targetWorkerCount &&
            JSON.stringify(item.observedWorkerCounts) ===
              JSON.stringify(prediction.evidence.observedWorkerCounts),
        );
        expect(storedMatch).toBeDefined();
        expect(storedMatch?.predictedState).toBe(prediction.predictedState);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("resume preserves the prediction chronology without rewriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-capacity-"));
    const config = await configFor(root, [1, 2]);
    const execution = await runExperiment(config);
    const store = await createPredictionStore(join(execution.directory, "predictions.jsonl"));
    const before = await store.read();
    const resumed = await resumeExperiment(execution.directory);
    const report = await regenerateReport(resumed.directory);
    expect(report.status).toBe("completed");
    const after = await createPredictionStore(join(resumed.directory, "predictions.jsonl")).then(
      (store) => store.read(),
    );
    expect(after.predictions.map((item) => item.persistedAt)).toEqual(
      before.predictions.map((item) => item.persistedAt),
    );
    expect(after.outcomes.map((item) => item.recordedAt)).toEqual(
      before.outcomes.map((item) => item.recordedAt),
    );
  });

  it("records a preflight host-state snapshot with provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-capacity-"));
    const config = await configFor(root, [1]);
    const execution = await runExperiment(config);
    const hostState = JSON.parse(
      await readFile(join(execution.directory, "host-state.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hostState).toMatchObject({ schemaVersion: 1 });
    expect(typeof hostState.totalMemoryBytes).toBe("number");
    expect(Array.isArray(hostState.activeAgentProcesses)).toBe(true);
    expect(Array.isArray(hostState.agentEnvironmentVariables)).toBe(true);
  });

  it("leaves historical frozen experiment artifacts unchanged", async () => {
    const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    for (const name of [
      "real-scale-2",
      "real-scale-4",
      "opencode-scale-4",
      "opencode-scale-4-diagnostic",
    ]) {
      const expected = await loadExpectedIntegrity(repoRoot, name);
      if (expected === null) continue;
      const actual = await computeFrozenIntegrity(repoRoot, name);
      expect(integrityDrift(expected, actual), `integrity drift for ${name}`).toEqual([]);
    }
  }, 120_000);
});
