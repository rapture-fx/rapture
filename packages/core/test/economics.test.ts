import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPricingConfig } from "../src/doctor-checks.js";
import {
  type AgentUsage,
  deriveMachineCost,
  deriveProviderCost,
  loadPricingContext,
  type PricingContext,
  roundForPresentation,
  safeRatio,
  sumMoney,
  sumNullable,
  validatePricingContext,
} from "../src/economics.js";
import { deriveEconomics } from "../src/economics-metrics.js";

const pricing: PricingContext = {
  provider: "test-provider",
  model: "test-model",
  currency: "USD",
  inputCostPerMillionTokens: 1,
  outputCostPerMillionTokens: 3,
  cachedInputCostPerMillionTokens: 0.1,
  reasoningCostPerMillionTokens: 5,
  machineCostPerHour: 3.6,
  pricingSource: "unit-test",
  pricingEffectiveDate: "2026-08-21T00:00:00.000Z",
};

function usage(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    providerReportedCost: null,
    currency: null,
    usageSource: "cli_structured",
    ...overrides,
  };
}

describe("provider cost derivation", () => {
  it("computes exact cost from complete token categories and pricing", () => {
    const cost = deriveProviderCost(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 2_000_000,
        reasoningTokens: 100_000,
      }),
      pricing,
    );
    expect(cost).toEqual({
      amount: 1 + 1.5 + 0.2 + 0.5,
      currency: "USD",
    });
  });

  it("treats zero cached/reasoning tokens as free categories", () => {
    const noOptionalRates: PricingContext = {
      ...pricing,
      cachedInputCostPerMillionTokens: null,
      reasoningCostPerMillionTokens: null,
    };
    const cost = deriveProviderCost(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      }),
      noOptionalRates,
    );
    expect(cost).toEqual({ amount: 4, currency: "USD" });
  });

  it("returns null when token categories are missing", () => {
    expect(deriveProviderCost(usage({ inputTokens: 10 }), pricing)).toBeNull();
    expect(deriveProviderCost(usage({ outputTokens: 10 }), pricing)).toBeNull();
  });

  it("returns null when a nonzero category has no price", () => {
    const noCachedPrice: PricingContext = { ...pricing, cachedInputCostPerMillionTokens: null };
    expect(
      deriveProviderCost(
        usage({ inputTokens: 10, outputTokens: 10, cachedInputTokens: 100 }),
        noCachedPrice,
      ),
    ).toBeNull();
    const noReasoningPrice: PricingContext = { ...pricing, reasoningCostPerMillionTokens: null };
    expect(
      deriveProviderCost(
        usage({ inputTokens: 10, outputTokens: 10, reasoningTokens: 100 }),
        noReasoningPrice,
      ),
    ).toBeNull();
  });

  it("fails closed when uncategorized token categories are present", () => {
    expect(
      deriveProviderCost(
        usage({
          inputTokens: 10,
          outputTokens: 10,
          uncategorizedTokenCategories: ["cache_write"],
        }),
        pricing,
      ),
    ).toBeNull();
  });
});

describe("machine cost derivation", () => {
  it("multiplies wall-clock machine hours by the configured hourly rate exactly", () => {
    // 90 minutes of shared-host wall time at 4/hour = 6.
    expect(deriveMachineCost(5_400_000, 4, "USD")).toEqual({ amount: 6, currency: "USD" });
  });

  it("returns null for missing or negative inputs", () => {
    expect(deriveMachineCost(null, 4, "USD")).toBeNull();
    expect(deriveMachineCost(60_000, null, "USD")).toBeNull();
    expect(deriveMachineCost(60_000, 4, null)).toBeNull();
    expect(deriveMachineCost(-1, 4, "USD")).toBeNull();
    expect(deriveMachineCost(60_000, -4, "USD")).toBeNull();
  });
});

