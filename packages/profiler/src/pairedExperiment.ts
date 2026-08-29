import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateWorkingSetArtifact, writeArtifact, isArtifactCompatible } from "./artifact.js";
import { getRepoState } from "./git.js";
import { profileOpenCode } from "./profiler.js";
import { listRuns, loadRunTrace } from "./storage.js";
import type { RunTrace } from "./schema.js";

export interface PairedTask {
  readonly id: string;
  readonly task: string;
  readonly evaluator: string;
}

export interface PairedExperimentConfig {
  readonly repository: string;
  readonly baseTree: string;
  readonly tasks: readonly PairedTask[];
  readonly repsPerCondition: number;
  readonly model: string;
  readonly seed: number;
  readonly experimentId: string;
}

// seeded PRNG (mulberry32)
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(array: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    arr[i] = arr[j]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    arr[j] = tmp!;
  }
  return arr;
}

export interface RunOrderEntry {
  readonly taskId: string;
  readonly condition: "CONTROL_NORMAL" | "TREATMENT_WORKING_SET";
  readonly repetition: number;
  readonly artifactPath: string | null;
}

export async function generateArtifactFromPrior(
  repoRoot: string,
  domain: string,
  treeHash: string,
): Promise<{ artifactPath: string; jsonPath: string; mdPath: string }> {
  const runs = await listRuns(repoRoot);
  // use Phase 0B related traces as source: those with cohort B_related_same_state and tree matching
  const relevant = runs.filter((r) => r.cohort === "B_related_same_state" && r.repoBefore.tree === treeHash);
  if (relevant.length === 0) throw new Error("no prior traces for artifact generation");
  const traces: RunTrace[] = [];
  for (const r of relevant) {
    const t = await loadRunTrace(repoRoot, r.runId);
    if (t) traces.push(t);
  }
  if (traces.length === 0) throw new Error("no traces loaded");
  const artifact = generateWorkingSetArtifact(traces, domain, treeHash);
  if (!isArtifactCompatible(artifact, treeHash)) throw new Error("artifact incompatible");
  const dir = join(repoRoot, "experiments/phase0c/artifacts");
  const { jsonPath, mdPath } = await writeArtifact(dir, `working-set-${domain}`, artifact);
  return { artifactPath: mdPath, jsonPath, mdPath };
}

export function buildPrompt(task: string, artifactPath: string | null, condition: "CONTROL_NORMAL" | "TREATMENT_WORKING_SET"): string {
  if (condition === "CONTROL_NORMAL") return task;
  if (!artifactPath) return task;
  return `${task}

A deterministic repository working-set artifact is available at ${artifactPath}.
It was generated from prior runs against the identical repository tree.
Use it as repository navigation information if useful.
Verify any fact you consider important before relying on it.
Complete the task normally.`;
}

export async function runPairedExperiment(
  config: PairedExperimentConfig,
  artifactPath: string,
): Promise<{
  order: readonly RunOrderEntry[];
  results: readonly { entry: RunOrderEntry; trace: RunTrace }[];
}> {
  const repoRoot = resolve(config.repository);
  const treeState = await getRepoState(repoRoot);
  if (treeState.tree !== config.baseTree) {
    throw new Error(`base tree mismatch: current ${treeState.tree} vs ${config.baseTree}`);
  }

  // Build all entries
  const entries: RunOrderEntry[] = [];
  for (const task of config.tasks) {
    for (let rep = 1; rep <= config.repsPerCondition; rep++) {
      entries.push({ taskId: task.id, condition: "CONTROL_NORMAL", repetition: rep, artifactPath: null });
      entries.push({ taskId: task.id, condition: "TREATMENT_WORKING_SET", repetition: rep, artifactPath });
    }
  }

  const order = seededShuffle(entries, config.seed);

  // Persist order
  await mkdir(join(repoRoot, "experiments/phase0c"), { recursive: true });
  await writeFile(join(repoRoot, "experiments/phase0c/run-order.json"), JSON.stringify({ seed: config.seed, order }, null, 2));

  const results: { entry: RunOrderEntry; trace: RunTrace }[] = [];

  for (const entry of order) {
    const taskDef = config.tasks.find((t) => t.id === entry.taskId);
    if (!taskDef) continue;
    const prompt = buildPrompt(taskDef.task, entry.artifactPath, entry.condition);
    // Use clean-reset for each run (experiment requires identical base tree)
    // Ensure clean state
    const { ensureCleanReset } = await import("./git.js");
    await ensureCleanReset(repoRoot);
    // Verify tree still matches
    const cur = await getRepoState(repoRoot);
    if (cur.tree !== config.baseTree) throw new Error(`tree drift during experiment: ${cur.tree} vs ${config.baseTree}`);

    const trace = await profileOpenCode({
      repoRoot,
      task: prompt,
      taskFile: null,
      persistTaskText: true,
      extraOpenCodeArgs: [],
      model: config.model,
      agent: null,
      cohort: entry.condition === "CONTROL_NORMAL" ? `control-${entry.taskId}` : `treatment-${entry.taskId}`,
      taskId: entry.taskId,
      experimentId: config.experimentId,
    });
    // Tag cohort with condition for paired analysis: we will group by taskId + condition
    // Already stored via cohort field
    results.push({ entry, trace });
  }

  return { order, results };
}
