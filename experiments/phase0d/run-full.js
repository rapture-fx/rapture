import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runTrajectoryExperiment } from "../../packages/profiler/dist/trajectoryExperiment.js";
import { getRepoState } from "../../packages/profiler/dist/git.js";
import { aggregateEconomics } from "../../packages/profiler/dist/economics.js";

async function main() {
  const repo = "/Users/wira/Documents/rapture/rapture";
  const raw = await readFile(resolve(repo, "experiments/phase0d/tasks.json"), "utf8");
  const cfg = JSON.parse(raw);
  const state = await getRepoState(repo);
  console.log("current tree", state.tree);
  const fullConfig = {
    repository: cfg.repository,
    baseTree: state.tree,
    experimentId: "phase0d-full-2026-08-29",
    seed: cfg.seed,
    tasks: cfg.tasks,
    models: cfg.models, // 3 models
    repsPerModel: 2, // 6 tasks *3 models*2 =36
  };
  console.log("Running full", fullConfig.tasks.length, "tasks", fullConfig.models.length, "models", fullConfig.repsPerModel, "reps");
  const { order, results } = await runTrajectoryExperiment(fullConfig);
  console.log("Completed", results.length);
  const perRun = results.map(r => r.economics);
  const agg = aggregateEconomics(perRun);
  console.log("Aggregate mean", agg.meanPct);
  console.log("Median", agg.medianPct);
  console.log("ByOutcome", agg.byOutcome);
  console.log("ByModel", agg.byModel);
  console.log("Dominant", agg.dominantCategory);
  console.log("Correlation", agg.correlation);
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(join(repo, "experiments/phase0d"), { recursive: true });
  await writeFile(join(repo, "experiments/phase0d/full-results.json"), JSON.stringify({ order, results: results.map(r => ({ taskId: r.taskId, model: r.model, runId: r.runId, success: r.evaluatorSuccess, economics: r.economics, duration: r.trace.metadata.durationMs, tokens: r.trace.metadata.tokenUsage, retry: r.economics.retryCount })), aggregate: agg }, null, 2));
  console.log("written full-results.json");
}

main().catch(e => { console.error(e); process.exit(1); });
