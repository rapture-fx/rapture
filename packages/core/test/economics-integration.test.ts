import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenCodeUsage } from "../src/adapters/opencode-usage.js";
import type { PricingContext } from "../src/economics.js";
import { loadPricingContext } from "../src/economics.js";
import { runExperiment } from "../src/experiment.js";
import type { ExperimentConfig } from "../src/models.js";
import { regenerateReport } from "../src/report.js";
import { createGitRepository, writeTaskFile } from "./helpers.js";

const pricing: PricingContext = {
  provider: "test-provider",
  model: "fake-model",
  currency: "USD",
  inputCostPerMillionTokens: 2,
  outputCostPerMillionTokens: 4,
  cachedInputCostPerMillionTokens: null,
  reasoningCostPerMillionTokens: null,
  machineCostPerHour: 3.6,
  pricingSource: "integration-test",
  pricingEffectiveDate: "2026-08-21T00:00:00.000Z",
};

function usageFor(inputTokens: number, outputTokens: number): object {
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: null,
    reasoningTokens: null,
    providerReportedCost: null,
    currency: "USD",
  };
}

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
    workerCounts: [1],
    repetitions: 1,
    agent: "fake",
    agentModel: null,
    outputDirectory: join(root, "runs"),
    budget: {},
    seed: 0,
    integration: false,
    integrationValidation: [],
    pricing,
  };
}

