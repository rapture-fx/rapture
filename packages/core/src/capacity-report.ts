import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CapacityCurve } from "./capacity.js";
import {
  aggregateTelemetry,
  buildCapacityCurve,
  type CapacityPointInput,
  type CapacityResourceAggregate,
} from "./capacity.js";
import { readEvents } from "./events.js";
import {
  DEFAULT_KNEE_THRESHOLDS,
  detectCapacityKnee,
  type KneeDetection,
  type KneeDetectorThresholds,
} from "./knee.js";
import { deriveMetrics } from "./metrics.js";
import type { ExperimentMetrics, HostTelemetrySample } from "./models.js";
import {
  createPredictionStore,
  OutcomeAlreadyExistsError,
  PredictionAlreadyExistsError,
  type PredictionRecord,
} from "./prediction-store.js";
import {
  ALL_PREDICTORS,
  BASELINE_CPU_SATURATION_FRACTION,
  BASELINE_MEMORY_PRESSURE_FRACTION,
  classifyObservedOutcome,
  DEFAULT_RAPTURE_THRESHOLDS,
  evaluatePredictions,
  type ObservedOutcome,
  type PredictionState,
  type PredictorEvaluation,
  type PredictorId,
  runAllPredictors,
} from "./predictors.js";

/**
 * Persist predictions for the next tested worker count before any of its
 * trials execute. Returns true when a prediction chronology entry was written.
 *
 * Predictions are only recorded when every observed worker count up to
 * `completedWorkerCount` has a complete set of finished trials, so an
 * interrupted run never predicts from incomplete evidence; resume re-invokes
 * this once the group completes.
 */
export async function persistStepPredictions(
  experimentDirectory: string,
  completedWorkerCount: number,
  repetitions: number,
): Promise<boolean> {
  const directory = resolve(experimentDirectory);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as {
    experimentId: string;
    workerCounts: readonly number[];
  };
  const sorted = [...new Set(manifest.workerCounts)].sort((left, right) => left - right);
  const target = sorted.find((count) => count > completedWorkerCount);
  if (target === undefined) return false;
  const observed = sorted.filter((count) => count <= completedWorkerCount);

  const eventsPath = join(directory, "events.jsonl");
  const windows = await loadTrialWindows(eventsPath);
  const observedComplete = observed.every(
    (count) =>
      windows.filter((window) => window.workerCount === count && window.endMs !== null).length ===
      repetitions,
  );
  if (!observedComplete) return false;

  const metrics = await deriveMetrics(eventsPath);
  const samples = await loadTelemetrySamples(join(directory, "telemetry.jsonl"));
  const revealedWindows = windows.filter((window) => observed.includes(window.workerCount));
  const resources = telemetryByWorkerCount(revealedWindows, samples);
  const revealedInputs = capacityInputsFromMetrics(metrics).filter(
    (input) => input.workerCount <= completedWorkerCount,
  );
  const predictions = computeStepPredictions(revealedInputs, resources, observed, target);

  const store = await createPredictionStore(join(directory, "predictions.jsonl"));
  let wrote = false;
  for (const prediction of predictions) {
    const record: PredictionRecord = {
      schemaVersion: 1,
      kind: "prediction",
      experimentId: manifest.experimentId,
      predictorId: prediction.predictor.id,
      predictorVersion: prediction.predictor.version,
      observedWorkerCounts: [...prediction.evidence.observedWorkerCounts],
      targetWorkerCount: prediction.targetWorkerCount,
      question: prediction.question,
      predictedState: prediction.predictedState,
      confidence: prediction.confidence,
      evidence: { ...prediction.evidence },
      detectorConfiguration: {
        raptureThresholds: { ...DEFAULT_RAPTURE_THRESHOLDS },
        baselineCpuSaturationFraction: BASELINE_CPU_SATURATION_FRACTION,
        baselineMemoryPressureFraction: BASELINE_MEMORY_PRESSURE_FRACTION,
      },
      persistedAt: new Date().toISOString(),
    };
    try {
      await store.appendPrediction(record);
      wrote = true;
    } catch (error: unknown) {
      if (!(error instanceof PredictionAlreadyExistsError)) throw error;
    }
  }
  return wrote;
}

/**
 * Append observed held-out outcomes for any persisted predictions whose target
 * worker count has completed. Never rewrites predictions or existing outcomes.
 */
export async function appendObservedOutcomes(experimentDirectory: string): Promise<number> {
  const directory = resolve(experimentDirectory);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as {
    experimentId: string;
    workerCounts: readonly number[];
    repetitions: number;
  };
  const store = await createPredictionStore(join(directory, "predictions.jsonl"));
  const { predictions, outcomes } = await store.read();
  if (predictions.length === 0) return 0;
  const targets = [...new Set(predictions.map((prediction) => prediction.targetWorkerCount))];

  const eventsPath = join(directory, "events.jsonl");
  const windows = await loadTrialWindows(eventsPath);
  const context = await loadCapacityContext(directory);
  let appended = 0;
  for (const target of targets) {
    if (outcomes.some((outcome) => outcome.targetWorkerCount === target)) continue;
    const complete =
      windows.filter((window) => window.workerCount === target && window.endMs !== null).length ===
      manifest.repetitions;
    if (!complete) continue;
    const outcome = classifyObservedOutcome(context.curve, target);
    try {
      await store.appendOutcome({
        schemaVersion: 1,
        kind: "outcome",
        experimentId: manifest.experimentId,
        targetWorkerCount: target,
        observedOutcome: { ...outcome },
        recordedAt: new Date().toISOString(),
      });
      appended += 1;
    } catch (error: unknown) {
      if (!(error instanceof OutcomeAlreadyExistsError)) throw error;
    }
  }
  return appended;
}

