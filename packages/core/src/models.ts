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

export interface ExperimentConfig {
  readonly repository: string;
  readonly taskFile: string;
  readonly tasks: readonly TaskDefinition[];
  readonly workerCounts: readonly number[];
  readonly agent: "fake" | "codex";
  readonly outputDirectory: string;
  readonly budget: ExperimentBudget;
  readonly seed: number;
  readonly integration: boolean;
  readonly integrationValidation: readonly string[];
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

export interface EngineeringTaskRun {
  readonly runId: string;
  readonly experimentId: string;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly baseCommit: string;
  readonly baseTreeHash: string;
  readonly workerId: string;
  readonly workerCount: number;
  readonly agentProvider: string;
  readonly agentModel: string | null;
  readonly agentVersion: string | null;
  readonly agentCommand: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
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

export interface WorkerMetrics {
  readonly workerCount: number;
  readonly taskRuns: number;
  readonly acceptedTasks: number;
  readonly acceptedTasksPerHour: number | null;
  readonly speedup: number | null;
  readonly parallelEfficiency: number | null;
  readonly medianDurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly validationFailureRate: number | null;
  readonly integrationFailureRate: number | null;
  readonly duplicateCommands: number;
  readonly duplicateTestInvocations: number;
  readonly duplicateBuildInvocations: number;
  readonly tokenUsagePerAcceptedTask: number | null;
  readonly providerCostPerAcceptedTask: number | null;
}

export interface ExperimentMetrics {
  readonly schemaVersion: 1;
  readonly workerResults: readonly WorkerMetrics[];
}