describe("engineering economics integration", () => {
  it("records deterministic usage provenance and exact derived costs", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-econ-integration-"));
    const tasks = [
      {
        id: "priced",
        description: "write priced.txt",
        baseCommit: "HEAD",
        validation: ["node -e \"require('node:fs').accessSync('priced.txt')\""],
        timeoutSeconds: 10,
        independent: true,
        dependsOn: [],
        fake: {
          files: { "priced.txt": "priced\n" },
          exitCode: 0,
          delayMs: 5,
          stdout: "done",
          stderr: "",
          usage: usageFor(1_000_000, 500_000),
        },
      },
    ];
    const config = await configFor(root, tasks);
    const execution = await runExperiment(config);
    const report = await regenerateReport(execution.directory);

    // Usage provenance flows through events into the economics report.
    expect(report.economics.usageAvailability.totalRuns).toBe(1);
    expect(report.economics.usageAvailability.runsWithUsage).toBe(1);

    const worker = report.economics.workers[0];
    expect(worker?.inputTokensTotal).toBe(1_000_000);
    expect(worker?.outputTokensTotal).toBe(500_000);
    // input at 2/Mtok = 2; output at 4/Mtok * 0.5Mtok = 2.
    expect(worker?.derivedProviderCostTotal).toEqual({ amount: 4, currency: "USD" });
    expect(worker?.acceptedTasks).toBe(1);
    expect(worker?.providerCostPerAcceptedTask).toEqual({ amount: 4, currency: "USD" });
    expect(worker?.acceptedTasksPerProviderDollar).toBeCloseTo(0.25, 10);

    // Machine cost is wall-clock trial time on one shared host, not multiplied
    // by anything; it must equal hours * configured hourly rate.
    if (worker?.machineWallMsTotal === null || worker === undefined) {
      throw new Error("machine wall time missing");
    }
    const expectedMachine =
      (worker.machineWallMsTotal / 3_600_000) * (pricing.machineCostPerHour ?? 0);
    expect(worker.machineCostTotal?.amount).toBeCloseTo(expectedMachine, 10);

    // Pricing context is persisted with experiment provenance.
    const manifest = JSON.parse(
      await readFile(join(execution.directory, "manifest.json"), "utf8"),
    ) as { pricing?: PricingContext };
    expect(manifest.pricing).toEqual(pricing);
  }, 30_000);

  it("charges rejected runs while counting only accepted output", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-econ-rejected-"));
    const tasks = [
      {
        id: "good",
        description: "write good.txt",
        baseCommit: "HEAD",
        validation: ["node -e \"require('node:fs').accessSync('good.txt')\""],
        timeoutSeconds: 10,
        independent: true,
        dependsOn: [],
        fake: {
          files: { "good.txt": "good\n" },
          exitCode: 0,
          delayMs: 5,
          stdout: "done",
          stderr: "",
          usage: usageFor(1_000_000, 1_000_000),
        },
      },
      {
        id: "bad",
        description: "write bad.txt that fails validation",
        baseCommit: "HEAD",
        validation: ['node -e "process.exit(1)"'],
        timeoutSeconds: 10,
        independent: true,
        dependsOn: [],
        fake: {
          files: { "bad.txt": "bad\n" },
          exitCode: 0,
          delayMs: 5,
          stdout: "done",
          stderr: "",
          usage: usageFor(1_000_000, 1_000_000),
        },
      },
      {
        id: "slow",
        description: "times out before finishing",
        baseCommit: "HEAD",
        validation: ["node -e \"require('node:fs').accessSync('slow.txt')\""],
        timeoutSeconds: 1,
        independent: true,
        dependsOn: [],
        fake: {
          files: {},
          exitCode: 0,
          delayMs: 5_000,
          stdout: "",
          stderr: "",
          usage: usageFor(250_000, 250_000),
        },
      },
    ];
    const config = await configFor(root, tasks);
    const execution = await runExperiment(config);
    const report = await regenerateReport(execution.directory);
    const worker = report.economics.workers[0];

    expect(report.status).toBe("completed");
    expect(worker?.totalRuns).toBe(3);
    expect(worker?.acceptedTasks).toBe(1);
    expect(worker?.rejectedOrTimedOutRuns).toBe(2);

    // All three runs consume tokens regardless of outcome.
    expect(worker?.inputTokensTotal).toBe(2_250_000);
    expect(worker?.derivedProviderCostTotal).toEqual({
      amount: 2.25 * 2 + 2.25 * 4,
      currency: "USD",
    });
    // Cost efficiency uses accepted output only.
    expect(worker?.providerCostPerAcceptedTask).toEqual({ amount: 13.5, currency: "USD" });
  }, 60_000);

  it("keeps legacy-format experiments valid with null monetary fields", async () => {
    // Reconstruct a pre-economics experiment artifact set: no usage fields on
    // runs and no pricing block in the manifest.
    const root = await mkdtemp(join(tmpdir(), "rapture-econ-historical-"));
    const manifest = {
      schemaVersion: 2,
      experimentId: "exp-legacy",
    };
    const events = [
      {
        schemaVersion: 1,
        sequence: 1,
        eventType: "trial_finished",
        experimentId: "exp-legacy",
        timestamp: "2026-08-01T00:00:00.000Z",
        data: {
          trialId: "workers-1-trial-1",
          workerCount: 1,
          repetition: 1,
          durationMs: 60_000,
        },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        eventType: "task_finished",
        experimentId: "exp-legacy",
        timestamp: "2026-08-01T00:01:00.000Z",
        data: {
          trialId: "workers-1-trial-1",
          workerCount: 1,
          accepted: true,
          runState: "accepted",
          durationMs: 50_000,
          validationResult: "passed",
          commands: [],
          testInvocations: [],
          buildInvocations: [],
          tokenUsage: null,
          providerCost: null,
          phaseTimings: {
            worktreeSetupMs: 10,
            queueWaitMs: 0,
            agentExecutionMs: 50_000,
            validationMs: 100,
            artifactPersistenceMs: 5,
            integrationMs: null,
            worktreeCleanupMs: 10,
            otherOrchestrationMs: 5,
            totalRunMs: 50_000,
          },
        },
      },
      {
        schemaVersion: 1,
        sequence: 3,
        eventType: "task_finished",
        experimentId: "exp-legacy",
        timestamp: "2026-08-01T00:02:00.000Z",
        data: {
          trialId: "workers-1-trial-1",
          workerCount: 1,
          accepted: false,
          runState: "timed_out",
          durationMs: 10_000,
          validationResult: "not_run",
          commands: [],
          testInvocations: [],
          buildInvocations: [],
          tokenUsage: null,
          providerCost: null,
          phaseTimings: {
            worktreeSetupMs: 10,
            queueWaitMs: 0,
            agentExecutionMs: 10_000,
            validationMs: null,
            artifactPersistenceMs: 5,
            integrationMs: null,
            worktreeCleanupMs: 10,
            otherOrchestrationMs: 5,
            totalRunMs: 10_000,
          },
        },
      },
    ];
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest), "utf8");
    await writeFile(
      join(root, "events.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n"),
      "utf8",
    );
    const report = await regenerateReport(root);
    expect(report.experimentId).toBe("exp-legacy");
    expect(report.metrics.workerResults[0]?.acceptedTasks).toBe(1);
    expect(report.economics.pricingContext).toBeNull();
    const worker = report.economics.workers[0];
    expect(worker?.totalRuns).toBe(2);
    expect(worker?.inputTokensTotal).toBeNull();
    expect(worker?.derivedProviderCostTotal).toBeNull();
    expect(worker?.providerReportedCostTotal).toBeNull();
    // Agent-time metrics remain derivable from existing timing data.
    expect(worker?.agentWallMsTotal).toBe(60_000);
    expect(worker?.acceptedTasksPerAgentHour).toBeCloseTo(60, 10);
    expect(worker?.machineWallMsTotal).toBe(60_000);
  });

  it("parses OpenCode step_finish usage defensively from structured JSON", () => {
    const stream = [
      JSON.stringify({
        type: "step_finish",
        timestamp: 1787236124517,
        sessionID: "ses_x",
        part: {
          id: "prt_1",
          reason: "tool-calls",
          type: "step-finish",
          tokens: {
            total: 8286,
            input: 8121,
            output: 151,
            reasoning: 14,
            cache: { write: 0, read: 0 },
          },
          cost: 0,
        },
      }),
      JSON.stringify({
        type: "step_finish",
        timestamp: 1787236127940,
        sessionID: "ses_x",
        part: {
          id: "prt_2",
          reason: "stop",
          type: "step-finish",
          tokens: {
            total: 9016,
            input: 509,
            output: 302,
            reasoning: 13,
            cache: { write: 40, read: 8192 },
          },
          cost: 0.25,
        },
      }),
      "this line is human prose and must be ignored",
      '{"type":"step_start","part":{}}',
    ].join("\n");
    const parsed = parseOpenCodeUsage(stream);
    expect(parsed.steps).toBe(2);
    expect(parsed.usage).not.toBeNull();
    expect(parsed.usage?.inputTokens).toBe(8121 + 509);
    expect(parsed.usage?.outputTokens).toBe(151 + 302);
    expect(parsed.usage?.reasoningTokens).toBe(14 + 13);
    expect(parsed.usage?.cachedInputTokens).toBe(8192);
    expect(parsed.usage?.providerReportedCost).toBeCloseTo(0.25, 10);
    expect(parsed.usage?.usageSource).toBe("cli_structured");
    // A nonzero cache-write category has no price slot, so derivation must
    // fail closed rather than silently ignore those tokens.
    expect(parsed.sawCacheWrite).toBe(true);
    expect(parsed.usage?.uncategorizedTokenCategories).toEqual(["cache_write"]);

    const empty = parseOpenCodeUsage('no json here\n{"type":"text"}');
    expect(empty.usage).toBeNull();

    const incompleteSteps = parseOpenCodeUsage(JSON.stringify({ type: "step_finish", part: {} }));
    expect(incompleteSteps.usage).toBeNull();
  });

  it("loads versioned pricing context referenced by an experiment", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-econ-pricing-file-"));
    const pricingPath = join(root, "pricing.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(pricingPath, JSON.stringify(pricing), "utf8");
    const loaded = await loadPricingContext(pricingPath);
    expect(loaded.currency).toBe("USD");
    expect(loaded.pricingEffectiveDate).toBe(pricing.pricingEffectiveDate);
  });
});
