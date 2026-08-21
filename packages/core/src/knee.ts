import type { CapacityCurve } from "./capacity.js";

/**
 * Deterministic capacity-knee detector.
 *
 * The detector consumes persisted aggregate measurements (a CapacityCurve) and
 * applies explicit, named thresholds. It never sees live state, never learns,
 * and always preserves individual signal evidence even when signals disagree.
 *
 * capacity_knee: the first tested concurrency level after which additional
 * workers produce materially diminishing marginal accepted throughput relative
 * to resource and latency cost.
 */

export interface KneeDetectorThresholds {
  /**
   * A step is low-yield when marginal throughput gain is a smaller fraction of
   * the previous level's throughput than this threshold.
   */
  readonly lowMarginalGainFraction: number;
  /** Parallel efficiency at or below this value counts as collapsed. */
  readonly parallelEfficiencyFloor: number;
  /** Agent latency inflation versus the previous worker count above which latency pressure counts. */
  readonly agentLatencyInflationThreshold: number;
  /** Mean host CPU utilization fraction at or above which CPU counts as saturated. */
  readonly cpuSaturationFraction: number;
  /** Mean used-memory fraction at or above which memory counts as under pressure. */
  readonly memoryPressureFraction: number;
  /** Acceptance-rate drop versus the previous worker count that counts as degradation. */
  readonly acceptanceDropThreshold: number;
}

export const DEFAULT_KNEE_THRESHOLDS: KneeDetectorThresholds = Object.freeze({
  lowMarginalGainFraction: 0.15,
  parallelEfficiencyFloor: 0.6,
  agentLatencyInflationThreshold: 1.25,
  cpuSaturationFraction: 0.9,
  memoryPressureFraction: 0.9,
  acceptanceDropThreshold: 0.05,
});

export type KneeConfidence = "low" | "medium" | "high";

export type KneeDetectionStatus =
  | "KNEE_DETECTED"
  | "NO_KNEE_IN_MEASURED_RANGE"
  | "INSUFFICIENT_EVIDENCE";

export interface KneeStepSignals {
  readonly workerCount: number;
  readonly previousWorkerCount: number;
  readonly marginalThroughputGainFraction: number | null;
  readonly parallelEfficiency: number | null;
  readonly agentLatencyInflationVsPrevious: number | null;
  readonly cpuUtilizationMean: number | null;
  readonly memoryUsedFractionMean: number | null;
  readonly acceptanceRate: number | null;
  readonly previousAcceptanceRate: number | null;
  readonly signals: {
    readonly lowMarginalGain: boolean | null;
    readonly efficiencyCollapse: boolean | null;
    readonly agentLatencyInflation: boolean | null;
    readonly cpuSaturation: boolean | null;
    readonly memoryPressure: boolean | null;
    readonly acceptanceDegradation: boolean | null;
  };
}

export interface KneeDetection {
  readonly status: KneeDetectionStatus;
  readonly candidateKnee: number | null;
  readonly confidence: KneeConfidence;
  readonly thresholds: KneeDetectorThresholds;
  readonly reasons: readonly string[];
  readonly steps: readonly KneeStepSignals[];
}

function evaluateSignal(
  value: number | null,
  predicate: (value: number) => boolean,
): boolean | null {
  return value === null ? null : predicate(value);
}

function evaluateStepSignals(
  curve: CapacityCurve,
  thresholds: KneeDetectorThresholds,
): KneeStepSignals[] {
  const steps: KneeStepSignals[] = [];
  for (const step of curve.adjacentSteps) {
    const to = curve.points.find((point) => point.workerCount === step.toWorkerCount);
    const from = curve.points.find((point) => point.workerCount === step.fromWorkerCount);
    if (to === undefined || from === undefined) continue;
    const marginalFraction = step.marginalThroughputGainFraction;
    steps.push({
      workerCount: to.workerCount,
      previousWorkerCount: from.workerCount,
      marginalThroughputGainFraction: marginalFraction,
      parallelEfficiency: to.parallelEfficiency,
      agentLatencyInflationVsPrevious: step.agentLatencyInflation,
      cpuUtilizationMean: to.resources?.cpuUtilizationMean ?? null,
      memoryUsedFractionMean: to.resources?.memoryUsedFractionMean ?? null,
      acceptanceRate: to.acceptanceRate,
      previousAcceptanceRate: from.acceptanceRate,
      signals: {
        lowMarginalGain:
          marginalFraction === null ? null : marginalFraction <= thresholds.lowMarginalGainFraction,
        efficiencyCollapse:
          to.parallelEfficiency === null
            ? null
            : to.parallelEfficiency <= thresholds.parallelEfficiencyFloor,
        agentLatencyInflation: evaluateSignal(
          step.agentLatencyInflation,
          (value) => value >= thresholds.agentLatencyInflationThreshold,
        ),
        cpuSaturation: evaluateSignal(
          to.resources?.cpuUtilizationMean ?? null,
          (value) => value >= thresholds.cpuSaturationFraction,
        ),
        memoryPressure: evaluateSignal(
          to.resources?.memoryUsedFractionMean ?? null,
          (value) => value >= thresholds.memoryPressureFraction,
        ),
        acceptanceDegradation:
          to.acceptanceRate === null || from.acceptanceRate === null
            ? null
            : from.acceptanceRate - to.acceptanceRate > thresholds.acceptanceDropThreshold,
      },
    });
  }
  return steps;
}

