import { z } from "zod";
import type { AgentUsage } from "../models.js";

const stepFinishSchema = z.object({
  type: z.literal("step_finish"),
  part: z
    .object({
      tokens: z
        .object({
          input: z.number().nonnegative(),
          output: z.number().nonnegative(),
          reasoning: z.number().nonnegative(),
          cache: z.object({
            read: z.number().nonnegative(),
            write: z.number().nonnegative(),
          }),
        })
        .optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

export interface OpenCodeUsageParseResult {
  readonly usage: AgentUsage | null;
  readonly steps: number;
  readonly stepsWithTokens: number;
  readonly sawCacheWrite: boolean;
}

// Parses OpenCode's structured `--format json` event stream. Only lines that
// parse as well-formed step_finish events with complete token objects are
// counted; anything else is ignored so unstable output can never fabricate data.
export function parseOpenCodeUsage(stdout: string): OpenCodeUsageParseResult {
  let steps = 0;
  let stepsWithTokens = 0;
  let stepsWithCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let providerReportedCost = 0;
  let sawCacheWrite = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const result = stepFinishSchema.safeParse(parsed);
    if (!result.success) continue;
    steps += 1;
    const tokens = result.data.part?.tokens;
    if (tokens !== undefined) {
      stepsWithTokens += 1;
      inputTokens += tokens.input;
      outputTokens += tokens.output;
      cachedInputTokens += tokens.cache.read;
      reasoningTokens += tokens.reasoning;
      if (tokens.cache.write > 0) sawCacheWrite = true;
    }
    const cost = result.data.part?.cost;
    if (cost !== undefined) {
      stepsWithCost += 1;
      providerReportedCost += cost;
    }
  }
  if (steps === 0 || stepsWithTokens === 0) {
    return { usage: null, steps, stepsWithTokens, sawCacheWrite };
  }
  return {
    usage: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens,
      providerReportedCost: stepsWithCost === steps ? providerReportedCost : null,
      currency: null,
      usageSource: "cli_structured",
      uncategorizedTokenCategories: sawCacheWrite ? ["cache_write"] : [],
    },
    steps,
    stepsWithTokens,
    sawCacheWrite,
  };
}
