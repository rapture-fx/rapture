import { resolve } from "node:path";
import { ensureCleanReset } from "./git.js";
import type { ExperimentManifest } from "./manifest.js";
import { expandManifest } from "./manifest.js";
import { profileOpenCode } from "./profiler.js";
import type { RunTrace } from "./schema.js";

export interface ExperimentResult {
  readonly manifestPath: string;
  readonly runTraces: readonly RunTrace[];
  readonly perTask: readonly {
    taskId: string;
    repetition: number;
    runId: string;
    durationMs: number | null;
    status: string;
  }[];
}

export async function runExperiment(
  manifest: ExperimentManifest,
  manifestPath: string,
  opts: { persistTaskText: boolean; extraArgs?: readonly string[] },
): Promise<ExperimentResult> {
  const repoRoot = resolve(manifest.repository);
  const expanded = expandManifest(manifest);
  const runTraces: RunTrace[] = [];
  const perTask: {
    taskId: string;
    repetition: number;
    runId: string;
    durationMs: number | null;
    status: string;
  }[] = [];

  for (const task of expanded) {
    if (manifest.mode === "clean-reset") {
      await ensureCleanReset(repoRoot);
    }
    // verify evolving mode does not reset
    const trace = await profileOpenCode({
      repoRoot,
      task: task.task,
      taskFile: task.taskFile,
      persistTaskText: opts.persistTaskText,
      extraOpenCodeArgs: opts.extraArgs ?? [],
      model: task.model ?? null,
      agent: task.agent ?? null,
      ...(manifest.runsDir ? { runsDir: manifest.runsDir } : {}),
      ...(manifest.cohort ? { cohort: manifest.cohort } : {}),
      ...(task.manifestTaskId ? { taskId: task.manifestTaskId } : {}),
      ...(manifest.experimentId ? { experimentId: manifest.experimentId } : {}),
    });
    runTraces.push(trace);
    perTask.push({
      taskId: task.manifestTaskId,
      repetition: task.repetition,
      runId: trace.metadata.runId,
      durationMs: trace.metadata.durationMs,
      status: trace.metadata.status,
    });
  }

  return { manifestPath, runTraces, perTask };
}
