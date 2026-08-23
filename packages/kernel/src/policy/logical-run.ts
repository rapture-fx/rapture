import { sha256 } from "../evidence/artifacts.js";

export type LogicalRunState =
  | "pending"
  | "running"
  | "accepted"
  | "rejected"
  | "timed_out"
  | "provider_blocked"
  | "infrastructure_failed"
  | "interrupted";

export interface ExperimentIdentity {
  readonly repositoryFingerprint: string;
  readonly taskSetHash: string;
  readonly workerCounts: readonly number[];
  readonly repetitions: number;
  readonly seed: number;
  readonly agent: string;
  readonly agentModel: string | null;
  readonly agentVersion: string | null;
  readonly integration: boolean;
}

export interface LogicalRunIdentity {
  readonly experimentIdentityHash: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly taskId: string;
  readonly trialSeed: number;
  readonly agent: string;
  readonly agentModel: string | null;
  readonly agentVersion: string | null;
}

export function canonicalExperimentIdentity(identity: ExperimentIdentity): string {
  return sha256(
    JSON.stringify({
      repositoryFingerprint: identity.repositoryFingerprint,
      taskSetHash: identity.taskSetHash,
      workerCounts: identity.workerCounts,
      repetitions: identity.repetitions,
      seed: identity.seed,
      agent: identity.agent,
      agentModel: identity.agentModel,
      agentVersion: identity.agentVersion,
      integration: identity.integration,
    }),
  );
}

export function logicalRunIdFor(identity: LogicalRunIdentity): string {
  return sha256(
    JSON.stringify({
      experiment: identity.experimentIdentityHash,
      workerCount: identity.workerCount,
      repetition: identity.repetition,
      taskId: identity.taskId,
      trialSeed: identity.trialSeed,
      agent: identity.agent,
      agentModel: identity.agentModel,
      agentVersion: identity.agentVersion,
    }),
  );
}

export function isTerminalRunState(state: LogicalRunState): boolean {
  return state === "accepted" || state === "rejected" || state === "timed_out";
}

export function isFinalRunState(state: LogicalRunState): boolean {
  return isTerminalRunState(state);
}

export function isRerunEligibleState(state: LogicalRunState): boolean {
  return state === "provider_blocked" || state === "infrastructure_failed";
}

export function isInterruptedState(state: LogicalRunState): boolean {
  return state === "interrupted";
}
