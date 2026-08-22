import type { CapacityCurve } from "./capacity.js";
import { DEFAULT_KNEE_THRESHOLDS, type KneeDetectorThresholds } from "./knee.js";

/**
 * Capacity prediction.
 *
 * A predictor answers one question: given only measurements available up to
 * worker count P (an information set), will the next tested worker count
 * remain productive or cross into diminishing returns?
 *
 * All predictors are deterministic rules over persisted aggregates. The
 * Rapture predictor additionally uses engineering-outcome signals (accepted
 * throughput, marginal gain, parallel efficiency, agent latency inflation,
 * acceptance behavior); the baselines are intentionally naive on purpose.
 */

export type PredictionState =
  | "PRODUCTIVE"
  | "DIMINISHING_RETURNS"
  | "SATURATING"
  | "INSUFFICIENT_EVIDENCE";

export const PREDICTOR_STATES: readonly PredictionState[] = Object.freeze([
  "PRODUCTIVE",
  "DIMINISHING_RETURNS",
  "SATURATING",
  "INSUFFICIENT_EVIDENCE",
]);

export type PredictorId =
  | "rapture"
  | "fixed-concurrency"
  | "cpu-only"
  | "memory-only"
  | "cpu-memory";

export interface PredictorConfig {
  readonly id: PredictorId;
  readonly version: string;
}

export interface ResourcePressure {
  readonly cpuUtilizationMean: number | null;
  readonly memoryUsedFractionMean: number | null;
}

export const BASELINE_CPU_SATURATION_FRACTION = 0.85;
export const BASELINE_MEMORY_PRESSURE_FRACTION = 0.95;

export interface PredictionInput {
  /** Curve restricted to the observed (revealed) worker counts. */
  readonly curveSoFar: CapacityCurve;
  /** The next worker count whose outcome is still hidden. */
  readonly targetWorkerCount: number;
}

export interface PredictionEvidence {
  readonly observedWorkerCounts: readonly number[];
  readonly marginalThroughputGainFraction: number | null;
  readonly parallelEfficiency: number | null;
  readonly agentLatencyInflationVsPrevious: number | null;
  readonly acceptanceRate: number | null;
  readonly cpuUtilizationMean: number | null;
  readonly memoryUsedFractionMean: number | null;
  readonly notes: readonly string[];
}

export interface CapacityPrediction {
  readonly predictor: PredictorConfig;
  readonly targetWorkerCount: number;
  readonly question: string;
  readonly predictedState: PredictionState;
  readonly confidence: "low" | "medium" | "high";
  readonly evidence: PredictionEvidence;
}

function evidenceOf(input: PredictionInput, notes: readonly string[]): PredictionEvidence {
  const points = input.curveSoFar.points;
  const last = points[points.length - 1];
  return {
    observedWorkerCounts: points.map((point) => point.workerCount),
    marginalThroughputGainFraction:
      input.curveSoFar.adjacentSteps[input.curveSoFar.adjacentSteps.length - 1]
        ?.marginalThroughputGainFraction ?? null,
    parallelEfficiency: last?.parallelEfficiency ?? null,
    agentLatencyInflationVsPrevious: last?.agentLatencyInflationVsPrevious ?? null,
    acceptanceRate: last?.acceptanceRate ?? null,
    cpuUtilizationMean: last?.resources?.cpuUtilizationMean ?? null,
    memoryUsedFractionMean: last?.resources?.memoryUsedFractionMean ?? null,
    notes,
  };
}

const QUESTION_PRODUCTIVE =
  "will the next tested worker count deliver useful positive marginal accepted throughput";
const QUESTION_REGION =
  "will the next tested worker count remain in the efficient/productive region";

function lastResourcePressure(curve: CapacityCurve): ResourcePressure {
  const last = curve.points[curve.points.length - 1];
  return {
    cpuUtilizationMean: last?.resources?.cpuUtilizationMean ?? null,
    memoryUsedFractionMean: last?.resources?.memoryUsedFractionMean ?? null,
  };
}

/**
 * Baseline that always assumes more workers are better until the maximum
 * configured concurrency. It never inspects any measurement.
 */
export function fixedConcurrencyBaseline(input: PredictionInput): CapacityPrediction {
  return {
    predictor: { id: "fixed-concurrency", version: "1" },
    targetWorkerCount: input.targetWorkerCount,
    question: QUESTION_PRODUCTIVE,
    predictedState: "PRODUCTIVE",
    confidence: "low",
    evidence: evidenceOf(input, [
      "assumes more workers are always better; ignores all measurements",
    ]),
  };
}

