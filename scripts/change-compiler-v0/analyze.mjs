#!/usr/bin/env node
/**
 * Paired analysis of the baseline-vs-change-contract experiment.
 *
 * Reads only persisted run artifacts. Every task appears in both conditions at every
 * repetition, so comparisons are made within a task first and only then aggregated: a
 * median of per-task effects cannot be carried by one pathological task the way a pooled
 * median can. Missing values stay null and are excluded rather than imputed.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const experimentRoot = resolve(process.argv[2] ?? "experiments/change-compiler-v0");

const EXPLORATION_METRICS = [
  "toolCallsBeforeFirstEdit",
  "uniqueFilesRead",
  "searchOperations",
  "msToFirstEdit",
  "totalToolCalls",
  "commandsExecuted",
];

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
          const directory = join(runsRoot, entry.name);
          const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
          const stdout = await readFile(join(directory, "agent.stdout.log"), "utf8").catch(
            () => "",
          );
          const [task, condition] = result.taskId.split("__");
          runs.push({ ...result, task, condition, stdout });
        }
      }
    }
  }
  return runs;
}

const median = (values) => {
  const sorted = values
    .filter((value) => value !== null && value !== undefined)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const num = (value, digits = 1) => (value === null ? "n/a" : value.toFixed(digits));

/** Did the agent actually open the injected contract? */
function readContract(stdout) {
  return /\.rapture\/change-contract\.json/u.test(stdout);
}

const runs = await loadRuns(experimentRoot);
const tasks = [...new Set(runs.map((run) => run.task))].sort();
const pick = (task, condition) =>
  runs.filter((run) => run.task === task && run.condition === condition);
const acceptedOf = (subset) => subset.filter((run) => run.runState === "accepted").length;

console.log("## Run completion accounting\n");
console.log(`total logical runs: ${runs.length}`);
const states = {};
for (const run of runs) states[run.runState] = (states[run.runState] ?? 0) + 1;
for (const [state, count] of Object.entries(states).sort()) console.log(`  ${state}: ${count}`);
const classifications = {};
for (const run of runs.filter((item) => item.failureClassification !== null)) {
  classifications[run.failureClassification] =
    (classifications[run.failureClassification] ?? 0) + 1;
}
for (const [name, count] of Object.entries(classifications).sort())
  console.log(`  classification ${name}: ${count}`);
const infrastructure = runs.filter((run) => run.runState === "infrastructure_failed").length;
console.log(`infrastructure/provider failures: ${infrastructure}`);
console.log(
  `runs missing exploration metrics: ${runs.filter((run) => run.agentExploration === null).length}`,
);

console.log("\n## Acceptance by condition\n");
for (const condition of ["baseline", "contract"]) {
  const subset = runs.filter((run) => run.condition === condition);
  console.log(
    `${condition.padEnd(10)} ${acceptedOf(subset)}/${subset.length} = ${pct(acceptedOf(subset) / subset.length)}`,
  );
}
const baseAll = runs.filter((run) => run.condition === "baseline");
const contractAll = runs.filter((run) => run.condition === "contract");
const acceptanceDelta =
  acceptedOf(contractAll) / contractAll.length - acceptedOf(baseAll) / baseAll.length;
console.log(
  `delta: ${(acceptanceDelta * 100).toFixed(1)} percentage points (guardrail: not below -5.0pp)`,
);

console.log("\n## Paired per-task acceptance\n");
console.log("task                          baseline  contract  delta   contract-read");
for (const task of tasks) {
  const base = pick(task, "baseline");
  const contract = pick(task, "contract");
  const read = contract.filter((run) => readContract(run.stdout)).length;
  console.log(
    [
      task.padEnd(30),
      `${acceptedOf(base)}/${base.length}`.padStart(8),
      `${acceptedOf(contract)}/${contract.length}`.padStart(10),
      `${(((acceptedOf(contract) - acceptedOf(base)) / Math.max(base.length, 1)) * 100).toFixed(0)}pp`.padStart(
        7,
      ),
      `${read}/${contract.length}`.padStart(15),
    ].join(""),
  );
}

console.log("\n## Contract uptake\n");
const contractRuns = runs.filter((run) => run.condition === "contract");
const readCount = contractRuns.filter((run) => readContract(run.stdout)).length;
console.log(`contract opened in ${readCount}/${contractRuns.length} contract-condition runs`);
console.log(
  `contract referenced in ${runs.filter((run) => run.condition === "baseline" && readContract(run.stdout)).length}/${baseAll.length} baseline runs (expected 0)`,
);

