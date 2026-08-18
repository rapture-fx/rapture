import type { ProcessResult } from "../models.js";
import { runProcess } from "../process.js";
import { detectCodexCredentialPresence } from "./auth.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

function prompt(input: AgentRunInput): string {
  return [
    `Complete this repository task: ${input.task.description}`,
    "Work only in the current repository. Do not push, open a PR, deploy, or access secrets.",
    "Make the smallest correct change and run relevant local checks.",
  ].join("\n");
}

export const codexAgentAdapter: AgentAdapter = {
  name: () => "codex",
  version: async () => {
    const result = await runProcess("codex", ["--version"], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  },
  isAvailable: async () => {
    try {
      const result = await runProcess("codex", ["--version"], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });
      return {
        available: result.exitCode === 0,
        detail: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
      };
    } catch (error: unknown) {
      return { available: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
  command: (input) => [
    "codex",
    "exec",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--color",
    "never",
    ...(input.model === null ? [] : ["--model", input.model]),
    prompt(input),
  ],
  run: async (input): Promise<AgentRunResult> => {
    const command = codexAgentAdapter.command(input);
    const executable = command[0];
    if (executable === undefined) throw new Error("Codex adapter command is empty");
    const processResult = await runProcess(executable, command.slice(1), {
      cwd: input.worktree,
      timeoutMs: input.task.timeoutSeconds * 1_000,
    });
    const usage = codexAgentAdapter.extractUsageMetadata(processResult);
    return {
      process: processResult,
      ...usage,
      toolCalls: null,
      observedCommands: null,
    };
  },
  // Codex's human-readable terminal output is not a stable usage contract.
  extractUsageMetadata: (_result: ProcessResult) => ({ tokenUsage: null, providerCost: null }),
  probeCredentials: async (env) => {
    const environmentProbe = detectCodexCredentialPresence(env);
    if (environmentProbe.present) return environmentProbe;

    try {
      const childEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      const status = await runProcess("codex", ["login", "status"], {
        cwd: process.cwd(),
        timeoutMs: 30_000,
        env: childEnv,
      });
      if (status.exitCode === 0) {
        return { ...environmentProbe, present: true, method: "chatgpt" };
      }
    } catch {
      // The doctor reports the same credential remediation for a missing CLI or failed status probe.
    }
    return environmentProbe;
  },
};
