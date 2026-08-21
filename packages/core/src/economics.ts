import { readFile } from "node:fs/promises";
import { z } from "zod";

export type UsageSource =
  | "provider_reported"
  | "cli_structured"
  | "derived_from_pricing"
  | "unavailable";

export const usageSourceSchema = z.enum([
  "provider_reported",
  "cli_structured",
  "derived_from_pricing",
  "unavailable",
]);

export interface AgentUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly providerReportedCost: number | null;
  readonly currency: string | null;
  readonly usageSource: UsageSource;
  /**
   * Token categories observed in provider output that the pricing context
   * cannot price (for example cache-write tokens). When non-empty, derived
   * monetary cost must stay null so unpriced categories are never ignored.
   */
  readonly uncategorizedTokenCategories?: readonly string[];
}

export interface MachineUsage {
  readonly agentWallMs: number | null;
  readonly cpuTimeMs: number | null;
  readonly peakRssBytes: number | null;
  readonly meanCpuUtilization: number | null;
  readonly meanMemoryBytes: number | null;
}

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export const pricingContextSchema = z
  .object({
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/u, "currency must be a 3-letter code"),
    inputCostPerMillionTokens: z.number().nonnegative(),
    outputCostPerMillionTokens: z.number().nonnegative(),
    cachedInputCostPerMillionTokens: z.number().nonnegative().nullable().default(null),
    reasoningCostPerMillionTokens: z.number().nonnegative().nullable().default(null),
    machineCostPerHour: z.number().nonnegative().nullable().default(null),
    pricingSource: z.string().trim().min(1),
    pricingEffectiveDate: z.iso.datetime({ offset: true }),
  })
  .strict();

export type PricingContext = z.infer<typeof pricingContextSchema>;

const MS_PER_HOUR = 3_600_000;

export function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function sumNullable(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function sumMoney(values: readonly (Money | null)[]): Money | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (first === undefined || first === null) return null;
  if (values.some((value) => value === null)) return null;
  if (values.some((value) => value?.currency !== first.currency)) return null;
  return {
    amount: values.reduce<number>((total, value) => total + (value?.amount ?? 0), 0),
    currency: first.currency,
  };
}

export function deriveProviderCost(usage: AgentUsage, pricing: PricingContext): Money | null {
  if ((usage.uncategorizedTokenCategories?.length ?? 0) > 0) return null;
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  if (
    usage.cachedInputTokens !== null &&
    usage.cachedInputTokens > 0 &&
    pricing.cachedInputCostPerMillionTokens === null
  ) {
    return null;
  }
  if (
    usage.reasoningTokens !== null &&
    usage.reasoningTokens > 0 &&
    pricing.reasoningCostPerMillionTokens === null
  ) {
    return null;
  }
  const amount =
    (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillionTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillionTokens +
    ((usage.cachedInputTokens ?? 0) / 1_000_000) * (pricing.cachedInputCostPerMillionTokens ?? 0) +
    ((usage.reasoningTokens ?? 0) / 1_000_000) * (pricing.reasoningCostPerMillionTokens ?? 0);
  return { amount, currency: pricing.currency };
}

export function deriveMachineCost(
  machineWallMs: number | null,
  machineCostPerHour: number | null,
  currency: string | null,
): Money | null {
  if (machineWallMs === null || machineCostPerHour === null || currency === null) return null;
  if (machineWallMs < 0 || machineCostPerHour < 0) return null;
  return { amount: (machineWallMs / MS_PER_HOUR) * machineCostPerHour, currency };
}

export function roundForPresentation(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function loadPricingContext(path: string): Promise<PricingContext> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`unable to read pricing context: ${detail}`);
  }
  const result = pricingContextSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid pricing context: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function validatePricingContext(value: unknown): {
  valid: boolean;
  detail: string;
} {
  const result = pricingContextSchema.safeParse(value);
  if (!result.success) {
    return { valid: false, detail: z.prettifyError(result.error) };
  }
  return { valid: true, detail: "pricing context is valid" };
}
