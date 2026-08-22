#!/usr/bin/env node
/**
 * Derive the real-work external-validity analysis from persisted run artifacts.
 *
 * Reads only what the experiment wrote, so it can be re-run against the committed
 * artifacts to reproduce every number quoted in the report. Missing values stay null:
 * nothing here substitutes a zero for an absent measurement.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const experimentRoot = resolve(process.argv[2] ?? "experiments/real-work-external-validity-v1");

async function findExperiment(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("exp-"),
  );
  if (directories.length !== 1)
    throw new Error(`expected exactly one experiment directory in ${root}`);
  return join(root, directories[0].name);
}

async function loadRuns(directory) {
  const trialsRoot = join(directory, "trials");
  const trials = await readdir(trialsRoot, { withFileTypes: true });
  const runs = [];
  for (const trial of trials.filter((entry) => entry.isDirectory())) {
    const runsRoot = join(trialsRoot, trial.name, "runs");
    const runDirectories = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
    for (const runDirectory of runDirectories.filter((entry) => entry.isDirectory())) {
      runs.push(
        JSON.parse(await readFile(join(runsRoot, runDirectory.name, "result.json"), "utf8")),
      );
    }
  }
  return runs;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const ratio = (numerator, denominator) =>
  numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
const fixed = (value, digits = 2) => (value === null ? "n/a" : value.toFixed(digits));

const directory = await findExperiment(experimentRoot);
const runs = await loadRuns(directory);
const trials = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
const workerCounts = [...new Set(runs.map((run) => run.workerCount))].sort((a, b) => a - b);

/** Trial-level wall clock: first start to last finish among that trial's runs. */
function trialRows() {
  const byTrial = new Map();
  for (const run of runs) {
    const row = byTrial.get(run.trialId) ?? {
      trialId: run.trialId,
      workerCount: run.workerCount,
      repetition: run.repetition,
      runs: [],
    };
    row.runs.push(run);
    byTrial.set(run.trialId, row);
  }
  return [...byTrial.values()]
    .map((row) => {
      const started = Math.min(...row.runs.map((run) => Date.parse(run.startedAt)));
      const finished = Math.max(...row.runs.map((run) => Date.parse(run.finishedAt)));
      const wallMs = finished - started;
      const accepted = row.runs.filter((run) => run.runState === "accepted").length;
      return {
        ...row,
        wallMs,
        accepted,
        acceptedPerHour: wallMs > 0 ? (accepted / wallMs) * 3_600_000 : null,
        medianTaskLatencyMs: median(row.runs.map((run) => run.durationMs)),
        agentMsTotal: sum(row.runs.map((run) => run.phaseTimings?.agentExecutionMs ?? 0)),
      };
    })
    .sort((a, b) => a.workerCount - b.workerCount || a.repetition - b.repetition);
}

const rows = trialRows();

console.log("## Run completion accounting\n");
const states = {};
for (const run of runs) states[run.runState] = (states[run.runState] ?? 0) + 1;
console.log(`total logical runs: ${runs.length}`);
for (const [state, count] of Object.entries(states).sort()) console.log(`  ${state}: ${count}`);
const failures = runs.filter((run) => run.failureClassification !== null);
const classifications = {};
for (const run of failures) {
  classifications[run.failureClassification] =
    (classifications[run.failureClassification] ?? 0) + 1;
}
console.log("failure classifications:");
for (const [name, count] of Object.entries(classifications).sort())
  console.log(`  ${name}: ${count}`);

console.log("\n## Per-trial results\n");
console.log("workers  rep  wall-s  accepted/4  accepted-per-hour  median-task-latency-s  agent-s");
for (const row of rows) {
  console.log(
    [
      String(row.workerCount).padStart(7),
      String(row.repetition).padStart(4),
      fixed(row.wallMs / 1000, 1).padStart(7),
      `${row.accepted}/${row.runs.length}`.padStart(11),
      fixed(row.acceptedPerHour).padStart(18),
      fixed(row.medianTaskLatencyMs / 1000, 1).padStart(22),
      fixed(row.agentMsTotal / 1000, 1).padStart(8),
    ].join(""),
  );
}

