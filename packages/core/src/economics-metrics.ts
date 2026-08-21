import { z } from "zod";
import {
  type AgentUsage,
  deriveMachineCost,
  deriveProviderCost,
  type Money,
  type PricingContext,
  safeRatio,
  sumMoney,
  sumNullable,
  usageSourceSchema,
} from "./economics.js";
import { readEvents } from "./events.js";

const usageSchema = z.object({
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  cachedInputTokens: z.number().nonnegative().nullable(),
  reasoningTokens: z.number().nonnegative().nullable(),
  providerReportedCost: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  usageSource: usageSourceSchema,
});

const phaseTimingsSchema = z.object({
  agentExecutionMs: z.number().nonnegative().nullable(),
});

const taskFinishedSchema = z.object({
  trialId: z.string().min(1).optional(),
  repetition: z.number().int().positive().optional(),
  workerCount: z.number().int().positive(),
  accepted: z.boolean(),
  durationMs: z.number().nonnegative(),
  tokenUsage: z.number().nonnegative().nullable().optional(),
  providerCost: z.number().nonnegative().nullable().optional(),
  usage: usageSchema.nullable().optional(),
  phaseTimings: phaseTimingsSchema.optional(),
});

const trialBoundarySchema = z.object({
  trialId: z.string().min(1),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
});

const taskBoundarySchema = z.object({
  trialId: z.string().min(1).optional(),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive().optional(),
});

interface EconomicsRunRecord {
  readonly trialId: string;
  readonly workerCount: number;
  readonly accepted: boolean;
  readonly agentExecutionMs: number | null;
  readonly usage: AgentUsage | null;
}

interface EconomicsTrialRecord {
  trialId: string;
  workerCount: number;
  durationMs: number | null;
}

export interface UsageAvailability {
  readonly totalRuns: number;
  readonly runsWithUsage: number;
  readonly runsWithProviderReportedCost: number;
  readonly usageSources: readonly UsageSourceCount[];
}

export interface UsageSourceCount {
  readonly source: string;
  readonly runs: number;
}

export interface WorkerEconomics {
  readonly workerCount: number;
  readonly totalRuns: number;
  readonly acceptedTasks: number;
  readonly rejectedOrTimedOutRuns: number;
  readonly agentWallMsTotal: number | null;
  readonly machineWallMsTotal: number | null;
  readonly cpuTimeMsTotal: number | null;
  readonly inputTokensTotal: number | null;
  readonly outputTokensTotal: number | null;
  readonly cachedInputTokensTotal: number | null;
  readonly reasoningTokensTotal: number | null;
  readonly providerReportedCostTotal: Money | null;
  readonly derivedProviderCostTotal: Money | null;
  readonly machineCostTotal: Money | null;
  readonly totalConfiguredCost: Money | null;
  readonly acceptedTasksPerAgentHour: number | null;
  readonly acceptedTasksPerMachineHour: number | null;
  readonly acceptedTasksPerCpuHour: number | null;
  readonly providerCostPerAcceptedTask: Money | null;
  readonly machineCostPerAcceptedTask: Money | null;
  readonly totalConfiguredCostPerAcceptedTask: Money | null;
  readonly acceptedTasksPerProviderDollar: number | null;
  readonly acceptedTasksPerTotalConfiguredDollar: number | null;
}

export interface MarginalWorkerEconomics {
  readonly fromWorkers: number;
  readonly toWorkers: number;
  readonly incrementalAcceptedTasks: number | null;
  readonly incrementalAgentHours: number | null;
  readonly incrementalMachineHours: number | null;
  readonly incrementalProviderCost: Money | null;
  readonly incrementalConfiguredTotalCost: Money | null;
  readonly marginalProviderCostPerAdditionalAcceptedTask: Money | null;
  readonly marginalConfiguredTotalCostPerAdditionalAcceptedTask: Money | null;
  readonly marginalAcceptedTasksPerAdditionalProviderDollar: number | null;
  readonly marginalAcceptedTasksPerAdditionalConfiguredDollar: number | null;
}