function resourcePrediction(
  id: PredictorId,
  version: string,
  input: PredictionInput,
  saturated: boolean,
  reason: string,
): CapacityPrediction {
  if (!saturated) {
    return {
      predictor: { id, version },
      targetWorkerCount: input.targetWorkerCount,
      question: QUESTION_PRODUCTIVE,
      predictedState: "PRODUCTIVE",
      confidence: "medium",
      evidence: evidenceOf(input, [reason]),
    };
  }
  const pressure = lastResourcePressure(input.curveSoFar);
  const bothSaturated =
    (pressure.cpuUtilizationMean ?? 0) >= BASELINE_CPU_SATURATION_FRACTION &&
    (pressure.memoryUsedFractionMean ?? 0) >= BASELINE_MEMORY_PRESSURE_FRACTION;
  return {
    predictor: { id, version },
    targetWorkerCount: input.targetWorkerCount,
    question: QUESTION_PRODUCTIVE,
    predictedState: bothSaturated && id === "cpu-memory" ? "DIMINISHING_RETURNS" : "SATURATING",
    confidence: "medium",
    evidence: evidenceOf(input, [reason]),
  };
}

/** Predict saturation from CPU pressure only. */
export function cpuOnlyBaseline(
  input: PredictionInput,
  thresholds: {
    readonly cpuSaturationFraction?: number;
  } = {},
): CapacityPrediction {
  const threshold = thresholds.cpuSaturationFraction ?? BASELINE_CPU_SATURATION_FRACTION;
  const pressure = lastResourcePressure(input.curveSoFar);
  const saturated =
    pressure.cpuUtilizationMean !== null && pressure.cpuUtilizationMean >= threshold;
  return resourcePrediction(
    "cpu-only",
    "1",
    input,
    saturated,
    `CPU mean ${(pressure.cpuUtilizationMean ?? 0).toFixed(3)} vs threshold ${threshold}`,
  );
}

/** Predict saturation from memory pressure only. */
export function memoryOnlyBaseline(
  input: PredictionInput,
  thresholds: {
    readonly memoryPressureFraction?: number;
  } = {},
): CapacityPrediction {
  const threshold = thresholds.memoryPressureFraction ?? BASELINE_MEMORY_PRESSURE_FRACTION;
  const pressure = lastResourcePressure(input.curveSoFar);
  const saturated =
    pressure.memoryUsedFractionMean !== null && pressure.memoryUsedFractionMean >= threshold;
  return resourcePrediction(
    "memory-only",
    "1",
    input,
    saturated,
    `memory used fraction ${(pressure.memoryUsedFractionMean ?? 0).toFixed(3)} vs threshold ${threshold}`,
  );
}

/** CPU plus memory thresholds without throughput or agent-latency information. */
export function simpleResourceBaseline(
  input: PredictionInput,
  thresholds: {
    readonly cpuSaturationFraction?: number;
    readonly memoryPressureFraction?: number;
  } = {},
): CapacityPrediction {
  const cpuThreshold = thresholds.cpuSaturationFraction ?? BASELINE_CPU_SATURATION_FRACTION;
  const memoryThreshold = thresholds.memoryPressureFraction ?? BASELINE_MEMORY_PRESSURE_FRACTION;
  const pressure = lastResourcePressure(input.curveSoFar);
  const cpuSaturated =
    pressure.cpuUtilizationMean !== null && pressure.cpuUtilizationMean >= cpuThreshold;
  const memoryPressured =
    pressure.memoryUsedFractionMean !== null && pressure.memoryUsedFractionMean >= memoryThreshold;
  return resourcePrediction(
    "cpu-memory",
    "1",
    input,
    cpuSaturated || memoryPressured,
    `CPU mean ${(pressure.cpuUtilizationMean ?? 0).toFixed(3)} vs ${cpuThreshold}; memory used ${(pressure.memoryUsedFractionMean ?? 0).toFixed(3)} vs ${memoryThreshold}`,
  );
}

export interface RapturePredictorThresholds extends KneeDetectorThresholds {}

export const DEFAULT_RAPTURE_THRESHOLDS: RapturePredictorThresholds = DEFAULT_KNEE_THRESHOLDS;

/**
 * The Rapture predictor: engineering-outcome-aware capacity prediction.
 *
 * Transparent rule over the revealed curve:
 * - With no adjacent step yet (only N=1 observed), fall back to acceptance and
 *   absolute-efficiency checks at low confidence; there is no marginal signal
 *   to reason about yet.
 * - Otherwise classify the next step using the most recent adjacent step:
 *   non-positive or low marginal gain together with efficiency collapse or
 *   latency inflation predicts DIMINISHING_RETURNS; low gain or joint
 *   CPU+memory saturation alone predicts SATURATING; otherwise PRODUCTIVE.
 */