console.log("\n## Primary metrics\n");
const perWorker = new Map();
for (const workerCount of workerCounts) {
  const workerRows = rows.filter((row) => row.workerCount === workerCount);
  const workerRuns = runs.filter((run) => run.workerCount === workerCount);
  const throughputs = workerRows
    .map((row) => row.acceptedPerHour)
    .filter((value) => value !== null);
  perWorker.set(workerCount, {
    medianThroughput: median(throughputs),
    throughputs,
    accepted: workerRuns.filter((run) => run.runState === "accepted").length,
    total: workerRuns.length,
    medianWallMs: median(workerRows.map((row) => row.wallMs)),
    agentMs: sum(workerRuns.map((run) => run.phaseTimings?.agentExecutionMs ?? 0)),
    machineMs: sum(workerRows.map((row) => row.wallMs)),
    medianTaskLatencyMs: median(workerRuns.map((run) => run.durationMs)),
  });
}
const base = perWorker.get(workerCounts[0]);
for (const workerCount of workerCounts) {
  const entry = perWorker.get(workerCount);
  const speedup = ratio(entry.medianThroughput, base.medianThroughput);
  console.log(
    `T(${workerCount}) = ${fixed(entry.medianThroughput)} accepted tasks/wall-clock hour  ` +
      `[trials ${entry.throughputs.map((value) => value.toFixed(2)).join(", ")}]  ` +
      `acceptance ${entry.accepted}/${entry.total} (${fixed((entry.accepted / entry.total) * 100, 1)}%)  ` +
      `median trial wall ${fixed(entry.medianWallMs / 1000, 1)}s`,
  );
  if (workerCount !== workerCounts[0]) {
    console.log(
      `  S(${workerCount}) = ${fixed(speedup)}   E(${workerCount}) = ${fixed(ratio(speedup, workerCount))}`,
    );
  }
}

console.log("\n## Paired per-repetition differences (N=2 vs N=1)\n");
console.log("rep  T(1)    T(2)    S(2)   wall-1-s  wall-2-s  accepted-1  accepted-2");
const repetitions = [...new Set(rows.map((row) => row.repetition))].sort();
for (const repetition of repetitions) {
  const one = rows.find((row) => row.workerCount === 1 && row.repetition === repetition);
  const two = rows.find((row) => row.workerCount === 2 && row.repetition === repetition);
  if (one === undefined || two === undefined) continue;
  console.log(
    [
      String(repetition).padStart(3),
      fixed(one.acceptedPerHour).padStart(8),
      fixed(two.acceptedPerHour).padStart(8),
      fixed(ratio(two.acceptedPerHour, one.acceptedPerHour)).padStart(7),
      fixed(one.wallMs / 1000, 1).padStart(10),
      fixed(two.wallMs / 1000, 1).padStart(10),
      `${one.accepted}/${one.runs.length}`.padStart(12),
      `${two.accepted}/${two.runs.length}`.padStart(12),
    ].join(""),
  );
}

console.log("\n## Wall-clock speedup (concurrency-attributable component)\n");
// Accepted-throughput speedup mixes two effects: how fast a trial finished, and how many
// of its tasks were accepted. Trial wall clock isolates the first, which is the part
// concurrency can actually influence.
const wallSpeedups = [];
for (const repetition of repetitions) {
  const one = rows.find((row) => row.workerCount === 1 && row.repetition === repetition);
  const two = rows.find((row) => row.workerCount === 2 && row.repetition === repetition);
  if (one === undefined || two === undefined) continue;
  const speedup = ratio(one.wallMs, two.wallMs);
  wallSpeedups.push(speedup);
  console.log(
    `rep ${repetition}: wall ${fixed(one.wallMs / 1000, 1)}s -> ${fixed(two.wallMs / 1000, 1)}s   wall-speedup ${fixed(speedup)}   wall-efficiency ${fixed(ratio(speedup, 2))}`,
  );
}
const medianWallSpeedup = median(wallSpeedups);
console.log(
  `median wall-clock speedup ${fixed(medianWallSpeedup)}  (efficiency ${fixed(ratio(medianWallSpeedup, 2))})`,
);

console.log("\n## Agent behaviour accounting\n");
console.log("runs with zero file edits (agent produced no change):");
const noEdit = runs.filter((run) => (run.filesChanged ?? []).length === 0);
for (const run of noEdit) {
  console.log(
    `  ${run.trialId}  ${run.taskId}  state=${run.runState} exit=${run.processExitCode} timedOut=${run.timedOut}`,
  );
}
console.log(`  total ${noEdit.length}/${runs.length}`);
const outOfScope = runs.filter((run) =>
  run.failureClassification?.startsWith("editable_scope_violation"),
);
console.log(`runs rejected for editable-scope violation: ${outOfScope.length}`);
console.log(`runs that timed out: ${runs.filter((run) => run.timedOut).length}`);
console.log(
  `runs with validator infrastructure failure: ${runs.filter((run) => run.failureClassification === "validator_infrastructure_failure").length}`,
);

