export { analyzeCrossRun, deriveProfile } from "./analysis.js";
export type { ExperimentResult } from "./experiment.js";
export { runExperiment } from "./experiment.js";
export { ensureCleanReset, getAgentVersion, getHead, getRepoState } from "./git.js";
export { sha256FileHex, sha256Hex } from "./hash.js";
export type { ExpandedTask, ExperimentManifest, ExperimentMode, ManifestTask } from "./manifest.js";
export { expandManifest, loadManifest, validateManifest } from "./manifest.js";
export {
  isDeterministicReusable,
  isShellReadLike,
  normalizeRawEvents,
  normalizeSingle,
  tryParseBashSearch,
  tryParseBashListing,
} from "./normalize.js";
export * from "./artifact.js";
export * from "./pairedAnalysis.js";
export * from "./pairedExperiment.js";
export type { ProfileOptions } from "./profiler.js";
export { profileOpenCode } from "./profiler.js";
export { redactEnv, redactRecord, redactString } from "./redact.js";
export { formatCrossRunReport, formatSignalAssessment, formatSingleReport } from "./report.js";
export type {
  CrossRunAnalysis,
  DerivedProfile,
  NormalizedOperation,
  OperationClass,
  RawEvent,
  RepoState,
  RunMetadata,
  RunTrace,
  TokenUsage,
} from "./schema.js";
export { TRACE_VERSION } from "./schema.js";
export {
  DEFAULT_RUNS_DIR,
  generateRunId,
  listRuns,
  loadRunTrace,
  markIncomplete,
  runDir,
  runsRoot,
  storeRunTrace,
} from "./storage.js";
