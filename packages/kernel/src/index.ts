export type { ValidationOutcome } from "./checker/validation.js";
export { parseCommand, ValidationCommandError, validateCommands } from "./checker/validation.js";
export {
  redactSecrets,
  safeArtifactPath,
  sha256,
  sha256File,
  writeJsonArtifact,
  writeJsonArtifactIfAbsent,
  writeJsonArtifactOverwrite,
  writeRawTextArtifact,
  writeTextArtifact,
} from "./evidence/artifacts.js";
export type { IntegrityManifest } from "./evidence/integrity.js";
export { computeIntegrity, driftPaths, listTreeFiles } from "./evidence/integrity.js";
export type { InMemoryExecutor, InMemoryExecutorScript } from "./exec/in-memory.js";
export { createInMemoryExecutor } from "./exec/in-memory.js";
export type {
  Executor,
  ExecutorPrepareInput,
  ExecutorRunOptions,
  PreparedSandbox,
} from "./exec/types.js";
export type { JsonlAppender } from "./journal/jsonl.js";
export { createJsonlAppender, exclusiveCreateFile, readJsonlLines } from "./journal/jsonl.js";
export type { ValidatorClassification, ValidatorRunResult } from "./judge/validator.js";
export { runExternalValidator, ValidatorAssetError } from "./judge/validator.js";
export type { RunOutcomeClassification, RunOutcomeInput } from "./policy/classify.js";
export { classifyRunOutcome } from "./policy/classify.js";
export type {
  ExperimentIdentity,
  LogicalRunIdentity,
  LogicalRunState,
} from "./policy/logical-run.js";
export {
  canonicalExperimentIdentity,
  isFinalRunState,
  isInterruptedState,
  isRerunEligibleState,
  isTerminalRunState,
  logicalRunIdFor,
} from "./policy/logical-run.js";
export type { RunProcessOptions } from "./process/run.js";
export { runProcess } from "./process/run.js";
export type {
  FileChange,
  FileChangeStatus,
  IntegritySignal,
  IntegritySignalKind,
  SignalDetectorOptions,
} from "./signals/detect.js";
export {
  detectIntegritySignals,
  hasWeakeningSignals,
  integritySignalKinds,
  isLikelyTestFile,
} from "./signals/detect.js";
export type { JsonValue, ProcessResult } from "./types.js";