export interface EconomicsReport {
  readonly schemaVersion: 1;
  readonly pricingContext: PricingContext | null;
  readonly usageAvailability: UsageAvailability;
  readonly workers: readonly WorkerEconomics[];
  readonly marginal: readonly MarginalWorkerEconomics[];
  readonly missingDataNotes: readonly string[];
}

const MS_PER_HOUR = 3_600_000;

function moneyPerTask(cost: Money | null, acceptedTasks: number): Money | null {
  if (cost === null || acceptedTasks <= 0) return null;
  return { amount: cost.amount / acceptedTasks, currency: cost.currency };
}

function tasksPerDollar(acceptedTasks: number, cost: Money | null): number | null {
  if (cost === null || cost.amount <= 0) return null;
  return acceptedTasks / cost.amount;
}

function subtractMoney(left: Money | null, right: Money | null): Money | null {
  if (left === null || right === null || left.currency !== right.currency) return null;
  return { amount: left.amount - right.amount, currency: left.currency };
}

function workerEconomicsFrom(
  workerCount: number,
  runs: readonly EconomicsRunRecord[],
  trials: readonly EconomicsTrialRecord[],
  pricing: PricingContext | null,
): WorkerEconomics {
  const acceptedTasks = runs.filter((run) => run.accepted).length;
  const agentWallMsTotal = sumNullable(runs.map((run) => run.agentExecutionMs));
  const machineWallMsTotal = sumNullable(trials.map((trial) => trial.durationMs));
  const usages = runs.map((run) => run.usage);
  const inputTokensTotal = sumNullable(usages.map((usage) => usage?.inputTokens ?? null));
  const outputTokensTotal = sumNullable(usages.map((usage) => usage?.outputTokens ?? null));
  const cachedInputTokensTotal = sumNullable(
    usages.map((usage) => usage?.cachedInputTokens ?? null),
  );
  const reasoningTokensTotal = sumNullable(usages.map((usage) => usage?.reasoningTokens ?? null));
  const providerReportedCostTotal = sumMoney(
    usages.map((usage) => {
      const cost = usage?.providerReportedCost ?? null;
      return cost === null ? null : { amount: cost, currency: usage?.currency ?? "unknown" };
    }),
  );
  const derivedCosts =
    pricing === null
      ? []
      : usages.map((usage): Money | null =>
          usage === null ? null : deriveProviderCost(usage, pricing),
        );
  const derivedProviderCostTotal = pricing === null ? null : sumMoney(derivedCosts);
  const machineCostTotal =
    pricing === null
      ? null
      : deriveMachineCost(machineWallMsTotal, pricing.machineCostPerHour, pricing.currency);
  const configuredCandidates = [derivedProviderCostTotal, machineCostTotal].filter(
    (value): value is Money => value !== null,
  );
  const totalConfiguredCost =
    derivedProviderCostTotal === null && machineCostTotal === null
      ? (providerReportedCostTotal ?? null)
      : sumMoney(configuredCandidates);
  return {
    workerCount,
    totalRuns: runs.length,
    acceptedTasks,
    rejectedOrTimedOutRuns: runs.length - acceptedTasks,
    agentWallMsTotal,
    machineWallMsTotal,
    cpuTimeMsTotal: null,
    inputTokensTotal,
    outputTokensTotal,
    cachedInputTokensTotal,
    reasoningTokensTotal,
    providerReportedCostTotal,
    derivedProviderCostTotal,
    machineCostTotal,
    totalConfiguredCost,
    acceptedTasksPerAgentHour: safeRatio(
      acceptedTasks,
      agentWallMsTotal === null ? null : agentWallMsTotal / MS_PER_HOUR,
    ),
    acceptedTasksPerMachineHour: safeRatio(
      acceptedTasks,
      machineWallMsTotal === null ? null : machineWallMsTotal / MS_PER_HOUR,
    ),
    acceptedTasksPerCpuHour: null,
    providerCostPerAcceptedTask: moneyPerTask(
      derivedProviderCostTotal ?? providerReportedCostTotal,
      acceptedTasks,
    ),
    machineCostPerAcceptedTask: moneyPerTask(machineCostTotal, acceptedTasks),
    totalConfiguredCostPerAcceptedTask: moneyPerTask(totalConfiguredCost, acceptedTasks),
    acceptedTasksPerProviderDollar: tasksPerDollar(
      acceptedTasks,
      derivedProviderCostTotal ?? providerReportedCostTotal,
    ),
    acceptedTasksPerTotalConfiguredDollar: tasksPerDollar(acceptedTasks, totalConfiguredCost),
  };
}