/** Deterministically recompute predictions offline from restricted evidence. */
export function regenerateStepPredictions(
  context: CapacityContext,
  sortedWorkerCounts: readonly number[],
  repetitions: number,
  thresholds: KneeDetectorThresholds = DEFAULT_KNEE_THRESHOLDS,
): readonly {
  readonly observedMax: number;
  readonly targetWorkerCount: number;
  readonly predictions: ReturnType<typeof runAllPredictors>;
}[] {
  const steps: {
    observedMax: number;
    targetWorkerCount: number;
    predictions: ReturnType<typeof runAllPredictors>;
  }[] = [];
  for (let index = 0; index < sortedWorkerCounts.length - 1; index += 1) {
    const observedMax = sortedWorkerCounts[index];
    const targetWorkerCount = sortedWorkerCounts[index + 1];
    if (targetWorkerCount === undefined || observedMax === undefined) continue;
    const observedComplete =
      context.metrics.trialResults.filter((trial) => trial.workerCount <= observedMax).length >=
      repetitions * (index + 1);
    if (!observedComplete) continue;
    steps.push({
      observedMax,
      targetWorkerCount,
      predictions: computeStepPredictions(
        context.inputs,
        context.resourcesByWorkerCount,
        sortedWorkerCounts.slice(0, index + 1),
        targetWorkerCount,
        thresholds,
      ),
    });
  }
  return steps;
}

const trialStartedSchema = z.object({
  trialId: z.string().min(1),
  workerCount: z.number().int().positive(),
  repetition: z.number().int().positive(),
});

export interface TrialWindow {
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly startMs: number;
  readonly endMs: number | null;
}

export async function loadTrialWindows(eventsPath: string): Promise<readonly TrialWindow[]> {
  const events = await readEvents(eventsPath);
  const windows = new Map<string, TrialWindow>();
  for (const event of events) {
    if (event.eventType !== "trial_started" && event.eventType !== "trial_finished") continue;
    const data = trialStartedSchema.parse(event.data);
    const existing = windows.get(data.trialId);
    const timestampMs = Date.parse(event.timestamp);
    if (event.eventType === "trial_started") {
      windows.set(data.trialId, {
        trialId: data.trialId,
        workerCount: data.workerCount,
        repetition: data.repetition,
        startMs: timestampMs,
        endMs: null,
      });
    } else if (existing) {
      windows.set(data.trialId, { ...existing, endMs: timestampMs });
    }
  }
  return [...windows.values()].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.workerCount - right.workerCount ||
      left.repetition - right.repetition,
  );
}

const telemetrySampleSchema = z.object({
  timestamp: z.string().min(1),
  elapsedMs: z.number(),
  totalCpuUtilization: z.number().nullable(),
  perCoreCpuUtilization: z.array(z.number().nullable()),
  loadAverage1m: z.number().nullable(),
  totalMemoryBytes: z.number(),
  freeMemoryBytes: z.number(),
  parentRssBytes: z.number(),
  activeAgentWorkers: z.number(),
  eventLoopLagMs: z.number().nullable(),
});

