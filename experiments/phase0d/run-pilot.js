import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runTrajectoryExperiment } from "../../packages/profiler/dist/trajectoryExperiment.js";
import { getRepoState } from "../../packages/profiler/dist/git.js";

async function main() {
  const repo = "/Users/wira/Documents/rapture/rapture";
  const raw = await readFile(resolve(repo, "experiments/phase0d/tasks.json"), "utf8");
  const cfg = JSON.parse(raw);
  const state = await getRepoState(repo);
  console.log("current tree", state.tree, "baseTree", cfg.baseTree);
  // Pilot: 6 tasks * 2 models (mini, 5.4) *1 rep =12
  const pilotConfig = {
    repository: cfg.repository,
    baseTree: state.tree,
    experimentId: "phase0d-pilot-2026-08-29",
    seed: cfg.seed,
    tasks: cfg.tasks,
    models: ["openai/gpt-5.4-mini", "openai/gpt-5.4"],
    repsPerModel: 1,
  };
  console.log("Running pilot", pilotConfig.tasks.length, "tasks", pilotConfig.models.length, "models");
  const { order, results } = await runTrajectoryExperiment(pilotConfig);
  console.log("Pilot completed", results.length);
  for (const r of results) {
    console.log(`${r.taskId} ${r.model} ${r.evaluatorSuccess ? "SUCCESS" : "FAIL"} ops:${r.trace.operations.length} retries:${r.economics.retryCount} waste:${Object.entries(r.economics.categories).map(([k,v])=>`${k}:${v.pctOps.toFixed(1)}%`).join(" ")}`);
  }
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(join(repo, "experiments/phase0d"), { recursive: true });
  await writeFile(join(repo, "experiments/phase0d/pilot-results.json"), JSON.stringify({ order, results: results.map(r => ({ taskId: r.taskId, model: r.model, runId: r.runId, success: r.evaluatorSuccess, economics: r.economics, duration: r.trace.metadata.durationMs, tokens: r.trace.metadata.tokenUsage })) }, null, 2));
  console.log("written pilot-results.json");
}

main().catch(e => { console.error(e); process.exit(1); });
