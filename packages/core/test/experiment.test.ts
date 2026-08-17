import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../src/config.js";
import { readEvents } from "../src/events.js";
import { runExperiment } from "../src/experiment.js";
import type { ExperimentConfig, TaskDefinition } from "../src/models.js";
import { inspectExperiment, regenerateReport } from "../src/report.js";
import { createGitRepository, fakeTask, writeTaskFile } from "./helpers.js";

async function configFor(
  root: string,
  tasks: ExperimentConfig["tasks"],
  workerCounts: readonly number[],
): Promise<ExperimentConfig> {
  const repository = await createGitRepository(root);
  const taskFile = await writeTaskFile(root, tasks);
  return {
    repository,
    taskFile,
    tasks,
    workerCounts,
    repetitions: 1,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "runs"),
    budget: {},
    seed: 0,
    integration: false,
    integrationValidation: [],
  };
}

describe("experiment execution", () => {
  it("runs a fake-agent worker matrix and regenerates its report", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", "node -e \"require('node:fs').accessSync('one.txt')\""),
      fakeTask("two", "two.txt", "two\n", "node -e \"require('node:fs').accessSync('two.txt')\""),
    ];
    const baseConfig = await configFor(root, tasks, [1, 2]);
    const execution = await runExperiment({
      ...baseConfig,
      integration: true,
      integrationValidation: [
        "node -e \"const fs = require('node:fs'); fs.accessSync('one.txt'); fs.accessSync('two.txt')\"",
      ],
    });
    const report = await regenerateReport(execution.directory);
    expect(report.status).toBe("completed");
    expect(report.metrics.workerResults.map((row) => row.workerCount)).toEqual([1, 2]);
    expect(report.metrics.workerResults.every((row) => row.acceptedTasks === 2)).toBe(true);
    expect(report.metrics.workerResults.every((row) => row.integrationFailureRate === 0)).toBe(
      true,
    );
    const inspection = await inspectExperiment(execution.directory);
    expect(inspection.runResults).toHaveLength(4);
    expect(inspection.trialManifests).toHaveLength(2);
    await expect(access(join(execution.directory, ".worktrees"))).rejects.toThrow();
    expect((await readEvents(join(execution.directory, "events.jsonl"))).length).toBeGreaterThan(0);
  });

  it("classifies validation failure despite a successful agent process", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [fakeTask("bad", "bad.txt", "bad\n", 'node -e "process.exit(1)"')];
    const execution = await runExperiment(await configFor(root, tasks, [1]));
    const inspection = await inspectExperiment(execution.directory);
    const resultPath = inspection.runResults[0];
    expect(resultPath).toBeDefined();
    const result = JSON.parse(await readFile(resultPath ?? "", "utf8")) as unknown;
    expect(result).toMatchObject({
      processExitCode: 0,
      validationResult: "failed",
      accepted: false,
    });
  });

  it("contains one failed task without losing another task's evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("good", "good.txt", "good\n", 'node -e "process.exit(0)"'),
      fakeTask("bad", "bad.txt", "bad\n", 'node -e "process.exit(1)"'),
    ];
    const execution = await runExperiment(await configFor(root, tasks, [2]));
    const report = await regenerateReport(execution.directory);
    expect(report.metrics.workerResults[0]?.acceptedTasks).toBe(1);
    expect((await inspectExperiment(execution.directory)).runResults).toHaveLength(2);
  });

  it("persists a failed partial experiment after an unexpected adapter error", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const valid = fakeTask("good", "good.txt", "good\n", 'node -e "process.exit(0)"');
    const invalid: TaskDefinition = {
      id: "broken",
      description: "missing fake configuration",
      baseCommit: "HEAD",
      validation: ["node --version"],
      timeoutSeconds: 5,
      independent: true,
      dependsOn: [],
    };
    const tasks = [valid, invalid];
    const config = await configFor(root, tasks, [2]);
    await expect(runExperiment(config)).rejects.toThrow(/failed unexpectedly/u);
    const experiment = (await readdir(config.outputDirectory))[0];
    expect(experiment).toBeDefined();
    const outcome = JSON.parse(
      await readFile(join(config.outputDirectory, experiment ?? "", "outcome.json"), "utf8"),
    ) as unknown;
    expect(outcome).toMatchObject({ status: "failed" });
  });

  it("fails closed when uncommitted target state would be omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [fakeTask("good", "good.txt", "good\n", "node --version")];
    const config = await configFor(root, tasks, [1]);
    await writeFile(join(config.repository, "uncommitted.txt"), "not in base commit\n", "utf8");
    await expect(runExperiment(config)).rejects.toThrow(ConfigurationError);
  });

  it("persists a 1-worker by 3-repetition fake-agent experiment as separate trials", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", "node -e \"require('node:fs').accessSync('one.txt')\""),
      fakeTask("two", "two.txt", "two\n", "node -e \"require('node:fs').accessSync('two.txt')\""),
    ];
    const execution = await runExperiment({
      ...(await configFor(root, tasks, [1])),
      repetitions: 3,
      seed: 17,
    });
    const report = await regenerateReport(execution.directory);
    const regenerated = await regenerateReport(execution.directory);
    expect(report.metrics.trialResults).toHaveLength(3);
    expect(report.metrics.workerResults[0]?.trialCount).toBe(3);
    expect(report.metrics.workerResults[0]?.acceptedTasks).toBe(6);
    expect(regenerated.metrics.trialResults.map((trial) => trial.trialId)).toEqual(
      report.metrics.trialResults.map((trial) => trial.trialId),
    );
    expect(regenerated.metrics.workerResults[0]?.medianAcceptedTasksPerHour).toBe(
      report.metrics.workerResults[0]?.medianAcceptedTasksPerHour,
    );
    const inspection = await inspectExperiment(execution.directory);
    expect(inspection.trialManifests).toHaveLength(3);
    expect(inspection.runResults).toHaveLength(6);
    const events = await readEvents(join(execution.directory, "events.jsonl"));
    const trialIds = new Set(
      events
        .filter((item) => item.eventType === "task_finished")
        .map((item) => String(item.data.trialId)),
    );
    expect(trialIds).toEqual(
      new Set(["workers-1-trial-1", "workers-1-trial-2", "workers-1-trial-3"]),
    );
  });

  it("persists a 2-worker by 3-repetition matrix without merging trials", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", "node -e \"require('node:fs').accessSync('one.txt')\""),
      fakeTask("two", "two.txt", "two\n", "node -e \"require('node:fs').accessSync('two.txt')\""),
    ];
    const execution = await runExperiment({
      ...(await configFor(root, tasks, [1, 2])),
      repetitions: 3,
      seed: 17,
    });
    const report = await regenerateReport(execution.directory);
    expect(report.metrics.trialResults).toHaveLength(6);
    expect(report.metrics.trialResults.map((trial) => trial.trialId)).toEqual([
      "workers-1-trial-1",
      "workers-1-trial-2",
      "workers-1-trial-3",
      "workers-2-trial-1",
      "workers-2-trial-2",
      "workers-2-trial-3",
    ]);
    expect(report.metrics.workerResults.map((row) => row.trialCount)).toEqual([3, 3]);
    expect((await inspectExperiment(execution.directory)).runResults).toHaveLength(12);
    const orders = new Map<string, string>();
    for (const trial of report.metrics.trialResults) {
      const key = `${trial.repetition}`;
      const order = trial.taskOrder.join(",");
      const previous = orders.get(key);
      if (previous === undefined) orders.set(key, order);
      else expect(order).toEqual(previous);
    }
  });

  it("uses the same seeded task order for matching worker-count trials", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("alpha", "a.txt", "a\n", "node --version"),
      fakeTask("bravo", "b.txt", "b\n", "node --version"),
      fakeTask("charlie", "c.txt", "c\n", "node --version"),
      fakeTask("delta", "d.txt", "d\n", "node --version"),
    ];
    const execution = await runExperiment({
      ...(await configFor(root, tasks, [1, 2])),
      repetitions: 2,
      seed: 99,
    });
    const report = await regenerateReport(execution.directory);
    const one = report.metrics.trialResults.find((trial) => trial.trialId === "workers-1-trial-2");
    const two = report.metrics.trialResults.find((trial) => trial.trialId === "workers-2-trial-2");
    expect(one?.taskOrder).toEqual(two?.taskOrder);
    expect(one?.trialSeed).toBe(two?.trialSeed);
    const trialPath = join(execution.directory, "trials", "workers-1-trial-2", "trial.json");
    const persisted = JSON.parse(await readFile(trialPath, "utf8")) as { taskOrder: string[] };
    expect(persisted.taskOrder).toEqual(one?.taskOrder);
  });

  it("keeps other trials intact when one repetition fails unexpectedly", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const good = fakeTask("good", "good.txt", "good\n", 'node -e "process.exit(0)"');
    const brittle = {
      ...fakeTask("brittle", "brittle.txt", "brittle\n", 'node -e "process.exit(0)"'),
      fake: {
        files: { "brittle.txt": "brittle\n" },
        exitCode: 0,
        delayMs: 10,
        stdout: "done",
        stderr: "",
        failOnRepetition: 2,
      },
    };
    const config = {
      ...(await configFor(root, [good, brittle], [1])),
      repetitions: 3,
      seed: 3,
    };
    await expect(runExperiment(config)).rejects.toThrow(/trial/u);
    const experiment = (await readdir(config.outputDirectory))[0];
    expect(experiment).toBeDefined();
    const directory = join(config.outputDirectory, experiment ?? "");
    const report = await regenerateReport(directory);
    expect(report.status).toBe("failed");
    expect(report.metrics.trialResults.map((trial) => trial.trialId)).toEqual([
      "workers-1-trial-1",
      "workers-1-trial-2",
      "workers-1-trial-3",
    ]);
    const inspection = await inspectExperiment(directory);
    const trial1Runs = inspection.runResults.filter((path) => path.includes("workers-1-trial-1"));
    const trial3Runs = inspection.runResults.filter((path) => path.includes("workers-1-trial-3"));
    expect(trial1Runs.length).toBe(2);
    expect(trial3Runs.length).toBe(2);
    const events = await readEvents(join(directory, "events.jsonl"));
    expect(events.some((item) => item.eventType === "task_failed")).toBe(true);
  });

  it("records phase timings on the matching run artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", "node --version"),
      fakeTask("two", "two.txt", "two\n", "node --version"),
    ];
    const execution = await runExperiment({
      ...(await configFor(root, tasks, [2])),
      repetitions: 1,
    });
    const inspection = await inspectExperiment(execution.directory);
    expect(inspection.runResults).toHaveLength(2);
    for (const resultPath of inspection.runResults) {
      const result = JSON.parse(await readFile(resultPath, "utf8")) as {
        trialId: string;
        runId: string;
        phaseTimings: {
          worktreeSetupMs: number | null;
          agentExecutionMs: number | null;
          validationMs: number | null;
          integrationMs: number | null;
          worktreeCleanupMs: number | null;
          totalRunMs: number;
        };
      };
      expect(result.trialId).toBe("workers-2-trial-1");
      expect(result.phaseTimings.worktreeSetupMs).toBeGreaterThan(0);
      expect(result.phaseTimings.agentExecutionMs).toBeGreaterThan(0);
      expect(result.phaseTimings.validationMs).toBeGreaterThan(0);
      expect(result.phaseTimings.worktreeCleanupMs).toBeGreaterThan(0);
      expect(result.phaseTimings.integrationMs).toBeNull();
      expect(result.phaseTimings.totalRunMs).toBeGreaterThanOrEqual(
        (result.phaseTimings.worktreeSetupMs ?? 0) +
          (result.phaseTimings.agentExecutionMs ?? 0) +
          (result.phaseTimings.validationMs ?? 0) +
          (result.phaseTimings.worktreeCleanupMs ?? 0),
      );
      expect(resultPath).toContain(result.runId);
    }
  });
});
