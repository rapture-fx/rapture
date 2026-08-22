import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../src/config.js";
import { readEvents } from "../src/events.js";
import { classifyProviderBlock, resumeExperiment, runExperiment } from "../src/experiment.js";
import type { ExperimentConfig, MatrixCompletion, TaskDefinition } from "../src/models.js";
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

function providerBlockedTask(id: string): TaskDefinition {
  return {
    ...fakeTask(id, `${id}.txt`, `${id}\n`, "node --version"),
    fake: {
      files: { [`${id}.txt`]: `${id}\n` },
      exitCode: 1,
      delayMs: 10,
      stdout: "done",
      stderr: "insufficient_quota: your account has hit a usage limit",
    },
  };
}

describe("experiment resume and continuation", () => {
  it("classifies provider blocks from process output", () => {
    expect(classifyProviderBlock({ exitCode: 1, stdout: "", stderr: "rate limit exceeded" })).toBe(
      true,
    );
    expect(classifyProviderBlock({ exitCode: 1, stdout: "", stderr: "quota exhausted" })).toBe(
      true,
    );
    expect(
      classifyProviderBlock({
        exitCode: 1,
        stdout: "",
        stderr: "please try again at a later time",
      }),
    ).toBe(true);
    expect(classifyProviderBlock({ exitCode: 1, stdout: "", stderr: "500 internal error" })).toBe(
      false,
    );
    expect(classifyProviderBlock({ exitCode: 0, stdout: "", stderr: "rate limit" })).toBe(false);
  });

  it("records provider-blocked runs as non-terminal and reports a blocked matrix", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const tasks = [
      fakeTask("good", "good.txt", "good\n", "node --version"),
      providerBlockedTask("quota"),
    ];
    const execution = await runExperiment(await configFor(root, tasks, [1]));
    const report = await regenerateReport(execution.directory);
    expect(report.completion?.status).toBe("blocked");
    expect(report.completion?.providerBlockedRuns).toBe(1);
    expect(report.completion?.acceptedRuns).toBe(1);
    const events = await readEvents(join(execution.directory, "events.jsonl"));
    expect(events.some((item) => item.eventType === "provider_blocked")).toBe(true);
    expect(report.metrics.workerResults[0]?.validationFailures).toBe(0);
    await expect(
      access(join(execution.directory, "trials", "workers-1-trial-1", "runs")),
    ).resolves.toBeUndefined();
  });

  it("resumes without rerunning terminal runs and preserves logical ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const tasks = [
      fakeTask("one", "one.txt", "one\n", "node --version"),
      fakeTask("two", "two.txt", "two\n", "node --version"),
    ];
    const first = await runExperiment(await configFor(root, tasks, [1]));
    const firstEvents = await readEvents(join(first.directory, "events.jsonl"));
    const firstFinished = firstEvents.filter((item) => item.eventType === "task_finished");
    expect(firstFinished).toHaveLength(2);

    const second = await resumeExperiment(first.directory);
    expect(second.directory).toBe(first.directory);
    const events = await readEvents(join(second.directory, "events.jsonl"));
    const continuationStarted = events.filter((item) => item.eventType === "continuation_started");
    expect(continuationStarted).toHaveLength(1);
    const runSkipped = events.filter((item) => item.eventType === "run_skipped");
    expect(runSkipped).toHaveLength(2);
    const finished = events.filter((item) => item.eventType === "task_finished");
    expect(finished).toHaveLength(2);

    const continuations = await readFile(join(second.directory, "continuations.jsonl"), "utf8");
    const record = JSON.parse(continuations.trim().split("\n").at(-1) ?? "{}") as {
      resumedRuns: number;
      skippedCompletedRuns: number;
      providerBlockedRuns: number;
      newOutstandingRuns: number;
    };
    expect(record.resumedRuns).toBe(0);
    expect(record.skippedCompletedRuns).toBe(2);
    expect(record.providerBlockedRuns).toBe(0);
    expect(record.newOutstandingRuns).toBe(0);

    const report = await regenerateReport(second.directory);
    expect(report.status).toBe("completed");
    expect(report.completion?.status).toBe("completed");
    expect(report.completion?.completedLogicalRuns).toBe(2);
  });

  it("reruns provider-blocked runs on resume and grows the attempt count", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const tasks = [providerBlockedTask("quota")];
    const first = await runExperiment(await configFor(root, tasks, [1]));
    const ledgerPath = join(first.directory, "logical-runs.jsonl");
    const before = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { logicalRunId: string; attemptCount: number; state: string },
      );
    const beforeFinal = before.at(-1);
    expect(before).toHaveLength(2);
    expect(beforeFinal?.state).toBe("provider_blocked");
    expect(beforeFinal?.attemptCount).toBe(1);

    const second = await resumeExperiment(first.directory);
    const after = (await readFile(join(second.directory, "logical-runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { logicalRunId: string; attemptCount: number; state: string },
      );
    const afterFinal = after.at(-1);
    expect(after).toHaveLength(4);
    expect(afterFinal?.logicalRunId).toBe(beforeFinal?.logicalRunId);
    expect(afterFinal?.attemptCount).toBe(2);
    const report = await regenerateReport(second.directory);
    expect(report.completion?.status).toBe("blocked");
    expect(report.completion?.providerBlockedRuns).toBe(1);
  });

  it("fails closed when the recorded manifest identity drifts", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const tasks = [fakeTask("one", "one.txt", "one\n", "node --version")];
    const first = await runExperiment(await configFor(root, tasks, [1]));
    const manifestPath = join(first.directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      experimentIdentityHash: string;
    };
    manifest.experimentIdentityHash = "deadbeef";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await expect(resumeExperiment(first.directory)).rejects.toThrow(ConfigurationError);
  });

  it("records infrastructure failures as rerun-eligible and resumes them", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const broken: TaskDefinition = {
      id: "broken",
      description: "missing fake configuration",
      baseCommit: "HEAD",
      validation: ["node --version"],
      timeoutSeconds: 5,
      independent: true,
      dependsOn: [],
    };
    const tasks = [fakeTask("good", "good.txt", "good\n", "node --version"), broken];
    const config = await configFor(root, tasks, [2]);
    await expect(runExperiment(config)).rejects.toThrow(/failed unexpectedly/u);
    const experiment = (await readdir(config.outputDirectory))[0];
    expect(experiment).toBeDefined();
    const directory = join(config.outputDirectory, experiment ?? "");
    const report = await regenerateReport(directory);
    expect(report.completion?.infrastructureFailedRuns).toBe(1);
    expect(report.completion?.acceptedRuns).toBe(1);
    const events = await readEvents(join(directory, "events.jsonl"));
    expect(events.some((item) => item.eventType === "infrastructure_failed")).toBe(true);

    const resumed = await resumeExperiment(directory).catch((error: unknown) => {
      expect(error).toBeDefined();
      return { directory };
    });
    const ledgerLines = (await readFile(join(resumed.directory, "logical-runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    const brokenEntries = ledgerLines
      .map((line) => JSON.parse(line) as { taskId: string; attemptCount: number; state: string })
      .filter((entry) => entry.taskId === "broken");
    expect(brokenEntries).toHaveLength(4);
    const latestBroken = brokenEntries.at(-1);
    expect(latestBroken?.attemptCount).toBe(2);
    expect(latestBroken?.state).toBe("infrastructure_failed");
  });

  it("computes a completed matrix from terminal run states", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-resume-"));
    const tasks = [fakeTask("one", "one.txt", "one\n", "node --version")];
    const execution = await runExperiment(await configFor(root, tasks, [1]));
    const outcome = JSON.parse(
      await readFile(join(execution.directory, "outcome.json"), "utf8"),
    ) as { completion: MatrixCompletion };
    expect(outcome.completion.expectedLogicalRuns).toBe(1);
    expect(outcome.completion.completedLogicalRuns).toBe(1);
    expect(outcome.completion.acceptedRuns).toBe(1);
    expect(outcome.completion.status).toBe("completed");
    expect(outcome.completion.completedTrials).toBe(1);
    expect(outcome.completion.totalTrials).toBe(1);
  });
});