describe("numeric helpers", () => {
  it("safeRatio returns null on missing, non-finite, or non-positive denominators", () => {
    expect(safeRatio(1, 0)).toBeNull();
    expect(safeRatio(1, -1)).toBeNull();
    expect(safeRatio(null, 1)).toBeNull();
    expect(safeRatio(1, null)).toBeNull();
    expect(safeRatio(Number.NaN, 1)).toBeNull();
    expect(safeRatio(9, 3)).toBe(3);
  });

  it("sumNullable is all-or-nothing", () => {
    expect(sumNullable([1, 2, 3])).toBe(6);
    expect(sumNullable([1, null, 3])).toBeNull();
    expect(sumNullable([])).toBeNull();
  });

  it("sumMoney never collapses currencies and fails closed on gaps", () => {
    expect(
      sumMoney([
        { amount: 1, currency: "USD" },
        { amount: 2, currency: "USD" },
      ]),
    ).toEqual({
      amount: 3,
      currency: "USD",
    });
    expect(
      sumMoney([
        { amount: 1, currency: "USD" },
        { amount: 2, currency: "EUR" },
      ]),
    ).toBeNull();
    expect(sumMoney([{ amount: 1, currency: "USD" }, null])).toBeNull();
  });

  it("roundForPresentation only affects presentation values", () => {
    expect(roundForPresentation(1 / 3)).toBe(0.333333);
    expect(roundForPresentation(null)).toBeNull();
    expect(roundForPresentation(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("pricing context validation", () => {
  it("accepts a valid context with provenance", () => {
    const result = validatePricingContext(pricing);
    expect(result.valid).toBe(true);
  });

  it("rejects invalid currency codes", () => {
    const result = validatePricingContext({ ...pricing, currency: "dollars" });
    expect(result.valid).toBe(false);
  });

  it("requires an effective date", () => {
    const { pricingEffectiveDate: _omitted, ...withoutDate } = pricing;
    void _omitted;
    const result = validatePricingContext(withoutDate);
    expect(result.valid).toBe(false);
  });

  it("rejects negative prices and unknown fields", () => {
    expect(validatePricingContext({ ...pricing, inputCostPerMillionTokens: -1 }).valid).toBe(false);
    expect(validatePricingContext({ ...pricing, surprise: true }).valid).toBe(false);
  });

  it("loads and validates versioned pricing JSON from disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rapture-pricing-"));
    const path = join(directory, "pricing.json");
    await writeFile(path, JSON.stringify(pricing), "utf8");
    const loaded = await loadPricingContext(path);
    expect(loaded).toEqual(pricing);
    const badPath = join(directory, "bad.json");
    await writeFile(badPath, JSON.stringify({ provider: "x" }), "utf8");
    await expect(loadPricingContext(badPath)).rejects.toThrow(/invalid pricing context/u);
  });
});

describe("doctor pricing checks", () => {
  it("does not block when pricing is absent", () => {
    const check = checkPricingConfig(null);
    expect(check.status).toBe("PASS");
  });

  it("warns instead of blocking on invalid supplied pricing", () => {
    const check = checkPricingConfig({ provider: "x" });
    expect(check.status).toBe("WARNING");
    expect(check.message).toContain("derived monetary metrics are disabled");
  });

  it("passes for valid pricing with provenance", () => {
    const check = checkPricingConfig(pricing);
    expect(check.status).toBe("PASS");
  });

  it("warns on pricing model identity mismatch", () => {
    const check = checkPricingConfig(pricing, {
      agentProvider: "test-provider",
      agentModel: "other-model",
    });
    expect(check.status).toBe("WARNING");
    expect(check.message).toContain("does not match");
  });
});

interface SyntheticRunEvent {
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition?: number;
  readonly accepted: boolean;
  readonly agentExecutionMs: number | null;
  readonly usage: AgentUsage | null;
}

async function writeSyntheticEvents(events: readonly object[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rapture-econ-events-"));
  const path = join(directory, "events.jsonl");
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      sequence: index + 1,
      eventType: "task_finished",
      experimentId: "exp-econ-test",
      timestamp: "2026-08-21T00:00:00.000Z",
      data: event,
    }),
  );
  const trialLines = [1, 2].map((workerCount, index) =>
    JSON.stringify({
      schemaVersion: 1,
      sequence: 100 + index,
      eventType: "trial_finished",
      experimentId: "exp-econ-test",
      timestamp: "2026-08-21T00:00:00.000Z",
      data: {
        trialId: `workers-${workerCount}-trial-1`,
        workerCount,
        repetition: 1,
        durationMs: workerCount === 1 ? 3_600_000 : 1_800_000,
      },
    }),
  );
  await writeFile(path, [...lines, ...trialLines].join("\n"), "utf8");
  return path;
}

function syntheticRun(run: SyntheticRunEvent): object {
  return {
    trialId: run.trialId,
    workerCount: run.workerCount,
    accepted: run.accepted,
    durationMs: run.agentExecutionMs ?? 0,
    phaseTimings: { agentExecutionMs: run.agentExecutionMs },
    usage: run.usage,
  };
}

describe("economics metrics derivation", () => {
  it("derives exact accepted-output economics from synthetic usage", async () => {
    const full: AgentUsage = usage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const path = await writeSyntheticEvents([
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: true,
        agentExecutionMs: 1_800_000,
        usage: full,
      }),
      syntheticRun({
        trialId: "workers-2-trial-1",
        workerCount: 2,
        accepted: true,
        agentExecutionMs: 900_000,
        usage: full,
      }),
      syntheticRun({
        trialId: "workers-2-trial-1",
        workerCount: 2,
        accepted: true,
        agentExecutionMs: 900_000,
        usage: full,
      }),
    ]);
    const report = await deriveEconomics(path, pricing);
    const one = report.workers.find((worker) => worker.workerCount === 1);
    expect(one?.acceptedTasks).toBe(1);
    // input at 1/Mtok = 1; output at 3/Mtok = 3.
    expect(one?.derivedProviderCostTotal).toEqual({ amount: 4, currency: "USD" });
    // 30 agent-minutes at workers=1 -> 0.5 accepted tasks per agent-hour.
    expect(one?.acceptedTasksPerAgentHour).toBeCloseTo(2, 10);
    // Trial wall of one hour -> 1 task per machine-hour (shared host counted once).
    expect(one?.acceptedTasksPerMachineHour).toBeCloseTo(1, 10);
    expect(one?.machineCostTotal).toEqual({ amount: 3.6, currency: "USD" });
    // Total configured = 4 provider + 3.6 machine = 7.6 over 1 accepted task.
    expect(one?.totalConfiguredCost).toEqual({ amount: 7.6, currency: "USD" });
    expect(one?.totalConfiguredCostPerAcceptedTask).toEqual({ amount: 7.6, currency: "USD" });
    expect(one?.acceptedTasksPerTotalConfiguredDollar).toBeCloseTo(1 / 7.6, 10);

    const two = report.workers.find((worker) => worker.workerCount === 2);
    expect(two?.acceptedTasks).toBe(2);
    expect(two?.derivedProviderCostTotal).toEqual({ amount: 8, currency: "USD" });
    // Two parallel agents, 30 minutes each: agent-hours double even though
    // machine wall time stays at the single shared-host half hour.
    expect(two?.agentWallMsTotal).toBe(1_800_000);
    expect(two?.machineWallMsTotal).toBe(1_800_000);
    expect(two?.machineCostTotal).toEqual({ amount: 1.8, currency: "USD" });

    const marginal = report.marginal[0];
    expect(marginal?.fromWorkers).toBe(1);
    expect(marginal?.toWorkers).toBe(2);
    expect(marginal?.incrementalAcceptedTasks).toBe(1);
    // Two parallel half-hour agents replace one half-hour agent:
    // agent-hours stay flat while machine wall time halves.
    expect(marginal?.incrementalAgentHours).toBeCloseTo(0, 10);
    expect(marginal?.incrementalMachineHours).toBeCloseTo(-0.5, 10);
    expect(marginal?.incrementalProviderCost).toEqual({ amount: 4, currency: "USD" });
    expect(marginal?.marginalProviderCostPerAdditionalAcceptedTask).toEqual({
      amount: 4,
      currency: "USD",
    });
    expect(marginal?.marginalAcceptedTasksPerAdditionalProviderDollar).toBeCloseTo(0.25, 10);
  });

  it("counts rejected and timed-out runs in consumption but not acceptance", async () => {
    const path = await writeSyntheticEvents([
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: true,
        agentExecutionMs: 600_000,
        usage: usage({ inputTokens: 500_000, outputTokens: 500_000 }),
      }),
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: false,
        agentExecutionMs: 600_000,
        usage: usage({ inputTokens: 500_000, outputTokens: 500_000 }),
      }),
    ]);
    const report = await deriveEconomics(path, pricing);
    const one = report.workers[0];
    expect(one?.acceptedTasks).toBe(1);
    expect(one?.totalRuns).toBe(2);
    expect(one?.rejectedOrTimedOutRuns).toBe(1);
    // Both runs consume tokens/cost even though only one was accepted.
    expect(one?.inputTokensTotal).toBe(1_000_000);
    expect(one?.derivedProviderCostTotal).toEqual({ amount: 4, currency: "USD" });
    expect(one?.providerCostPerAcceptedTask).toEqual({ amount: 4, currency: "USD" });
  });

  it("propagates nulls when usage or pricing data is unavailable", async () => {
    const path = await writeSyntheticEvents([
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: true,
        agentExecutionMs: 600_000,
        usage: null,
      }),
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: false,
        agentExecutionMs: 600_000,
        usage: usage({ inputTokens: 10, outputTokens: 10 }),
      }),
    ]);
    const withoutPricing = await deriveEconomics(path, null);
    expect(withoutPricing.workers[0]?.derivedProviderCostTotal).toBeNull();
    expect(withoutPricing.workers[0]?.machineCostTotal).toBeNull();
    expect(withoutPricing.workers[0]?.totalConfiguredCost).toBeNull();
    expect(withoutPricing.pricingContext).toBeNull();

    const withPricing = await deriveEconomics(path, pricing);
    // One run lacks usage entirely, so aggregate spend must fail closed to null.
    expect(withPricing.workers[0]?.inputTokensTotal).toBeNull();
    expect(withPricing.workers[0]?.derivedProviderCostTotal).toBeNull();
    expect(withPricing.workers[0]?.agentWallMsTotal).toBe(1_200_000);
    expect(withPricing.usageAvailability.runsWithUsage).toBe(1);
    expect(withPricing.usageAvailability.totalRuns).toBe(2);
  });

  it("never collapses mixed currencies in provider-reported spend", async () => {
    const path = await writeSyntheticEvents([
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: true,
        agentExecutionMs: 600_000,
        usage: usage({ providerReportedCost: 1, currency: "USD" }),
      }),
      syntheticRun({
        trialId: "workers-1-trial-1",
        workerCount: 1,
        accepted: false,
        agentExecutionMs: 600_000,
        usage: usage({ providerReportedCost: 1, currency: "EUR" }),
      }),
    ]);
    const report = await deriveEconomics(path, null);
    expect(report.workers[0]?.providerReportedCostTotal).toBeNull();
  });
});
