import type { EventWriter } from "./events.js";
import { runGit } from "./git.js";
import { timePhase } from "./timing.js";
import { validateCommands } from "./validation.js";
import type { WorktreeManager } from "./worktree.js";

export interface IntegrationOutcome {
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly status: "passed" | "failed" | "conflict";
  readonly patchesAttempted: number;
  readonly patchesApplied: number;
  readonly validationCommands: number;
  readonly durationMs: number;
}

export async function integratePatches(input: {
  readonly worktrees: WorktreeManager;
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly baseCommit: string;
  readonly patches: readonly string[];
  readonly validation: readonly string[];
  readonly events: EventWriter;
}): Promise<IntegrationOutcome> {
  const runId = `integration-${input.trialId}`;
  await input.events.emit("integration_started", {
    trialId: input.trialId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    patchCount: input.patches.length,
  });
  const timed = await timePhase(async () => {
    const worktree = await input.worktrees.create(runId, input.baseCommit);
    let status: IntegrationOutcome["status"] = "passed";
    let patchesApplied = 0;
    try {
      for (const patch of input.patches) {
        const result = await runGit(worktree, ["apply", "--index", "--3way", patch], {
          allowFailure: true,
        });
        if (result.exitCode !== 0) {
          status = "conflict";
          break;
        }
        patchesApplied += 1;
      }
      if (status === "passed") {
        const validation = await validateCommands(input.validation, worktree, 900_000);
        if (!validation.passed) status = "failed";
      }
    } finally {
      await input.worktrees.remove(runId);
    }
    return { status, patchesApplied };
  });
  const outcome: IntegrationOutcome = {
    trialId: input.trialId,
    workerCount: input.workerCount,
    repetition: input.repetition,
    status: timed.value.status,
    patchesAttempted: input.patches.length,
    patchesApplied: timed.value.patchesApplied,
    validationCommands: input.validation.length,
    durationMs: timed.durationMs,
  };
  await input.events.emit("integration_finished", outcome);
  return outcome;
}
