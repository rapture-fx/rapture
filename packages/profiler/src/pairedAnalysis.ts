import type { RunTrace } from "./schema.js";

export interface PairedRun {
  readonly taskId: string;
  readonly repetition: number;
  readonly control: RunTrace | null;
  readonly treatment: RunTrace | null;
}

export interface PairedDelta {
  readonly taskId: string;
  readonly repetition: number;
  readonly controlRunId: string | null;
  readonly treatmentRunId: string | null;
  readonly successControl: boolean | null;
  readonly successTreatment: boolean | null;
  readonly durationControl: number | null;
  readonly durationTreatment: number | null;
  readonly durationDeltaMs: number | null;
  readonly durationDeltaPct: number | null;
  readonly inputControl: number | null;
  readonly inputTreatment: number | null;
  readonly cachedControl: number | null;
  readonly cachedTreatment: number | null;
  readonly uncachedControl: number | null;
  readonly uncachedTreatment: number | null;
  readonly uncachedDelta: number | null;
  readonly uncachedDeltaPct: number | null;
  readonly totalOpsControl: number | null;
  readonly totalOpsTreatment: number | null;
  readonly opsDelta: number | null;
  readonly opsDeltaPct: number | null;
  readonly fileReadsControl: number | null;
  readonly fileReadsTreatment: number | null;
  readonly fileReadsDelta: number | null;
  readonly uniqueContentControl: number | null;
  readonly uniqueContentTreatment: number | null;
  readonly searchesControl: number | null;
  readonly searchesTreatment: number | null;
}

export function computeUncached(input: number | null, cached: number | null): number | null {
  if (input === null || input === undefined) return null;
  if (cached === null || cached === undefined) return input;
  return input - cached;
}

export function deltaPct(control: number | null, treatment: number | null): number | null {
  if (control === null || control === 0 || treatment === null) return null;
  return ((treatment - control) / control) * 100;
}

export function pairedDeltas(pairs: readonly PairedRun[]): readonly PairedDelta[] {
  return pairs.map((pair) => {
    const c = pair.control;
    const t = pair.treatment;
    const inputC = c?.metadata.tokenUsage?.input ?? null;
    const inputT = t?.metadata.tokenUsage?.input ?? null;
    const cachedC = c?.metadata.tokenUsage?.cacheRead ?? null;
    const cachedT = t?.metadata.tokenUsage?.cacheRead ?? null;
    const uncachedC = computeUncached(inputC, cachedC);
    const uncachedT = computeUncached(inputT, cachedT);
    const opsC = c ? c.operations.length : null;
    const opsT = t ? t.operations.length : null;
    const fileC = c ? c.operations.filter((o) => o.opClass === "file_read").length : null;
    const fileT = t ? t.operations.filter((o) => o.opClass === "file_read").length : null;
    const uniqueC = c ? new Set(c.operations.filter((o) => o.opClass === "file_read").map((o) => o.identityKey)).size : null;
    const uniqueT = t ? new Set(t.operations.filter((o) => o.opClass === "file_read").map((o) => o.identityKey)).size : null;
    const searchC = c ? c.operations.filter((o) => o.opClass === "search").length : null;
    const searchT = t ? t.operations.filter((o) => o.opClass === "search").length : null;
    return {
      taskId: pair.taskId,
      repetition: pair.repetition,
      controlRunId: c?.metadata.runId ?? null,
      treatmentRunId: t?.metadata.runId ?? null,
      successControl: c ? c.metadata.status === "completed" && c.metadata.exitCode === 0 : null,
      successTreatment: t ? t.metadata.status === "completed" && t.metadata.exitCode === 0 : null,
      durationControl: c?.metadata.durationMs ?? null,
      durationTreatment: t?.metadata.durationMs ?? null,
      durationDeltaMs: c?.metadata.durationMs != null && t?.metadata.durationMs != null ? (t?.metadata.durationMs ?? 0) - (c?.metadata.durationMs ?? 0) : null,
      durationDeltaPct: deltaPct(c?.metadata.durationMs ?? null, t?.metadata.durationMs ?? null),
      inputControl: inputC,
      inputTreatment: inputT,
      cachedControl: cachedC,
      cachedTreatment: cachedT,
      uncachedControl: uncachedC,
      uncachedTreatment: uncachedT,
      uncachedDelta: uncachedC !== null && uncachedT !== null ? uncachedT - uncachedC : null,
      uncachedDeltaPct: deltaPct(uncachedC, uncachedT),
      totalOpsControl: opsC,
      totalOpsTreatment: opsT,
      opsDelta: opsC !== null && opsT !== null ? opsT - opsC : null,
      opsDeltaPct: deltaPct(opsC, opsT),
      fileReadsControl: fileC,
      fileReadsTreatment: fileT,
      fileReadsDelta: fileC !== null && fileT !== null ? fileT - fileC : null,
      uniqueContentControl: uniqueC,
      uniqueContentTreatment: uniqueT,
      searchesControl: searchC,
      searchesTreatment: searchT,
    };
  });
}

export interface AggregatePaired {
  readonly medianFileReadsDeltaPct: number | null;
  readonly medianOpsDeltaPct: number | null;
  readonly medianUncachedDeltaPct: number | null;
  readonly medianDurationDeltaPct: number | null;
  readonly meanFileReadsDeltaPct: number | null;
  readonly successControlRate: number | null;
  readonly successTreatmentRate: number | null;
}

export function aggregatePaired(deltas: readonly PairedDelta[]): AggregatePaired {
  function median(values: (number | null)[]): number | null {
    const vals = values.filter((v): v is number => v !== null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (vals.length === 0) return null;
    const mid = Math.floor(vals.length / 2);
    if (vals.length % 2 === 1) return vals[mid] ?? null;
    return ((vals[mid - 1] ?? 0) + (vals[mid] ?? 0)) / 2;
  }
  function mean(values: (number | null)[]): number | null {
    const vals = values.filter((v): v is number => v !== null && !Number.isNaN(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const filePct = deltas.map((d) => (d.fileReadsControl !== null && d.fileReadsControl !== 0 && d.fileReadsDelta !== null ? (d.fileReadsDelta / d.fileReadsControl) * 100 : null));
  const opsPct = deltas.map((d) => d.opsDeltaPct);
  const uncachedPct = deltas.map((d) => d.uncachedDeltaPct);
  const durPct = deltas.map((d) => d.durationDeltaPct);
  const successC = deltas.filter((d) => d.successControl !== null).map((d) => (d.successControl ? 1 : 0));
  const successT = deltas.filter((d) => d.successTreatment !== null).map((d) => (d.successTreatment ? 1 : 0));
  return {
    medianFileReadsDeltaPct: median(filePct),
    medianOpsDeltaPct: median(opsPct),
    medianUncachedDeltaPct: median(uncachedPct),
    medianDurationDeltaPct: median(durPct),
    meanFileReadsDeltaPct: mean(filePct),
    successControlRate: successC.length ? (successC as number[]).reduce((a: number, b: number) => a + b, 0) / successC.length : null,
    successTreatmentRate: successT.length ? (successT as number[]).reduce((a: number, b: number) => a + b, 0) / successT.length : null,
  };
}
