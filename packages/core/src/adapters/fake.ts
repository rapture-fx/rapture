import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessResult } from "../models.js";
import { runProcess } from "../process.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

const workerScript = `
const fs = require("node:fs");
const path = require("node:path");
const configPath = process.argv[1];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const root = process.cwd();
setTimeout(() => {
  for (const [relative, content] of Object.entries(config.files)) {
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      console.error("refusing path outside worktree");
      process.exit(2);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  if (config.stdout) console.log(config.stdout);
  if (config.stderr) console.error(config.stderr);
  process.exit(config.exitCode);
}, config.delayMs);
`;

function configPath(input: AgentRunInput): string {
  return join(input.worktree, ".rapture-fake-agent.json");
}

export const fakeAgentAdapter: AgentAdapter = {
  name: () => "fake",
  version: async () => "1",
  isAvailable: async () => ({ available: true, detail: "deterministic built-in adapter" }),
  command: (input) => [process.execPath, "-e", workerScript, configPath(input)],
  run: async (input): Promise<AgentRunResult> => {
    if (input.task.fake === undefined) {
      throw new Error(`task ${input.task.id} has no fake adapter configuration`);
    }
    const path = configPath(input);
    await writeFile(path, JSON.stringify(input.task.fake), { encoding: "utf8", flag: "wx" });
    const command = fakeAgentAdapter.command(input);
    const executable = command[0];
    if (executable === undefined) throw new Error("fake adapter command is empty");
    let processResult: ProcessResult;
    try {
      processResult = await runProcess(executable, command.slice(1), {
        cwd: input.worktree,
        timeoutMs: input.task.timeoutSeconds * 1_000,
      });
    } finally {
      await rm(path, { force: true });
    }
    return {
      process: processResult,
      tokenUsage: null,
      providerCost: null,
      toolCalls: null,
      observedCommands: null,
    };
  },
  extractUsageMetadata: (_result: ProcessResult) => ({ tokenUsage: null, providerCost: null }),
};
