export type { AgentCredentialProbe } from "./adapters/auth.js";
export {
  detectCodexCredentialPresence,
  detectOpenCodeCredentialPresence,
  REAL_SCALE_2_CREDENTIALS_MISSING,
} from "./adapters/auth.js";
export { codexAgentAdapter } from "./adapters/codex.js";
export { fakeAgentAdapter } from "./adapters/fake.js";
export { OPENCODE_MODEL, opencodeAgentAdapter } from "./adapters/opencode.js";
export type { AgentAdapter, AgentRunInput, AgentRunResult } from "./adapters/types.js";
export type {
  AdjacentCapacityStep,
  CapacityCurve,
  CapacityPoint,
  CapacityPointInput,
  CapacityResourceAggregate,
} from "./capacity.js";
export {
  agentLatencyInflation,
  aggregateTelemetry,
  buildCapacityCurve,
  formatFactor,
  marginalThroughputGain,
  marginalWorkerYield,
} from "./capacity.js";
export type { CapacityContext } from "./capacity-report.js";
export {
  appendObservedOutcomes,
  evaluateStoredPredictions,
  loadCapacityContext,
  observeOutcomes,
  persistStepPredictions,
  regenerateStepPredictions,
} from "./capacity-report.js";
export {
  buildExperimentConfig,
  ConfigurationError,
  loadTasks,
  parseExecutionOrder,
  parseRepetitions,
  parseSeed,
  parseTaskFile,
  parseWorkerCounts,
  resolveValidationCommand,
  taskDefinitionSchema,
} from "./config.js";
export type { CounterfactualSimulation } from "./counterfactual.js";
export { simulateControllerStop } from "./counterfactual.js";
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
export { resumeExperiment, runExperiment } from "./experiment.js";
export {
  frozenSemanticMismatches,
  isLedgerKitExperiment,
  loadFrozenExperiment,
  OPENCODE_CAPACITY_CURVE_EXPECTED,
  OPENCODE_SCALE_4_DIAGNOSTIC_EXPECTED,
  OPENCODE_SCALE_4_EXPECTED,
  REAL_SCALE_2_EXPECTED,
  REAL_SCALE_4_EXPECTED,
} from "./frozen.js";
export type { HostStateSnapshot } from "./host-state.js";
export {
  captureHostState,
  detectAgentEnvironmentVariables,
  listActiveCodingAgentProcesses,
  persistHostStateSnapshot,
} from "./host-state.js";
export {
  computeFrozenIntegrity,
  frozenIntegrityPath,
  loadExpectedIntegrity,
} from "./integrity.js";
export type {
  KneeDetection,
  KneeDetectorThresholds,
  KneeStepSignals,
} from "./knee.js";
export { DEFAULT_KNEE_THRESHOLDS, detectCapacityKnee } from "./knee.js";
export { deriveMetrics, median, percentile } from "./metrics.js";
export type {
  EngineeringTaskRun,
  ExecutionOrder,
  ExperimentConfig,
  ExperimentMetrics,
  PhaseTimings,
  ProcessResult,
  TaskDefinition,
  TrialMetrics,
  WorkerMetrics,
} from "./models.js";
export type { OutcomeRecord, PredictionRecord } from "./prediction-store.js";
export {
  createPredictionStore,
  OutcomeAlreadyExistsError,
  PredictionAlreadyExistsError,
} from "./prediction-store.js";
export {
  ALL_PREDICTORS,
  BASELINE_CPU_SATURATION_FRACTION,
  BASELINE_MEMORY_PRESSURE_FRACTION,
  classifyObservedOutcome,
  cpuOnlyBaseline,
  evaluatePredictions,
  fixedConcurrencyBaseline,
  memoryOnlyBaseline,
  rapturePredictor,
  runAllPredictors,
  simpleResourceBaseline,
} from "./predictors.js";
export { runProcess } from "./process.js";
export { formatReport, inspectExperiment, regenerateReport } from "./report.js";
export { incompletePhaseTimings, raptureOverheadMs, timePhase } from "./timing.js";
export { deriveTrialSeed, orderTasks, seededShuffle, trialIdFor } from "./trial.js";
export { parseCommand, validateCommands } from "./validation.js";
export { createWorktreeManager } from "./worktree.js";