function marginalEconomicsFrom(
  from: WorkerEconomics,
  to: WorkerEconomics,
): MarginalWorkerEconomics {
  const incrementalAcceptedTasks =
    from.acceptedTasks === 0 || to.acceptedTasks === 0
      ? null
      : to.acceptedTasks - from.acceptedTasks;
  const incrementalAgentHours =
    from.agentWallMsTotal === null || to.agentWallMsTotal === null
      ? null
      : (to.agentWallMsTotal - from.agentWallMsTotal) / MS_PER_HOUR;
  const incrementalMachineHours =
    from.machineWallMsTotal === null || to.machineWallMsTotal === null
      ? null
      : (to.machineWallMsTotal - from.machineWallMsTotal) / MS_PER_HOUR;
  const incrementalProviderCost = subtractMoney(
    to.derivedProviderCostTotal ?? to.providerReportedCostTotal,
    from.derivedProviderCostTotal ?? from.providerReportedCostTotal,
  );
  const incrementalConfiguredTotalCost = subtractMoney(
    to.totalConfiguredCost,
    from.totalConfiguredCost,
  );
  return {
    fromWorkers: from.workerCount,
    toWorkers: to.workerCount,
    incrementalAcceptedTasks,
    incrementalAgentHours,
    incrementalMachineHours,
    incrementalProviderCost,
    incrementalConfiguredTotalCost,
    marginalProviderCostPerAdditionalAcceptedTask:
      incrementalAcceptedTasks === null || incrementalAcceptedTasks <= 0
        ? null
        : moneyPerTask(incrementalProviderCost, incrementalAcceptedTasks),
    marginalConfiguredTotalCostPerAdditionalAcceptedTask:
      incrementalAcceptedTasks === null || incrementalAcceptedTasks <= 0
        ? null
        : moneyPerTask(incrementalConfiguredTotalCost, incrementalAcceptedTasks),
    marginalAcceptedTasksPerAdditionalProviderDollar:
      incrementalProviderCost === null ||
      incrementalProviderCost.amount <= 0 ||
      incrementalAcceptedTasks === null
        ? null
        : incrementalAcceptedTasks / incrementalProviderCost.amount,
    marginalAcceptedTasksPerAdditionalConfiguredDollar:
      incrementalConfiguredTotalCost === null ||
      incrementalConfiguredTotalCost.amount <= 0 ||
      incrementalAcceptedTasks === null
        ? null
        : incrementalAcceptedTasks / incrementalConfiguredTotalCost.amount,
  };
}

function missingDataNotesFor(
  pricing: PricingContext | null,
  availability: UsageAvailability,
): string[] {
  const notes: string[] = [];
  if (availability.runsWithUsage < availability.totalRuns) {
    notes.push(
      `${availability.totalRuns - availability.runsWithUsage} of ${availability.totalRuns} runs have no structured usage metadata; token and derived-cost totals are null.`,
    );
  }
  if (pricing === null) {
    notes.push(
      "No pricing context was supplied; all derived monetary metrics are null. Provider-reported costs are shown independently when available.",
    );
  }
  return notes;
}

