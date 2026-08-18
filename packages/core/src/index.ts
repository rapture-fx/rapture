export type { AgentCredentialProbe } from "./adapters/auth.js";
export {
  detectCodexCredentialPresence,
  REAL_SCALE_2_CREDENTIALS_MISSING,
} from "./adapters/auth.js";
export { codexAgentAdapter } from "./adapters/codex.js";
export { fakeAgentAdapter } from "./adapters/fake.js";
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
export { evaluateNodeRuntime, nodeMajor } from "./doctor-checks.js";
export { readEvents } from "./events.js";
export { runExperiment } from "./experiment.js";
export { frozenSemanticMismatches, loadFrozenExperiment, REAL_SCALE_2_EXPECTED } from "./frozen.js";
export { computeFrozenIntegrity, loadExpectedIntegrity } from "./integrity.js";
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
export { formatReport, inspectExperiment, regenerateReport } from "./report.js";
export { incompletePhaseTimings, raptureOverheadMs, timePhase } from "./timing.js";
export { deriveTrialSeed, orderTasks, seededShuffle, trialIdFor } from "./trial.js";
export { parseCommand, validateCommands } from "./validation.js";
export { createWorktreeManager } from "./worktree.js";
