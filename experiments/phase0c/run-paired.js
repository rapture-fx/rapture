import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { getRepoState } from "../../packages/profiler/dist/git.js";
import { generateWorkingSetArtifact, writeArtifact } from "../../packages/profiler/dist/artifact.js";
import { listRuns, loadRunTrace } from "../../packages/profiler/dist/storage.js";
import { runPairedExperiment } from "../../packages/profiler/dist/pairedExperiment.js";
import { pairedDeltas, aggregatePaired } from "../../packages/profiler/dist/pairedAnalysis.js";

async function main() {
  const repo = "/Users/wira/Documents/rapture/rapture";
  const tasksRaw = await readFile(resolve(repo, "experiments/phase0c/tasks.json"), "utf8");
  const tasksConfig = JSON.parse(tasksRaw);
  const baseTree = tasksConfig.baseTree;
  const model = tasksConfig.model;
  const seed = tasksConfig.seed;
  const experimentId = tasksConfig.experimentId;

  const state = await getRepoState(repo);
  if (state.tree !== baseTree) throw new Error(`base tree mismatch ${state.tree} vs ${baseTree}`);

  const runs = await listRuns(repo);
  const relevant = runs.filter((r) => r.cohort === "B_related_same_state");
  const traces = [];
  for (const r of relevant) {
    const t = await loadRunTrace(repo, r.runId);
    if (t) traces.push(t);
  }
  console.log(`Generating artifact from ${traces.length} prior traces (baseTree ${baseTree})`);
  const artifact = generateWorkingSetArtifact(traces, "profiler", baseTree);
  const { jsonPath, mdPath } = await writeArtifact("experiments/phase0c/artifacts", "working-set-profiler", artifact);
  console.log(`Artifact: ${jsonPath} (${artifact.artifactSizeBytes} bytes, ~${artifact.approxTokens} tokens)`);
  console.log(`MD: ${mdPath}`);

  const config = {
    repository: repo,
    baseTree,
    tasks: tasksConfig.tasks.map((t) => ({ id: t.id, task: t.task, evaluator: t.evaluator })),
    repsPerCondition: 3,
    model,
    seed,
    experimentId,
  };

  const { order, results } = await runPairedExperiment(config, mdPath);
  console.log(`Completed ${results.length} runs`);

  const byTaskRep = new Map();
  for (const r of results) {
    const key = `${r.entry.taskId}-${r.entry.repetition}`;
    let pair = byTaskRep.get(key);
    if (!pair) {
      pair = { control: null, treatment: null };
      byTaskRep.set(key, pair);
    }
    if (r.entry.condition === "CONTROL_NORMAL") pair.control = r.trace;
    else pair.treatment = r.trace;
  }
  const pairs = [...byTaskRep.entries()].map(([k, v]) => {
    const [taskId, repStr] = k.split("-");
    return { taskId, repetition: Number(repStr), control: v.control, treatment: v.treatment };
  });
  const deltas = pairedDeltas(pairs);
  const agg = aggregatePaired(deltas);
  console.log("Aggregate", agg);
  console.log("Deltas", deltas);

  await writeFile("experiments/phase0c/results.json", JSON.stringify({ order, deltas, aggregate: agg, artifact: { jsonPath, mdPath, size: artifact.artifactSizeBytes, tokens: artifact.approxTokens } }, null, 2));
  console.log("written results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
