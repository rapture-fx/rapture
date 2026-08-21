export type { AgentCredentialProbe } from "./adapters/auth.js";
export {
  detectCodexCredentialPresence,
  detectOpenCodeCredentialPresence,
  REAL_SCALE_2_CREDENTIALS_MISSING,
} from "./adapters/auth.js";
export { codexAgentAdapter } from "./adapters/codex.js";
export { fakeAgentAdapter } from "./adapters/fake.js";
export { OPENCODE_MODEL, opencodeAgentAdapter } from "./adapters/opencode.js";
export { parseOpenCodeUsage } from "./adapters/opencode-usage.js";
export type { AgentAdapter, AgentRunInput, AgentRunResult } from "./adapters/types.js";
export {
  buildExperimentConfig,
  ConfigurationError,
  loadTasks,
  parseRepetitions,
  parseSeed,
  parseTaskFile,
  parseWorkerCounts,
  resolveValidationCommand,
  taskDefinitionSchema,
} from "./config.js";
export type {
  DoctorCheck,
  DoctorCheckId,
  DoctorCheckStatus,
  DoctorResult,
  DoctorStatus,
  RunnerFingerprint,
} from "./doctor.js";
export {
  adapterFor,
  aggregateDoctorStatus,
  collectRunnerFingerprint,
  DoctorError,
  doctorExitCode,
  doctorResultSchema,
  formatDoctor,
  formatDoctorGitHubSummary,
  persistDoctorArtifacts,
  preflightOnlyAllowsSuccess,
  runDoctor,
} from "./doctor.js";
export {
  checkPricingConfig,
  evaluateNodeRuntime,
  nodeMajor,
} from "./doctor-checks.js";
export {
  type AgentUsage,
  deriveMachineCost,
  deriveProviderCost,
  loadPricingContext,
  type MachineUsage,
  type Money,
  type PricingContext,
  pricingContextSchema,
  roundForPresentation,
  safeRatio,
  sumMoney,
  sumNullable,
  type UsageSource,
  usageSourceSchema,
  validatePricingContext,
} from "./economics.js";
export type {
  MarginalWorkerEconomics,
  UsageAvailability,
  WorkerEconomics,
} from "./economics-metrics.js";
export { deriveEconomics, type EconomicsReport } from "./economics-metrics.js";
export { readEvents } from "./events.js";
export { resumeExperiment, runExperiment } from "./experiment.js";
export {
  frozenSemanticMismatches,
  isLedgerKitExperiment,
  loadFrozenExperiment,
  OPENCODE_SCALE_4_DIAGNOSTIC_EXPECTED,
  OPENCODE_SCALE_4_EXPECTED,
  REAL_SCALE_2_EXPECTED,
  REAL_SCALE_4_EXPECTED,
} from "./frozen.js";
export {
  computeFrozenIntegrity,
  frozenIntegrityPath,
  loadExpectedIntegrity,
} from "./integrity.js";
export { deriveMetrics, median, percentile } from "./metrics.js";
export type {
  EngineeringTaskRun,
  ExperimentConfig,
  ExperimentMetrics,
  PhaseTimings,
  ProcessResult,
  TaskDefinition,
  TrialMetrics,
  WorkerMetrics,
} from "./models.js";
export { runProcess } from "./process.js";
export {
  type ExperimentReport,
  formatReport,
  inspectExperiment,
  regenerateReport,
} from "./report.js";
export { incompletePhaseTimings, raptureOverheadMs, timePhase } from "./timing.js";
export { deriveTrialSeed, orderTasks, seededShuffle, trialIdFor } from "./trial.js";
export { parseCommand, validateCommands } from "./validation.js";
export { createWorktreeManager } from "./worktree.js";
