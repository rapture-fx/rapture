import type { ProductionChange } from "./schema/production-change.js";

// Provider-independent consumer functions for primary queries
// They must not branch on provider name

export function currentVersion(pc: ProductionChange | null): string | null {
  if (!pc) return null;
  return pc.source.commitSha ?? pc.artifact.digest ?? null;
}

export function previousVersion(pc: ProductionChange | null): string | null {
  if (!pc) return null;
  return pc.transition.previousCommitSha ?? null;
}

export function artifactForChange(pc: ProductionChange | null): string | null {
  if (!pc) return null;
  return pc.artifact.digest ?? pc.artifact.externalId ?? null;
}

export function timeRangeChanges(
  changes: readonly ProductionChange[],
  since: string,
  until: string,
): readonly ProductionChange[] {
  return changes.filter((pc) => {
    const t = pc.deployment.completedAt ?? "";
    return t >= since && t <= until;
  });
}

export function observationsForChange(
  pc: ProductionChange | null,
): ProductionChange["runtimeObservations"] {
  if (!pc) return [];
  return pc.runtimeObservations;
}
