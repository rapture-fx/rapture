import type { JsonValue, ProcessResult, TaskDefinition } from "../models.js";
import type { AgentCredentialProbe } from "./auth.js";

export interface AgentRunInput {
  readonly task: TaskDefinition;
  readonly worktree: string;
  readonly model: string | null;
  readonly trialId: string;
  readonly repetition: number;
}

export interface AgentRunResult {
  readonly process: ProcessResult;
  readonly tokenUsage: number | null;
  readonly providerCost: number | null;
  readonly toolCalls: readonly JsonValue[] | null;
  readonly observedCommands: readonly (readonly string[])[] | null;
}

export interface AgentAdapter {
  readonly name: () => string;
  readonly version: () => Promise<string | null>;
  readonly isAvailable: () => Promise<{ readonly available: boolean; readonly detail: string }>;
  readonly command: (input: AgentRunInput) => readonly string[];
  readonly run: (input: AgentRunInput) => Promise<AgentRunResult>;
  readonly extractUsageMetadata: (result: ProcessResult) => {
    readonly tokenUsage: number | null;
    readonly providerCost: number | null;
  };
  readonly probeCredentials: (
    env: Readonly<Record<string, string | undefined>>,
  ) => AgentCredentialProbe | Promise<AgentCredentialProbe>;
}
