export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface FakeAgentConfig {
  readonly files: Readonly<Record<string, string>>;
  readonly exitCode: number;
  readonly delayMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failOnRepetition?: number;
}

export interface TaskDefinition {
  readonly id: string;
  readonly description: string;
  readonly baseCommit: string;
  readonly validation: readonly string[];
  readonly timeoutSeconds: number;
  readonly independent: boolean;
  readonly dependsOn: readonly string[];
  readonly fake?: FakeAgentConfig;
}

export interface ExperimentBudget {
  readonly maxRunSeconds?: number;
  readonly maxProviderCost?: number;
}

export type ExecutionOrder = "repetition-major" | "worker-major";

export interface ExperimentConfig {
  readonly repository: string;
  readonly taskFile: string;
  readonly tasks: readonly TaskDefinition[];
  readonly workerCounts: readonly number[];
  readonly repetitions: number;
  readonly agent: "fake" | "codex" | "opencode";
  readonly agentModel: string | null;
  readonly outputDirectory: string;
  readonly budget: ExperimentBudget;
  readonly seed: number;
  readonly integration: boolean;
  readonly integrationValidation: readonly string[];
  /**
   * Trial execution order. "worker-major" completes every trial of a worker
   * count before the next worker count starts, which is required for the
   * capacity-prediction chronology (predictions are persisted for the next
   * worker count before any of its trials execute). Defaults to
   * "repetition-major" to preserve historical execution semantics.
   */
  readonly executionOrder?: ExecutionOrder | undefined;
}