export function rapturePredictor(
  input: PredictionInput,
  thresholds: RapturePredictorThresholds = DEFAULT_RAPTURE_THRESHOLDS,
): CapacityPrediction {
  const steps = input.curveSoFar.adjacentSteps;
  const lastStep = steps[steps.length - 1];
  const lastPoint = input.curveSoFar.points[input.curveSoFar.points.length - 1];

  if (lastStep === undefined || lastPoint === undefined) {
    const degraded =
      lastPoint !== undefined &&
      lastPoint.acceptanceRate !== null &&
      lastPoint.acceptanceRate < 1 - thresholds.acceptanceDropThreshold;
    return {
      predictor: { id: "rapture", version: "1" },
      targetWorkerCount: input.targetWorkerCount,
      question: QUESTION_PRODUCTIVE,
      predictedState: degraded ? "DIMINISHING_RETURNS" : "PRODUCTIVE",
      confidence: "low",
      evidence: evidenceOf(input, [
        "single observed worker count: no marginal throughput signal is available yet",
      ]),
    };
  }

  const gainFraction = lastStep.marginalThroughputGainFraction;
  const lowMarginalGain =
    gainFraction !== null && gainFraction <= thresholds.lowMarginalGainFraction;
  const negativeGain = gainFraction !== null && gainFraction <= 0;
  const efficiencyCollapse =
    lastPoint.parallelEfficiency !== null &&
    lastPoint.parallelEfficiency <= thresholds.parallelEfficiencyFloor;
  const latencyInflation =
    lastStep.agentLatencyInflation !== null &&
    lastStep.agentLatencyInflation >= thresholds.agentLatencyInflationThreshold;
  const cpuSaturated =
    lastPoint.resources?.cpuUtilizationMean !== undefined &&
    lastPoint.resources.cpuUtilizationMean !== null &&
    lastPoint.resources.cpuUtilizationMean >= thresholds.cpuSaturationFraction;
  const memoryPressured =
    lastPoint.resources?.memoryUsedFractionMean !== undefined &&
    lastPoint.resources.memoryUsedFractionMean !== null &&
    lastPoint.resources.memoryUsedFractionMean >= thresholds.memoryPressureFraction;
  const notes: string[] = [];
  let state: PredictionState;
  if (negativeGain || (lowMarginalGain && (efficiencyCollapse || latencyInflation))) {
    state = "DIMINISHING_RETURNS";
  } else if (lowMarginalGain || (cpuSaturated && memoryPressured)) {
    state = "SATURATING";
  } else {
    state = "PRODUCTIVE";
  }

  if (negativeGain) notes.push("non-positive marginal accepted throughput");
  if (lowMarginalGain)
    notes.push(
      `marginal gain fraction below ${(thresholds.lowMarginalGainFraction * 100).toFixed(1)}%`,
    );
  if (efficiencyCollapse)
    notes.push(
      `parallel efficiency E=${lastPoint.parallelEfficiency?.toFixed(3)} at or below floor`,
    );
  if (latencyInflation) notes.push("agent latency inflated vs previous worker count");
  if (state === "PRODUCTIVE")
    notes.push("marginal accepted throughput remains above threshold without collapse signals");

  const agreement =
    Number(lowMarginalGain || negativeGain) +
    Number(efficiencyCollapse) +
    Number(latencyInflation) +
    Number(cpuSaturated) +
    Number(memoryPressured);
  const confidence = agreement >= 3 ? "high" : agreement >= 1 ? "medium" : "low";

  return {
    predictor: { id: "rapture", version: "1" },
    targetWorkerCount: input.targetWorkerCount,
    question: input.targetWorkerCount >= 3 ? QUESTION_REGION : QUESTION_PRODUCTIVE,
    predictedState: state,
    confidence,
    evidence: evidenceOf(input, notes),
  };
}

export const ALL_PREDICTORS: readonly PredictorId[] = Object.freeze([
  "fixed-concurrency",
  "cpu-only",
  "memory-only",
  "cpu-memory",
  "rapture",
]);

export function runAllPredictors(
  input: PredictionInput,
  raptureThresholds: RapturePredictorThresholds = DEFAULT_RAPTURE_THRESHOLDS,
): readonly CapacityPrediction[] {
  return [
    fixedConcurrencyBaseline(input),
    cpuOnlyBaseline(input),
    memoryOnlyBaseline(input),
    simpleResourceBaseline(input),
    rapturePredictor(input, raptureThresholds),
  ];
}

// ---------------------------------------------------------------------------
// Observed outcomes and evaluation
// ---------------------------------------------------------------------------

/** Fraction of previous throughput considered a useful positive marginal gain. */
export const OBSERVED_PRODUCTIVE_GAIN_FRACTION = 0.15;

