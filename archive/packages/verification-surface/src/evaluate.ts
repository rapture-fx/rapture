export type Label =
  | "MATERIAL_WEAKENING"
  | "NON_MATERIAL_CHANGE"
  | "NO_VERIFICATION_CHANGE"
  | "UNCLEAR";

export interface Metrics {
  readonly total: number;
  readonly labeledPositive: number;
  readonly detectorPositive: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
  readonly unclear: number;
}

/** Precision/recall are null (not 0) when their denominator is empty. */
export function computeMetrics(
  rows: readonly { label: Label; detected: boolean }[],
): Metrics {
  const scored = rows.filter((r) => r.label !== "UNCLEAR");
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of scored) {
    const positive = r.label === "MATERIAL_WEAKENING";
    if (positive && r.detected) tp++;
    else if (!positive && r.detected) fp++;
    else if (positive && !r.detected) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return {
    total: rows.length,
    labeledPositive: scored.filter((r) => r.label === "MATERIAL_WEAKENING").length,
    detectorPositive: scored.filter((r) => r.detected).length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision,
    recall,
    f1,
    unclear: rows.filter((r) => r.label === "UNCLEAR").length,
  };
}
