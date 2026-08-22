#!/usr/bin/env node
/**
 * Derive the task-delegation-signal analysis from persisted run artifacts.
 *
 * Reads only what the experiment wrote, across all three per-repository experiment
 * directories, so every number can be reproduced from committed evidence. Features come
 * from each run record, not from re-joining to the manifest. Missing values stay null.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const experimentRoot = resolve(process.argv[2] ?? "experiments/task-delegation-signal-v0");

async function loadRuns(root) {
  const runs = [];
  for (const repository of await readdir(root, { withFileTypes: true })) {
    if (!repository.isDirectory()) continue;
    const repositoryRoot = join(root, repository.name);
    for (const experiment of await readdir(repositoryRoot, { withFileTypes: true })) {
      if (!experiment.isDirectory() || !experiment.name.startsWith("exp-")) continue;
      const trialsRoot = join(repositoryRoot, experiment.name, "trials");
      const trials = await readdir(trialsRoot, { withFileTypes: true }).catch(() => []);
      for (const trial of trials.filter((entry) => entry.isDirectory())) {
        const runsRoot = join(trialsRoot, trial.name, "runs");
        const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
        for (const entry of entries.filter((item) => item.isDirectory())) {
          runs.push(JSON.parse(await readFile(join(runsRoot, entry.name, "result.json"), "utf8")));
        }
      }
    }
  }
  return runs;
}

const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const rate = (subset) =>
  subset.length === 0
    ? null
    : subset.filter((run) => run.runState === "accepted").length / subset.length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const runs = await loadRuns(experimentRoot);
const accepted = runs.filter((run) => run.runState === "accepted");
const baseline = rate(runs);

console.log("## Run completion accounting\n");
const states = {};
for (const run of runs) states[run.runState] = (states[run.runState] ?? 0) + 1;
console.log(`total logical runs: ${runs.length}`);
for (const [state, count] of Object.entries(states).sort()) console.log(`  ${state}: ${count}`);
const classifications = {};
for (const run of runs.filter((item) => item.failureClassification !== null)) {
  classifications[run.failureClassification] =
    (classifications[run.failureClassification] ?? 0) + 1;
}
console.log("failure classifications:");
for (const [name, count] of Object.entries(classifications).sort())
  console.log(`  ${name}: ${count}`);
const infrastructure = runs.filter(
  (run) =>
    run.runState === "infrastructure_failed" ||
    run.failureClassification === "validator_infrastructure_failure",
);
console.log(`infrastructure/provider failures: ${infrastructure.length}`);
console.log(
  `runs with zero file edits: ${runs.filter((run) => (run.filesChanged ?? []).length === 0).length}`,
);

console.log(`\n## Overall acceptance baseline\n`);
console.log(`${accepted.length}/${runs.length} = ${pct(baseline)} (no task information)`);

/** Acceptance by one pre-registered feature, with per-repetition direction. */
function breakdown(title, pick) {
  console.log(`\n## Acceptance by ${title}\n`);
  const buckets = [...new Set(runs.map(pick))].sort();
  if (buckets.length <= 1) {
    console.log(
      `  only one value present (${buckets.join(", ")}) - this feature does not vary and cannot be evaluated`,
    );
    return [];
  }
  console.log(
    "bucket                     accepted  runs   rate     vs baseline   rep1   rep2   rep3",
  );
  const rows = [];
  for (const bucket of buckets) {
    const subset = runs.filter((run) => pick(run) === bucket);
    const bucketRate = rate(subset);
    const delta = bucketRate === null || baseline === null ? null : bucketRate - baseline;
    const perRep = [1, 2, 3].map((repetition) =>
      rate(subset.filter((run) => run.repetition === repetition)),
    );
    rows.push({ bucket, subset, rate: bucketRate, delta, perRep });
    console.log(
      [
        String(bucket).padEnd(26),
        `${subset.filter((r) => r.runState === "accepted").length}`.padStart(8),
        `${subset.length}`.padStart(6),
        pct(bucketRate).padStart(7),
        (delta === null ? "n/a" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`).padStart(
          14,
        ),
        ...perRep.map((value) => pct(value).padStart(7)),
      ].join(""),
    );
  }
  return rows;
}

const classRows = breakdown("task class", (run) => run.benchmarkTaskClass ?? "n/a");
const repoRows = breakdown("repository", (run) => run.repositoryId ?? "n/a");
const featureRows = {};
for (const feature of [
  "acceptanceCriteriaType",
  "expectedChangeBreadth",
  "specificationClarity",
  "verificationCostClass",
  "reversibility",
]) {
  featureRows[feature] = breakdown(
    feature,
    (run) => run.benchmarkDelegationFeatures?.[feature] ?? "n/a",
  );
}
breakdown("editableFileCount", (run) =>
  String(run.benchmarkDelegationFeatures?.editableFileCount ?? "n/a"),
);

console.log("\n## Outcome by individual task\n");
console.log(
  "task                          repository          class           accepted  rate     median-agent-s",
);
const taskIds = [...new Set(runs.map((run) => run.taskId))].sort();
const taskRows = [];
for (const taskId of taskIds) {
  const subset = runs.filter((run) => run.taskId === taskId);
  const taskRate = rate(subset);
  taskRows.push({ taskId, subset, rate: taskRate });
  console.log(
    [
      taskId.padEnd(30),
      (subset[0].repositoryId ?? "").padEnd(20),
      (subset[0].benchmarkTaskClass ?? "").padEnd(16),
      `${subset.filter((r) => r.runState === "accepted").length}/${subset.length}`.padStart(8),
      pct(taskRate).padStart(8),
      ((median(subset.map((run) => run.phaseTimings?.agentExecutionMs ?? 0)) ?? 0) / 1000)
        .toFixed(1)
        .padStart(16),
    ].join(""),
  );
}

console.log("\n## Within-class versus between-class variation\n");
console.log("class            tasks  per-task rates        spread  class rate");
for (const row of classRows) {
  const perTask = taskRows.filter((task) => task.subset[0].benchmarkTaskClass === row.bucket);
  const rates = perTask.map((task) => task.rate ?? 0);
  const spread = rates.length === 0 ? 0 : Math.max(...rates) - Math.min(...rates);
  console.log(
    [
      String(row.bucket).padEnd(17),
      String(perTask.length).padStart(5),
      `  ${perTask.map((task) => pct(task.rate)).join(" ")}`.padEnd(24),
      `${(spread * 100).toFixed(0)}pp`.padStart(7),
      pct(row.rate).padStart(11),
    ].join(""),
  );
}
console.log(
  "\nA class whose within-class spread rivals its distance from the corpus baseline is carrying\ntask-specific noise, not a class effect.",
);

console.log("\n## Failure modes by task class\n");
console.log("class             rejected  timed_out  infra  no-edit");
for (const row of classRows) {
  const subset = row.subset;
  console.log(
    [
      String(row.bucket).padEnd(18),
      String(subset.filter((r) => r.runState === "rejected").length).padStart(8),
      String(subset.filter((r) => r.runState === "timed_out" || r.timedOut).length).padStart(11),
      String(subset.filter((r) => r.runState === "infrastructure_failed").length).padStart(7),
      String(subset.filter((r) => (r.filesChanged ?? []).length === 0).length).padStart(8),
    ].join(""),
  );
}

console.log("\n## Execution time and economics by task class\n");
console.log(
  "class             median-agent-s  accepted  agent-hours  accepted/agent-hr  provider-cost  cost/accepted",
);
for (const row of classRows) {
  const subset = row.subset;
  const agentMs = subset.reduce(
    (total, run) => total + (run.phaseTimings?.agentExecutionMs ?? 0),
    0,
  );
  const agentHours = agentMs / 3_600_000;
  const acceptedCount = subset.filter((r) => r.runState === "accepted").length;
  const usages = subset.map((run) => run.usage).filter((usage) => usage != null);
  const costs = usages.map((usage) => usage.providerReportedCost).filter((value) => value != null);
  const providerCost =
    costs.length === usages.length && usages.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
  console.log(
    [
      String(row.bucket).padEnd(18),
      ((median(subset.map((run) => run.phaseTimings?.agentExecutionMs ?? 0)) ?? 0) / 1000)
        .toFixed(1)
        .padStart(14),
      String(acceptedCount).padStart(10),
      agentHours.toFixed(4).padStart(13),
      (acceptedCount === 0 || agentHours === 0
        ? "n/a"
        : (acceptedCount / agentHours).toFixed(2)
      ).padStart(19),
      (providerCost === null ? "null" : String(providerCost)).padStart(15),
      (providerCost === null
        ? "null"
        : providerCost === 0
          ? "0 (free tier)"
          : (providerCost / acceptedCount).toFixed(6)
      ).padStart(15),
    ].join(""),
  );
}
console.log("\nDerived monetary cost: null for every class (no pricing context supplied).");

console.log("\n## Signal criterion evaluation\n");
const candidates = [];
for (const [name, rows] of [
  ["taskClass", classRows],
  ["repositoryId", repoRows],
  ...Object.entries(featureRows),
]) {
  for (const row of rows) {
    if (row.delta === null || Math.abs(row.delta) < 0.2) continue;
    const direction = Math.sign(row.delta);
    const consistent = row.perRep.filter(
      (value) => value !== null && baseline !== null && Math.sign(value - baseline) === direction,
    ).length;
    const perTask = taskRows.filter((task) => row.subset.some((run) => run.taskId === task.taskId));
    const rates = perTask.map((task) => task.rate ?? 0);
    const spread = rates.length === 0 ? 0 : Math.max(...rates) - Math.min(...rates);
    candidates.push({
      feature: name,
      bucket: row.bucket,
      delta: row.delta,
      consistent,
      spread,
      taskCount: perTask.length,
    });
  }
}
if (candidates.length === 0) {
  console.log("no bucket differs from the corpus baseline by >= 20 percentage points");
} else {
  console.log(
    "feature              bucket                  delta     reps-consistent  within-bucket spread  tasks",
  );
  for (const candidate of candidates) {
    console.log(
      [
        candidate.feature.padEnd(21),
        String(candidate.bucket).padEnd(24),
        `${candidate.delta >= 0 ? "+" : ""}${(candidate.delta * 100).toFixed(1)}pp`.padStart(8),
        `${candidate.consistent}/3`.padStart(17),
        `${(candidate.spread * 100).toFixed(0)}pp`.padStart(22),
        String(candidate.taskCount).padStart(7),
      ].join(""),
    );
  }
}
const qualifying = candidates.filter((candidate) => candidate.consistent >= 2);
console.log(
  `\nbuckets >= 20pp from baseline: ${candidates.length}; of those, direction consistent in >= 2 of 3 repetitions: ${qualifying.length}`,
);
console.log(
  `criterion requires at least two qualifying buckets, not explained by infrastructure failure (${infrastructure.length} such runs), and not dominated by a single task instance (see within-bucket spread).`,
);
