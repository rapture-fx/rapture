import { microUsd } from "../src/domain/money.js";

export type ExperimentDecision =
  | "MECHANIC_PASS"
  | "NO_ROUTING_VALUE"
  | "ABSTRACTION_FAIL"
  | "MECHANIC_FAIL"
  | "BLOCKED_LIVE_EVAL";

export type ConditionId =
  | "FIXED_PROVIDER_A"
  | "FIXED_PROVIDER_B"
  | "FIXED_PROVIDER_C"
  | "OPERATION_ROUTER";

export interface ConditionMetrics {
  readonly condition: ConditionId;
  readonly totalSpendMicroUsd: string;
  readonly requests: number;
  readonly highConfidenceDecisiveOutcomes: number;
  readonly controlledAccuracyBasisPoints: number;
  readonly fallbackSpendMicroUsd: string;
}

export interface EvaluationSummary {
  readonly live: boolean;
  readonly mappingCoverageBasisPoints: number;
  readonly callerLeakageBasisPoints: number;
  readonly meaningfulProviderHeterogeneity: boolean;
  readonly oneProviderDominates: boolean;
  readonly fallbackCostsEraseAdvantage: boolean;
  readonly superiorQualityNearEqualCost: boolean;
  readonly conditions: readonly ConditionMetrics[];
}

const ratioLessThan = (
  leftCost: bigint,
  leftCount: number,
  rightCost: bigint,
  rightCount: number,
): boolean => leftCost * BigInt(rightCount) < rightCost * BigInt(leftCount);

const bestFixed = (
  conditions: readonly ConditionMetrics[],
): ConditionMetrics | undefined =>
  conditions
    .filter(
      (item) =>
        item.condition !== "OPERATION_ROUTER" &&
        item.highConfidenceDecisiveOutcomes > 0,
    )
    .reduce<ConditionMetrics | undefined>((best, item) => {
      if (best === undefined) return item;
      return ratioLessThan(
        microUsd(item.totalSpendMicroUsd),
        item.highConfidenceDecisiveOutcomes,
        microUsd(best.totalSpendMicroUsd),
        best.highConfidenceDecisiveOutcomes,
      )
        ? item
        : best;
    }, undefined);

export const scoreExperiment = (
  summary: EvaluationSummary,
): ExperimentDecision => {
  if (!summary.live) return "BLOCKED_LIVE_EVAL";
  if (
    summary.mappingCoverageBasisPoints < 9_500 ||
    summary.callerLeakageBasisPoints > 500
  )
    return "ABSTRACTION_FAIL";

  const router = summary.conditions.find(
    (item) => item.condition === "OPERATION_ROUTER",
  );
  const fixed = bestFixed(summary.conditions);
  if (
    router === undefined ||
    fixed === undefined ||
    router.highConfidenceDecisiveOutcomes === 0
  )
    return "MECHANIC_FAIL";

  const strongestAccuracy = Math.max(
    ...summary.conditions
      .filter((item) => item.condition !== "OPERATION_ROUTER")
      .map((item) => item.controlledAccuracyBasisPoints),
  );
  const accuracyAcceptable =
    router.controlledAccuracyBasisPoints >= strongestAccuracy - 200;
  const costImprovementAtLeast20Percent =
    microUsd(router.totalSpendMicroUsd) *
      BigInt(fixed.highConfidenceDecisiveOutcomes) *
      100n <=
    microUsd(fixed.totalSpendMicroUsd) *
      BigInt(router.highConfidenceDecisiveOutcomes) *
      80n;

  if (
    accuracyAcceptable &&
    summary.meaningfulProviderHeterogeneity &&
    (costImprovementAtLeast20Percent || summary.superiorQualityNearEqualCost)
  )
    return "MECHANIC_PASS";
  if (summary.oneProviderDominates || summary.fallbackCostsEraseAdvantage)
    return "NO_ROUTING_VALUE";
  return "MECHANIC_FAIL";
};
