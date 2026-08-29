import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRepoState } from "../../packages/profiler/src/git.js";
import { generateWorkingSetArtifact, writeArtifact } from "../../packages/profiler/src/artifact.js";
import { listRuns, loadRunTrace } from "../../packages/profiler/src/storage.js";
import { runPairedExperiment } from "../../packages/profiler/src/pairedExperiment.js";

async function main() {
  const repo = "/Users/wira/Documents/rapture/rapture";
  const tasksRaw = await readFile(resolve(repo, "experiments/phase0c/tasks.json"), "utf8");
  const tasksConfig = JSON.parse(tasksRaw);
  const baseTree = tasksConfig.baseTree;
  const model = tasksConfig.model;
  const seed = tasksConfig.seed;
  const experimentId = tasksConfig.experimentId;

  // Verify tree
  const state = await getRepoState(repo);
  if (state.tree !== baseTree) throw new Error(`base tree mismatch ${state.tree} vs ${baseTree}`);

  // Generate artifact from Phase 0B B cohort
  const runs = await listRuns(repo);
  const relevant = runs.filter((r) => r.cohort === "B_related_same_state" && r.repoBefore.tree === baseTree);
  const traces = [];
  for (const r of relevant) {
    const t = await loadRunTrace(repo, r.runId);
    if (t) traces.push(t);
  }
  console.log(`Generating artifact from ${traces.length} prior traces`);
  const artifact = generateWorkingSetArtifact(traces, "profiler", baseTree);
  const { jsonPath, mdPath } = await writeArtifact("experiments/phase0c/artifacts", "working-set-profiler", artifact);
  console.log(`Artifact: ${jsonPath} (${artifact.artifactSizeBytes} bytes, ~${artifact.approxTokens} tokens)`);
  console.log(`MD: ${mdPath}`);

  const config = {
    repository: repo,
    baseTree,
    tasks: tasksConfig.tasks.map((t: any) => ({ id: t.id, task: t.task, evaluator: t.evaluator })),
    repsPerCondition: 3,
    model,
    seed,
    experimentId,
  };

  const { order, results } = await runPairedExperiment(config, mdPath);
  console.log(`Completed ${results.length} runs`);
  console.log(`Order seed ${seed}:`, order.map((o) => `${o.taskId}-${o.condition}-${o.repetition}`).join(", "));

  // Persist paired results summary
  const { pairedDeltas, aggregatePaired } = await import("../../packages/profiler/src/pairedAnalysis.js");
  // Build paired runs
  const byTaskRep = new Map<string, { control: any; treatment: any }>();
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
    return { taskId: taskId!, repetition: Number(repStr), control: v.control, treatment: v.treatment };
  });
  const deltas = pairedDeltas(pairs);
  const agg = aggregatePaired(deltas);
  console.log("Aggregate", agg);
  console.log("Deltas", deltas);

  const { writeFile } = await import("node:fs/promises");
  await writeFile("experiments/phase0c/results.json", JSON.stringify({ order, deltas, aggregate: agg, artifact: { jsonPath, mdPath, size: artifact.artifactSizeBytes, tokens: artifact.approxTokens } }, null, 2));
  console.log("written results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
