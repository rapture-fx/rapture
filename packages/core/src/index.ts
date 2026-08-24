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
export type {
  EdgeComparison,
  RunObservation,
  WorkerSideSummary,
} from "./attribution.js";
export {
  compareWorkerEdge,
  distributionStats,
  loadRunObservations,
  summarizeWorkerSide,
} from "./attribution.js";
export type {
  BenchmarkDoctorCheck,
  BenchmarkDoctorResult,
  BenchmarkRepository,
  BenchmarkSuite,
  BenchmarkTask,
  BenchmarkTaskClass,
  BenchmarkValidatorClassification,
  BenchmarkValidatorResult,
} from "./benchmark.js";
export {
  applyKnownGoodPatch,
  BenchmarkIntegrityError,
  benchmarkFingerprint,
  benchmarkSuiteSchema,
  benchmarkTaskClasses,
  benchmarkTasksForRepository,
  directoryFingerprint,
  loadBenchmarkSuite,
  materializeBenchmarkRepository,
  parseBenchmarkSuite,
  runBenchmarkDoctor,
  runBenchmarkValidator,
  verifyBenchmarkAssets,
} from "./benchmark.js";
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
export type {
  ConcurrencyInterval,
  ConcurrencyOverlap,
} from "./concurrency-overlap.js";
export {
  computeConcurrencyOverlap,
  computeProviderConcurrency,
} from "./concurrency-overlap.js";
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
export { createLocalWorktreeExecutor } from "./exec/local-worktree.js";
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
export type { VerificationIntegrityReport } from "./integrity-report.js";
export {
  collectChangesBetween,
  formatVerificationIntegrity,
  loadInvariantsFromRepo,
  runVerificationIntegrity,
} from "./integrity-report.js";
export type {
  KneeDetection,
  KneeDetectorThresholds,
  KneeStepSignals,
} from "./knee.js";
export { DEFAULT_KNEE_THRESHOLDS, detectCapacityKnee } from "./knee.js";
export { deriveMetrics, median, percentile } from "./metrics.js";
export type {
  BenchmarkTaskProvenance,
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
export type {
  AttemptProcessSummary,
  ProcessTelemetrySample,
} from "./process-telemetry.js";
export {
  aggregateProcessTelemetry,
  attemptIdFromCommand,
  createProcessTelemetrySampler,
  sampleAgentProcesses,
} from "./process-telemetry.js";
export type {
  EventGapSummary,
  OpenCodeStreamEvent,
  ProviderSpan,
  ProviderTiming,
  RunTimeDecomposition,
  RuntimeObservability,
} from "./provider-events.js";
export {
  decomposeRunTime,
  deriveProviderTiming,
  extractRuntimeObservability,
  matchProviderSpans,
  parseOpenCodeEventStream,
  summarizeEventGaps,
} from "./provider-events.js";
export {
  type ExperimentReport,
  formatReport,
  inspectExperiment,
  regenerateReport,
} from "./report.js";
export type { RuntimeCapabilityFingerprint } from "./runtime-fingerprint.js";
export { persistRuntimeFingerprint, platformSummary } from "./runtime-fingerprint.js";
export type { SignalSeverity } from "./severity.js";
export { blastRadiusLabel, signalSeverity } from "./severity.js";
export { incompletePhaseTimings, raptureOverheadMs, timePhase } from "./timing.js";
export { deriveTrialSeed, orderTasks, seededShuffle, trialIdFor } from "./trial.js";
export { parseCommand, validateCommands } from "./validation.js";
export type { VerificationReceiptPayload } from "./verification-receipt.js";
export {
  createVerificationReceipt,
  parseVerificationReceipt,
  VERIFICATION_RECEIPT_SCHEMA_VERSION,
} from "./verification-receipt.js";
export type { CommitFinding, VerificationScan } from "./verification-scan.js";
export { formatScanMarkdown, runVerificationScan } from "./verification-scan.js";
export { createWorktreeManager } from "./worktree.js";
