import type { EventWriter } from "./events.js";
import { runGit } from "./git.js";
import { validateCommands } from "./validation.js";
import type { WorktreeManager } from "./worktree.js";

export interface IntegrationOutcome {
  readonly workerCount: number;
  readonly status: "passed" | "failed" | "conflict";
  readonly patchesAttempted: number;
  readonly patchesApplied: number;
  readonly validationCommands: number;
}

export async function integratePatches(input: {
  readonly worktrees: WorktreeManager;
  readonly workerCount: number;
  readonly baseCommit: string;
  readonly patches: readonly string[];
  readonly validation: readonly string[];
  readonly events: EventWriter;
}): Promise<IntegrationOutcome> {
  const runId = `integration-w${input.workerCount}`;
  await input.events.emit("integration_started", {
    workerCount: input.workerCount,
    patchCount: input.patches.length,
  });
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
  const outcome: IntegrationOutcome = {
    workerCount: input.workerCount,
    status,
    patchesAttempted: input.patches.length,
    patchesApplied,
    validationCommands: input.validation.length,
  };
  await input.events.emit("integration_finished", outcome);
  return outcome;
}