export interface ObservedOutcome {
  readonly targetWorkerCount: number;
  readonly previousWorkerCount: number;
  readonly medianTasksPerHourPrevious: number | null;
  readonly medianTasksPerHourTarget: number | null;
  readonly marginalThroughputGain: number | null;
  readonly marginalThroughputGainFraction: number | null;
  readonly agentLatencyInflation: number | null;
  /** productive: useful positive gain; weak-marginal: positive but small; non-positive. */
  readonly outcomeClass: "productive" | "weak-marginal" | "non-positive" | "unresolved";
}

export function classifyObservedOutcome(
  curve: CapacityCurve,
  targetWorkerCount: number,
): ObservedOutcome {
  const index = curve.points.findIndex((point) => point.workerCount === targetWorkerCount);
  const target = curve.points[index];
  const previous = index > 0 ? curve.points[index - 1] : undefined;
  const step = curve.adjacentSteps.find((item) => item.toWorkerCount === targetWorkerCount);
  const fraction = step?.marginalThroughputGainFraction ?? null;
  const outcomeClass: ObservedOutcome["outcomeClass"] =
    target === undefined || previous === undefined || fraction === null
      ? "unresolved"
      : fraction > OBSERVED_PRODUCTIVE_GAIN_FRACTION
        ? "productive"
        : fraction > 0
          ? "weak-marginal"
          : "non-positive";
  return {
    targetWorkerCount,
    previousWorkerCount: previous?.workerCount ?? Number.NaN,
    medianTasksPerHourPrevious: previous?.medianTasksPerHour ?? null,
    medianTasksPerHourTarget: target?.medianTasksPerHour ?? null,
    marginalThroughputGain: step?.marginalThroughputGain ?? null,
    marginalThroughputGainFraction: fraction,
    agentLatencyInflation: step?.agentLatencyInflation ?? null,
    outcomeClass,
  };
}

export function isDiminishingOutcome(outcome: ObservedOutcome): boolean | null {
  if (outcome.outcomeClass === "unresolved") return null;
  return outcome.outcomeClass !== "productive";
}

export interface PredictorEvaluation {
  readonly predictorId: PredictorId;
  readonly steps: readonly {
    readonly targetWorkerCount: number;
    readonly predictedState: PredictionState;
    readonly outcomeClass: ObservedOutcome["outcomeClass"];
    readonly correct: boolean | null;
  }[];
  readonly evaluableSteps: number;
  readonly correctSteps: number;
  /** Descriptive agreement fraction only; not statistical significance. */
  readonly agreementFraction: number | null;
}

/**
 * Compare persisted predictions with observed held-out outcomes.
 *
 * PRODUCTIVE is correct when the observed step was productive; DIMINISHING_
 * RETURNS and SATURATING are correct when it was not; INSUFFICIENT_EVIDENCE is
 * never scored as correct or incorrect.
 */
export function evaluatePredictions(
  predictions: readonly CapacityPrediction[],
  outcomes: readonly ObservedOutcome[],
): readonly PredictorEvaluation[] {
  const byPredictor = new Map<PredictorId, CapacityPrediction[]>();
  for (const prediction of predictions) {
    const existing = byPredictor.get(prediction.predictor.id) ?? [];
    existing.push(prediction);
    byPredictor.set(prediction.predictor.id, existing);
  }
  const evaluations: PredictorEvaluation[] = [];
  for (const [predictorId, group] of byPredictor) {
    const sorted = [...group].sort((a, b) => a.targetWorkerCount - b.targetWorkerCount);
    const steps = sorted.map((prediction) => {
      const outcome = outcomes.find(
        (item) => item.targetWorkerCount === prediction.targetWorkerCount,
      );
      if (outcome === undefined) {
        return {
          targetWorkerCount: prediction.targetWorkerCount,
          predictedState: prediction.predictedState,
          outcomeClass: "unresolved" as const,
          correct: null,
        };
      }
      const diminishing = isDiminishingOutcome(outcome);
      const correct =
        diminishing === null || prediction.predictedState === "INSUFFICIENT_EVIDENCE"
          ? null
          : prediction.predictedState === "PRODUCTIVE"
            ? diminishing === false
            : diminishing === true;
      return {
        targetWorkerCount: prediction.targetWorkerCount,
        predictedState: prediction.predictedState,
        outcomeClass: outcome.outcomeClass,
        correct,
      };
    });
    const scored = steps.filter((step) => step.correct !== null);
    const correctSteps = scored.filter((step) => step.correct === true).length;
    evaluations.push({
      predictorId,
      steps,
      evaluableSteps: scored.length,
      correctSteps,
      agreementFraction: scored.length > 0 ? correctSteps / scored.length : null,
    });
  }
  return evaluations.sort(
    (a, b) => ALL_PREDICTORS.indexOf(a.predictorId) - ALL_PREDICTORS.indexOf(b.predictorId),
  );
}