console.log("\n## Task-class observations\n");
console.log(
  "task                        class          N=1 accepted  N=2 accepted  median-latency-s",
);
const taskIds = [...new Set(runs.map((run) => run.taskId))].sort();
for (const taskId of taskIds) {
  const taskRuns = runs.filter((run) => run.taskId === taskId);
  const acceptedAt = (workerCount) => {
    const subset = taskRuns.filter((run) => run.workerCount === workerCount);
    return `${subset.filter((run) => run.runState === "accepted").length}/${subset.length}`;
  };
  console.log(
    [
      taskId.padEnd(28),
      (taskRuns[0].benchmarkTaskClass ?? "n/a").padEnd(15),
      acceptedAt(1).padStart(12),
      acceptedAt(2).padStart(14),
      fixed(median(taskRuns.map((run) => run.durationMs)) / 1000, 1).padStart(18),
    ].join(""),
  );
}

console.log("\n## Economics\n");
for (const workerCount of workerCounts) {
  const entry = perWorker.get(workerCount);
  const workerRuns = runs.filter((run) => run.workerCount === workerCount);
  const usages = workerRuns.map((run) => run.usage).filter((usage) => usage != null);
  const withUsage = usages.length;
  const field = (name) =>
    withUsage === 0 || usages.some((usage) => usage[name] == null)
      ? null
      : sum(usages.map((usage) => usage[name]));
  const providerCosts = usages
    .map((usage) => usage.providerReportedCost)
    .filter((value) => value != null);
  const providerCostTotal =
    providerCosts.length === usages.length && usages.length > 0 ? sum(providerCosts) : null;
  const agentHours = entry.agentMs / 3_600_000;
  const machineHours = (entry.machineMs * workerCount) / 3_600_000;
  console.log(`N=${workerCount}`);
  console.log(`  accepted tasks:                 ${entry.accepted}`);
  console.log(`  agent-hours (sum agent exec):   ${fixed(agentHours, 4)}`);
  console.log(`  machine-hours (wall x workers): ${fixed(machineHours, 4)}`);
  console.log(`  accepted per agent-hour:        ${fixed(ratio(entry.accepted, agentHours))}`);
  console.log(`  accepted per machine-hour:      ${fixed(ratio(entry.accepted, machineHours))}`);
  console.log(`  runs with structured usage:     ${withUsage}/${workerRuns.length}`);
  console.log(`  input tokens:                   ${field("inputTokens") ?? "null"}`);
  console.log(`  output tokens:                  ${field("outputTokens") ?? "null"}`);
  console.log(`  cached input tokens:            ${field("cachedInputTokens") ?? "null"}`);
  console.log(`  reasoning tokens:               ${field("reasoningTokens") ?? "null"}`);
  console.log(
    `  provider-reported cost:         ${providerCostTotal === null ? "null" : providerCostTotal}`,
  );
  console.log(
    `  cost per accepted task:         ${providerCostTotal === null ? "null (provider reported no cost)" : providerCostTotal === 0 ? "0 (free-tier model; not a priced measurement)" : fixed(ratio(providerCostTotal, entry.accepted), 6)}`,
  );
  console.log(
    `  accepted per provider dollar:   ${providerCostTotal === null || providerCostTotal === 0 ? "null (undefined at zero provider cost)" : fixed(ratio(entry.accepted, providerCostTotal))}`,
  );
  console.log(`  derived monetary cost:          null (no pricing context supplied)`);
  console.log(`  median task latency:            ${fixed(entry.medianTaskLatencyMs / 1000, 1)}s`);
}

console.log("\n## Phase timing (median per run, seconds)\n");
console.log("workers  agent-exec  validation  worktree-setup  worktree-cleanup  orchestration");
for (const workerCount of workerCounts) {
  const workerRuns = runs.filter((run) => run.workerCount === workerCount);
  const phase = (name) => median(workerRuns.map((run) => run.phaseTimings?.[name] ?? 0)) / 1000;
  console.log(
    [
      String(workerCount).padStart(7),
      fixed(phase("agentExecutionMs"), 1).padStart(12),
      fixed(phase("validationMs"), 2).padStart(12),
      fixed(phase("worktreeSetupMs"), 3).padStart(16),
      fixed(phase("worktreeCleanupMs"), 3).padStart(18),
      fixed(phase("otherOrchestrationMs"), 3).padStart(15),
    ].join(""),
  );
}

console.log(`\nexperimentId: ${trials.experimentId ?? "n/a"}`);
console.log(`artifacts: ${directory}`);
