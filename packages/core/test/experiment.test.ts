import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../src/config.js";
import { readEvents } from "../src/events.js";
import { runExperiment } from "../src/experiment.js";
import type { ExperimentConfig, TaskDefinition } from "../src/models.js";
import { regenerateReport } from "../src/report.js";
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
    agent: "fake",
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
    const results = await readdir(join(execution.directory, "runs"));
    expect(results).toHaveLength(4);
    await expect(access(join(execution.directory, ".worktrees"))).rejects.toThrow();
    expect((await readEvents(join(execution.directory, "events.jsonl"))).length).toBeGreaterThan(0);
  });

  it("classifies validation failure despite a successful agent process", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-experiment-"));
    const tasks = [fakeTask("bad", "bad.txt", "bad\n", 'node -e "process.exit(1)"')];
    const execution = await runExperiment(await configFor(root, tasks, [1]));
    const runName = (await readdir(join(execution.directory, "runs")))[0];
    expect(runName).toBeDefined();
    const result = JSON.parse(
      await readFile(join(execution.directory, "runs", runName ?? "", "result.json"), "utf8"),
    ) as unknown;
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
    expect(await readdir(join(execution.directory, "runs"))).toHaveLength(2);
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
    await expect(runExperiment(config)).rejects.toThrow(/worker task/u);
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
});