export async function deriveEconomics(
  eventsPath: string,
  pricing: PricingContext | null,
): Promise<EconomicsReport> {
  const events = await readEvents(eventsPath);
  const runsByTrial = new Map<string, EconomicsRunRecord[]>();
  const trials = new Map<string, EconomicsTrialRecord>();
  for (const event of events) {
    if (event.eventType === "trial_finished") {
      const data = trialBoundarySchema.parse(event.data);
      const existing = trials.get(data.trialId);
      if (existing !== undefined && data.durationMs !== undefined) {
        existing.durationMs = data.durationMs;
      } else if (existing === undefined) {
        trials.set(data.trialId, {
          trialId: data.trialId,
          workerCount: data.workerCount,
          durationMs: data.durationMs ?? null,
        });
      }
    }
    if (event.eventType === "task_started") {
      const data = taskBoundarySchema.parse(event.data);
      const trialId = data.trialId ?? `workers-${data.workerCount}-trial-${data.repetition ?? 1}`;
      if (!trials.has(trialId)) {
        trials.set(trialId, {
          trialId,
          workerCount: data.workerCount,
          durationMs: null,
        });
      }
    }
    if (event.eventType === "task_finished") {
      const data = taskFinishedSchema.parse(event.data);
      const trialId = data.trialId ?? `workers-${data.workerCount}-trial-${data.repetition ?? 1}`;
      const record: EconomicsRunRecord = {
        trialId,
        workerCount: data.workerCount,
        accepted: data.accepted,
        agentExecutionMs: data.phaseTimings?.agentExecutionMs ?? null,
        usage: data.usage ?? null,
      };
      const existing = runsByTrial.get(trialId) ?? [];
      existing.push(record);
      runsByTrial.set(trialId, existing);
      if (!trials.has(trialId)) {
        trials.set(trialId, {
          trialId,
          workerCount: data.workerCount,
          durationMs: null,
        });
      }
    }
  }

  const byWorker = new Map<
    number,
    { runs: EconomicsRunRecord[]; trials: EconomicsTrialRecord[] }
  >();
  for (const trial of trials.values()) {
    const entry = byWorker.get(trial.workerCount) ?? { runs: [], trials: [] };
    entry.trials.push(trial);
    entry.runs.push(...(runsByTrial.get(trial.trialId) ?? []));
    byWorker.set(trial.workerCount, entry);
  }

  const workers = [...byWorker.keys()]
    .sort((left, right) => left - right)
    .map((workerCount) => {
      const entry = byWorker.get(workerCount);
      if (entry === undefined) throw new Error(`missing economics records for ${workerCount}`);
      return workerEconomicsFrom(workerCount, entry.runs, entry.trials, pricing);
    });

  const totalRuns = [...byWorker.values()].reduce((total, entry) => total + entry.runs.length, 0);
  const usageRecords = [...byWorker.values()].flatMap((entry) => entry.runs);
  const sourceCounts = new Map<string, number>();
  let runsWithUsage = 0;
  let runsWithProviderReportedCost = 0;
  for (const run of usageRecords) {
    if (run.usage !== null) {
      runsWithUsage += 1;
      sourceCounts.set(run.usage.usageSource, (sourceCounts.get(run.usage.usageSource) ?? 0) + 1);
      if (run.usage.providerReportedCost !== null) runsWithProviderReportedCost += 1;
    }
  }
  const usageAvailability: UsageAvailability = {
    totalRuns,
    runsWithUsage,
    runsWithProviderReportedCost,
    usageSources: [...sourceCounts.entries()].map(([source, runs]) => ({ source, runs })),
  };

  const marginal: MarginalWorkerEconomics[] = [];
  for (let index = 1; index < workers.length; index += 1) {
    const previous = workers[index - 1];
    const current = workers[index];
    if (previous === undefined || current === undefined) continue;
    marginal.push(marginalEconomicsFrom(previous, current));
  }

  return {
    schemaVersion: 1,
    pricingContext: pricing,
    usageAvailability,
    workers,
    marginal,
    missingDataNotes: missingDataNotesFor(pricing, usageAvailability),
  };
}