export interface ProcessResult {
  readonly command: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export type ValidationResult = "passed" | "failed" | "not_run";
export type IntegrationResult = "passed" | "failed" | "conflict" | "not_requested";
export type RunState = import("./logical-run.js").LogicalRunState;

export interface PhaseTimings {
  readonly worktreeSetupMs: number | null;
  readonly queueWaitMs: number | null;
  readonly agentExecutionMs: number | null;
  readonly validationMs: number | null;
  readonly artifactPersistenceMs: number | null;
  readonly integrationMs: number | null;
  readonly worktreeCleanupMs: number | null;
  readonly otherOrchestrationMs: number | null;
  readonly totalRunMs: number;
}

export interface EngineeringTaskRun {
  readonly runId: string;
  readonly logicalRunId: string;
  readonly attemptId: string;
  readonly runState: RunState;
  readonly experimentId: string;
  readonly trialId: string;
  readonly repetition: number;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly baseCommit: string;
  readonly baseTreeHash: string;
  readonly workerId: string;
  readonly workerCount: number;
  readonly activeAgentsAtStart: number;
  readonly activeAgentsAtEnd: number;
  readonly agentProvider: string;
  readonly agentModel: string | null;
  readonly agentVersion: string | null;
  readonly agentCommand: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly phaseTimings: PhaseTimings;
  readonly processExitCode: number | null;
  readonly timedOut: boolean;
  readonly finalCommit: string | null;
  readonly finalTreeHash: string | null;
  readonly filesChanged: readonly string[];
  readonly commands: readonly (readonly string[])[];
  readonly testInvocations: readonly (readonly string[])[];
  readonly buildInvocations: readonly (readonly string[])[];
  readonly tokenUsage: number | null;
  readonly providerCost: number | null;
  readonly validationResult: ValidationResult;
  readonly integrationResult: IntegrationResult;
  readonly failureClassification: string | null;
  readonly accepted: boolean;
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface ScalingExperiment {
  readonly experimentId: string;
  readonly repositoryFingerprint: string;
  readonly taskSetHash: string;
  readonly workerConfiguration: readonly number[];
  readonly agentConfiguration: Readonly<Record<string, JsonValue>>;
  readonly environmentFingerprint: Readonly<Record<string, JsonValue>>;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly results: readonly EngineeringTaskRun[];
}

export interface TrialMetrics {
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly trialSeed: number | null;
  readonly taskOrder: readonly string[];
  readonly acceptedTasks: number;
  readonly acceptedTasksPerHour: number | null;
  readonly totalWallTimeMs: number | null;
  readonly medianTaskLatencyMs: number | null;
  readonly p95TaskLatencyMs: number | null;
  readonly medianAgentExecutionMs: number | null;
  readonly medianValidationMs: number | null;
  readonly integrationMs: number | null;
  readonly medianRaptureOverheadMs: number | null;
  readonly validationFailures: number;
  readonly integrationFailures: number;
  readonly tokenUsage: number | null;
  readonly providerCost: number | null;
}

export interface WorkerMetrics {
  readonly workerCount: number;
  readonly trialCount: number;
  readonly taskRuns: number;
  readonly acceptedTasks: number;
  readonly acceptedTasksPerHour: number | null;
  readonly acceptedTasksPerHourPerTrial: readonly (number | null)[];
  readonly medianAcceptedTasksPerHour: number | null;
  readonly minAcceptedTasksPerHour: number | null;
  readonly maxAcceptedTasksPerHour: number | null;
  readonly medianTotalTrialWallTimeMs: number | null;
  readonly speedup: number | null;
  readonly parallelEfficiency: number | null;
  readonly pairedSpeedups: readonly (number | null)[];
  readonly pairedParallelEfficiencies: readonly (number | null)[];
  readonly medianDurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly medianAgentExecutionMs: number | null;
  readonly medianValidationMs: number | null;
  readonly medianIntegrationMs: number | null;
  readonly medianRaptureOverheadMs: number | null;
  readonly validationFailures: number;
  readonly integrationFailures: number;
  readonly validationFailureRate: number | null;
  readonly integrationFailureRate: number | null;
  readonly duplicateCommands: number;
  readonly duplicateTestInvocations: number;
  readonly duplicateBuildInvocations: number;
  readonly tokenUsage: number | null;
  readonly providerCost: number | null;
  readonly tokenUsagePerAcceptedTask: number | null;
  readonly providerCostPerAcceptedTask: number | null;
}

export interface ExperimentMetrics {
  readonly schemaVersion: 2;
  readonly workerResults: readonly WorkerMetrics[];
  readonly trialResults: readonly TrialMetrics[];
}

export type MatrixCompletionStatus = "completed" | "blocked" | "interrupted" | "incomplete";

export interface MatrixCompletion {
  readonly schemaVersion: 1;
  readonly expectedLogicalRuns: number;
  readonly completedLogicalRuns: number;
  readonly acceptedRuns: number;
  readonly rejectedRuns: number;
  readonly timedOutRuns: number;
  readonly providerBlockedRuns: number;
  readonly infrastructureFailedRuns: number;
  readonly interruptedRuns: number;
  readonly outstandingRuns: number;
  readonly status: MatrixCompletionStatus;
  readonly completedTrials: number;
  readonly totalTrials: number;
}

export interface HostTelemetrySample {
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly totalCpuUtilization: number | null;
  readonly perCoreCpuUtilization: readonly (number | null)[];
  readonly loadAverage1m: number | null;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly parentRssBytes: number;
  readonly activeAgentWorkers: number;
  readonly eventLoopLagMs: number | null;
}

export interface ContinuationRecord {
  readonly schemaVersion: 1;
  readonly continuationSessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly experimentDirectory: string;
  readonly experimentFingerprintHash: string | null;
  readonly environmentFingerprint: Readonly<Record<string, string | number | null>>;
  readonly previousContinuationSessionId: string | null;
  readonly resumedRuns: number;
  readonly skippedCompletedRuns: number;
  readonly providerBlockedRuns: number;
  readonly infrastructureFailedRuns: number;
  readonly interruptedRuns: number;
  readonly newOutstandingRuns: number;
}

export interface RunStateSummary {
  readonly logicalRunId: string;
  readonly attemptId: string | null;
  readonly state: RunState;
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly taskId: string;
  readonly attemptedAt: string | null;
  readonly attemptCount: number;
}
