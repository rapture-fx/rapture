import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProcessResult } from "../models.js";
import { runProcess } from "../process.js";
import { detectOpenCodeCredentialPresence } from "./auth.js";
import { parseOpenCodeUsage } from "./opencode-usage.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

function prompt(input: AgentRunInput): string {
  // The engineering request is identical whatever context is injected; only the fixed
  // pointer differs, so a paired experiment varies availability of context and nothing else.
  const suffix = input.task.context?.promptSuffix ?? "";
  return [
    `Complete this repository task: ${input.task.description}`,
    "Work only in the current repository. Do not push, open a PR, deploy, or access secrets.",
    "Make the smallest correct change and run relevant local checks.",
    ...(suffix === "" ? [] : [suffix]),
  ].join("\n");
}

export const OPENCODE_MODEL = "opencode/deepseek-v4-flash-free";

async function opencodeAuthStorageExists(
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  const dataHome = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  try {
    await access(join(dataHome, "opencode", "auth.json"));
    return true;
  } catch {
    return false;
  }
}

export const opencodeAgentAdapter: AgentAdapter = {
  name: () => "opencode",
  version: async () => {
    const result = await runProcess("opencode", ["--version"], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() || result.stderr.trim() : null;
  },
  isAvailable: async () => {
    try {
      const result = await runProcess("opencode", ["--version"], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });
      const version = result.stdout.trim() || result.stderr.trim();
      return {
        available: result.exitCode === 0 && version !== "",
        detail: result.exitCode === 0 ? version : result.stderr.trim() || result.stdout.trim(),
      };
    } catch (error: unknown) {
      return { available: false, detail: error instanceof Error ? error.message : String(error) };
    }
  },
  command: (input) => [
    "opencode",
    "run",
    "--dir",
    input.worktree,
    "--model",
    input.model === null ? OPENCODE_MODEL : input.model,
    "--agent",
    "build",
    "--format",
    "json",
    prompt(input),
  ],
  run: async (input): Promise<AgentRunResult> => {
    const command = opencodeAgentAdapter.command(input);
    const executable = command[0];
    if (executable === undefined) throw new Error("OpenCode adapter command is empty");
    const processResult = await runProcess(executable, command.slice(1), {
      cwd: input.worktree,
      timeoutMs: input.task.timeoutSeconds * 1_000,
    });
    const usage = opencodeAgentAdapter.extractUsageMetadata(processResult);
    return {
      process: processResult,
      ...usage,
      toolCalls: null,
      observedCommands: null,
    };
  },
  // OpenCode's `--format json` event stream is a stable session contract.
  // Usage is parsed only from well-formed step_finish events; anything else
  // leaves usage null so unstable output can never fabricate economics data.
  extractUsageMetadata: (result: ProcessResult) => {
    const parsed = parseOpenCodeUsage(result.stdout);
    return { tokenUsage: null, providerCost: null, usage: parsed.usage };
  },
  probeCredentials: async (env) => {
    const environmentProbe = detectOpenCodeCredentialPresence(env);
    if (environmentProbe.present) return environmentProbe;

    const storageExists = await opencodeAuthStorageExists(env);
    if (!storageExists) return environmentProbe;

    try {
      const childEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      const status = await runProcess("opencode", ["providers", "list"], {
        cwd: process.cwd(),
        timeoutMs: 30_000,
        env: childEnv,
      });
      if (status.exitCode === 0) {
        return { ...environmentProbe, present: true, method: "opencode" };
      }
    } catch {
      // The doctor reports the same remediation for a missing CLI or failed probe.
    }
    return environmentProbe;
  },
};