/**
 * Detect the candidate knee from a fully or partially observed curve.
 *
 * Rule: the candidate knee is the smallest tested worker count K (with an
 * observed successor) such that every observed step after K shows materially
 * diminishing marginal accepted throughput (lowMarginalGain), and at least one
 * cost signal (latency inflation, CPU saturation, memory pressure, efficiency
 * collapse) supports it. Signals are evaluated independently; conflicting
 * evidence is preserved rather than resolved.
 */
export function detectCapacityKnee(
  curve: CapacityCurve,
  thresholds: KneeDetectorThresholds = DEFAULT_KNEE_THRESHOLDS,
): KneeDetection {
  if (curve.points.length < 2 || curve.adjacentSteps.length < 1) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      candidateKnee: null,
      confidence: "low",
      thresholds,
      reasons: [
        `need at least two tested worker counts and one adjacent step; observed ${curve.points.length} point(s)`,
      ],
      steps: [],
    };
  }

  const steps = evaluateStepSignals(curve, thresholds);
  const reasons: string[] = [];

  let candidateKnee: number | null = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step === undefined) continue;
    const subsequent = steps.slice(index);
    const allDiminishing = subsequent.every((item) => item.signals.lowMarginalGain === true);
    if (!allDiminishing) continue;
    const support = subsequent.some(
      (item) =>
        item.signals.efficiencyCollapse === true ||
        item.signals.agentLatencyInflation === true ||
        item.signals.cpuSaturation === true ||
        item.signals.memoryPressure === true,
    );
    if (!support) continue;

    candidateKnee = step.previousWorkerCount;
    for (const item of subsequent) {
      const parts: string[] = [];
      if (item.signals.lowMarginalGain === true && item.marginalThroughputGainFraction !== null) {
        parts.push(
          `marginal gain T(${item.workerCount})-T(${item.previousWorkerCount}) = ${(
            item.marginalThroughputGainFraction * 100
          ).toFixed(1)}% <= ${(thresholds.lowMarginalGainFraction * 100).toFixed(1)}%`,
        );
      }
      if (item.signals.efficiencyCollapse === true && item.parallelEfficiency !== null) {
        parts.push(
          `parallel efficiency E(${item.workerCount}) = ${item.parallelEfficiency.toFixed(3)} <= floor ${thresholds.parallelEfficiencyFloor}`,
        );
      }
      if (
        item.signals.agentLatencyInflation === true &&
        item.agentLatencyInflationVsPrevious !== null
      ) {
        parts.push(
          `agent latency inflation vs previous = ${item.agentLatencyInflationVsPrevious.toFixed(3)}x >= ${thresholds.agentLatencyInflationThreshold}x`,
        );
      }
      if (item.signals.cpuSaturation === true && item.cpuUtilizationMean !== null) {
        parts.push(
          `CPU mean ${(item.cpuUtilizationMean * 100).toFixed(1)}% >= ${(thresholds.cpuSaturationFraction * 100).toFixed(0)}%`,
        );
      }
      if (item.signals.memoryPressure === true && item.memoryUsedFractionMean !== null) {
        parts.push(
          `memory used ${(item.memoryUsedFractionMean * 100).toFixed(1)}% >= ${(thresholds.memoryPressureFraction * 100).toFixed(0)}%`,
        );
      }
      if (parts.length > 0) reasons.push(parts.join("; "));
    }
    break;
  }

  if (candidateKnee === null) {
    return {
      status: "NO_KNEE_IN_MEASURED_RANGE",
      candidateKnee: null,
      confidence: "low",
      thresholds,
      reasons: [
        "no tested worker count is followed by uniformly diminishing marginal accepted throughput with cost-signal support",
      ],
      steps,
    };
  }

  const kneeIndex = steps.findIndex((step) => step.previousWorkerCount === candidateKnee);
  const supportingSteps = steps.slice(kneeIndex < 0 ? 0 : kneeIndex);
  const fired = supportingSteps.reduce(
    (total, step) => total + Object.values(step.signals).filter((signal) => signal === true).length,
    0,
  );
  const confidence: KneeConfidence = fired >= 4 ? "high" : fired >= 2 ? "medium" : "low";

  return {
    status: "KNEE_DETECTED",
    candidateKnee,
    confidence,
    thresholds,
    reasons,
    steps,
  };
}