console.log("\n## Paired exploration metrics (per-task medians)\n");
const results = {};
for (const metric of EXPLORATION_METRICS) {
  console.log(`### ${metric}`);
  console.log("task                          baseline   contract   change     reps-improved");
  const ratios = [];
  let tasksWithMajorityDirection = 0;
  for (const task of tasks) {
    const base = median(
      pick(task, "baseline").map((run) => run.agentExploration?.[metric] ?? null),
    );
    const contract = median(
      pick(task, "contract").map((run) => run.agentExploration?.[metric] ?? null),
    );
    let improvedReps = 0;
    for (const repetition of [1, 2, 3]) {
      const b = pick(task, "baseline").find((run) => run.repetition === repetition)
        ?.agentExploration?.[metric];
      const c = pick(task, "contract").find((run) => run.repetition === repetition)
        ?.agentExploration?.[metric];
      if (typeof b === "number" && typeof c === "number" && c < b) improvedReps += 1;
    }
    if (improvedReps >= 2) tasksWithMajorityDirection += 1;
    const ratio =
      base === null || contract === null || base === 0 ? null : (contract - base) / base;
    if (ratio !== null) ratios.push(ratio);
    console.log(
      [
        task.padEnd(30),
        num(base).padStart(8),
        num(contract).padStart(11),
        (ratio === null ? "n/a" : `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(0)}%`).padStart(
          9,
        ),
        `${improvedReps}/3`.padStart(16),
      ].join(""),
    );
  }
  const medianRatio = median(ratios);
  results[metric] = { medianRatio, tasksWithMajorityDirection, taskCount: tasks.length };
  console.log(
    `  median per-task change: ${medianRatio === null ? "n/a" : `${medianRatio >= 0 ? "+" : ""}${(medianRatio * 100).toFixed(1)}%`}` +
      `   tasks improving in >=2/3 reps: ${tasksWithMajorityDirection}/${tasks.length}\n`,
  );
}

console.log("## Scope violations and failure modes\n");
for (const condition of ["baseline", "contract"]) {
  const subset = runs.filter((run) => run.condition === condition);
  console.log(
    `${condition.padEnd(10)} scope-violations=${subset.filter((r) => (r.failureClassification ?? "").startsWith("editable_scope_violation")).length}` +
      ` timeouts=${subset.filter((r) => r.timedOut).length}` +
      ` no-edit=${subset.filter((r) => (r.filesChanged ?? []).length === 0).length}` +
      ` invalid-tool-calls=${subset.reduce((t, r) => t + (r.agentExploration?.invalidToolCalls ?? 0), 0)}`,
  );
}

console.log("\n## Timing and tokens by condition\n");
console.log(
  "condition   median-agent-s  median-wall-s  input-tokens  output-tokens  provider-cost",
);
for (const condition of ["baseline", "contract"]) {
  const subset = runs.filter((run) => run.condition === condition);
  const usages = subset.map((run) => run.usage).filter((usage) => usage != null);
  const sum = (key) => usages.reduce((total, usage) => total + (usage[key] ?? 0), 0);
  const costs = usages.map((usage) => usage.providerReportedCost).filter((value) => value != null);
  console.log(
    [
      condition.padEnd(12),
      num(
        (median(subset.map((r) => r.phaseTimings?.agentExecutionMs ?? null)) ?? 0) / 1000,
      ).padStart(14),
      num((median(subset.map((r) => r.durationMs ?? null)) ?? 0) / 1000).padStart(15),
      String(sum("inputTokens")).padStart(14),
      String(sum("outputTokens")).padStart(15),
      (costs.length === usages.length && usages.length > 0
        ? String(costs.reduce((a, b) => a + b, 0))
        : "null"
      ).padStart(15),
    ].join(""),
  );
}
console.log("\nDerived monetary cost: null (no pricing context supplied).");

console.log("\n## Pre-registered criterion evaluation\n");
const improved = EXPLORATION_METRICS.filter((metric) => (results[metric].medianRatio ?? 0) <= -0.2);
const majority = EXPLORATION_METRICS.filter(
  (metric) => results[metric].tasksWithMajorityDirection > tasks.length / 2,
);
console.log(
  `1. acceptance not more than 5pp below baseline: ${acceptanceDelta >= -0.05 ? "PASS" : "FAIL"} (${(acceptanceDelta * 100).toFixed(1)}pp)`,
);
console.log(
  `2. >=2 exploration metrics improved >=20% (median per-task): ${improved.length >= 2 ? "PASS" : "FAIL"} (${improved.length}: ${improved.join(", ") || "none"})`,
);
console.log(
  `3. direction consistent >=2/3 reps for a majority of tasks: ${majority.length >= 2 ? "PASS" : "FAIL"} (metrics meeting it: ${majority.join(", ") || "none"})`,
);
console.log(`4. not explained by one task: inspect per-task tables above`);
console.log(
  `5. no material rise in scope violations or infra failures: ${infrastructure === 0 ? "PASS (0 infra failures)" : "REVIEW"}`,
);