export async function loadTelemetrySamples(
  telemetryPath: string,
): Promise<readonly HostTelemetrySample[]> {
  let content: string;
  try {
    content = await readFile(telemetryPath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => telemetrySampleSchema.parse(JSON.parse(line)) as HostTelemetrySample);
}

/** Assign each telemetry sample to the trial window it falls inside. */
export function samplesInWindow(
  samples: readonly HostTelemetrySample[],
  window: TrialWindow,
): readonly HostTelemetrySample[] {
  return samples.filter((sample) => {
    const ms = Date.parse(sample.timestamp);
    return (
      Number.isFinite(ms) && ms >= window.startMs && (window.endMs === null || ms <= window.endMs)
    );
  });
}

export function telemetryByWorkerCount(
  windows: readonly TrialWindow[],
  samples: readonly HostTelemetrySample[],
): Readonly<Record<number, CapacityResourceAggregate>> {
  const grouped = new Map<number, HostTelemetrySample[]>();
  for (const window of windows) {
    for (const sample of samplesInWindow(samples, window)) {
      const existing = grouped.get(window.workerCount) ?? [];
      existing.push(sample);
      grouped.set(window.workerCount, existing);
    }
  }
  const result: Record<number, CapacityResourceAggregate> = {};
  for (const [workerCount, group] of grouped) {
    const aggregate = aggregateTelemetry(group);
    if (aggregate !== null) result[workerCount] = aggregate;
  }
  return result;
}

export function capacityInputsFromMetrics(
  metrics: ExperimentMetrics,
): readonly CapacityPointInput[] {
  return metrics.workerResults.map((row) => ({
    workerCount: row.workerCount,
    medianTasksPerHour: row.medianAcceptedTasksPerHour,
    minTasksPerHour: row.minAcceptedTasksPerHour,
    maxTasksPerHour: row.maxAcceptedTasksPerHour,
    acceptedTasks: row.acceptedTasks,
    taskRuns: row.taskRuns,
    medianAgentExecutionMs: row.medianAgentExecutionMs,
    validationDurationMs: row.medianValidationMs,
    raptureOverheadMs: row.medianRaptureOverheadMs,
  }));
}

export function restrictInputs(
  inputs: readonly CapacityPointInput[],
  maxWorkerCount: number,
): readonly CapacityPointInput[] {
  return inputs.filter((input) => input.workerCount <= maxWorkerCount);
}

/**
 * Compute the pre-registered prediction set for one step: only measurements
 * up to `observedMaxWorkerCount` are exposed to the predictors.
 */
export function computeStepPredictions(
  inputs: readonly CapacityPointInput[],
  resourcesByWorkerCount: Readonly<Record<number, CapacityResourceAggregate>>,
  observedWorkerCounts: readonly number[],
  targetWorkerCount: number,
  thresholds: KneeDetectorThresholds = DEFAULT_RAPTURE_THRESHOLDS,
) {
  const revealed = restrictInputs(inputs, Math.max(...observedWorkerCounts));
  const curve = buildCapacityCurve(revealed, resourcesByWorkerCount);
  return runAllPredictors({ curveSoFar: curve, targetWorkerCount }, thresholds);
}

export interface CapacityContext {
  readonly experimentId: string;
  readonly directory: string;
  readonly metrics: ExperimentMetrics;
  readonly inputs: readonly CapacityPointInput[];
  readonly resourcesByWorkerCount: Readonly<Record<number, CapacityResourceAggregate>>;
  readonly curve: CapacityCurve;
}

export async function loadCapacityContext(directory: string): Promise<CapacityContext> {
  const resolved = join(directory);
  const manifest = JSON.parse(await readFile(join(resolved, "manifest.json"), "utf8")) as {
    experimentId: string;
  };
  const metricsPath = join(resolved, "events.jsonl");
  const metrics = await deriveMetrics(metricsPath);
  const windows = await loadTrialWindows(metricsPath);
  const samples = await loadTelemetrySamples(join(resolved, "telemetry.jsonl"));
  const resourcesByWorkerCount = telemetryByWorkerCount(windows, samples);
  const inputs = capacityInputsFromMetrics(metrics);
  const curve = buildCapacityCurve(inputs, resourcesByWorkerCount);
  return {
    experimentId: manifest.experimentId,
    directory: resolved,
    metrics,
    inputs,
    resourcesByWorkerCount,
    curve,
  };
}

export function detectKneeForContext(
  context: CapacityContext,
  thresholds: KneeDetectorThresholds = DEFAULT_KNEE_THRESHOLDS,
): KneeDetection {
  return detectCapacityKnee(context.curve, thresholds);
}

export interface StepOutcomeSummary {
  readonly targetWorkerCount: number;
  readonly outcome: ObservedOutcome;
}

export function observeOutcomes(
  context: CapacityContext,
  targetWorkerCounts: readonly number[],
): readonly StepOutcomeSummary[] {
  return targetWorkerCounts.map((targetWorkerCount) => ({
    targetWorkerCount,
    outcome: classifyObservedOutcome(context.curve, targetWorkerCount),
  }));
}

export function evaluateStoredPredictions(
  predictions: readonly {
    predictorId: string;
    targetWorkerCount: number;
    predictedState: string;
  }[],
  outcomes: readonly StepOutcomeSummary[],
): readonly PredictorEvaluation[] {
  const shaped = predictions
    .filter(
      (
        prediction,
      ): prediction is {
        predictorId: PredictorId;
        targetWorkerCount: number;
        predictedState: PredictionState;
      } => {
        const idValid = (ALL_PREDICTORS as readonly string[]).includes(prediction.predictorId);
        const stateValid = [
          "PRODUCTIVE",
          "DIMINISHING_RETURNS",
          "SATURATING",
          "INSUFFICIENT_EVIDENCE",
        ].includes(prediction.predictedState);
        if (!idValid || !stateValid) return false;
        return true;
      },
    )
    .map((prediction) => ({
      predictor: { id: prediction.predictorId, version: "stored" },
      targetWorkerCount: prediction.targetWorkerCount,
      question: "",
      predictedState: prediction.predictedState,
      confidence: "low" as const,
      evidence: {
        observedWorkerCounts: [] as readonly number[],
        marginalThroughputGainFraction: null,
        parallelEfficiency: null,
        agentLatencyInflationVsPrevious: null,
        acceptanceRate: null,
        cpuUtilizationMean: null,
        memoryUsedFractionMean: null,
        notes: [],
      },
    }));
  return evaluatePredictions(
    shaped,
    outcomes.map((summary) => summary.outcome),
  );
}
