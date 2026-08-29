export const TRACE_VERSION = "1" as const;

export type OperationClass =
  | "file_read"
  | "file_write"
  | "file_stat"
  | "directory_list"
  | "search"
  | "git"
  | "shell"
  | "test"
  | "build"
  | "install"
  | "network"
  | "agent_tool"
  | "unknown";

export interface RepoState {
  readonly head: string | null;
  readonly tree: string | null;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly statusPorcelain: string;
  readonly untrackedCount: number;
  readonly modifiedCount: number;
}

export interface TokenUsage {
  readonly input: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly cost: number | null;
}

export interface RunMetadata {
  readonly runId: string;
  readonly traceVersion: typeof TRACE_VERSION;
  readonly agent: string;
  readonly agentVersion: string | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly task: string | null;
  readonly taskHash: string | null;
  readonly taskFile: string | null;
  readonly repositoryRoot: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly status: "completed" | "failed" | "incomplete";
  readonly repoBefore: RepoState;
  readonly repoAfter: RepoState | null;
  readonly opencodeSessionId: string | null;
  readonly tokenUsage: TokenUsage | null;
  readonly incompleteReason: string | null;
  readonly cohort?: string | null;
  readonly taskId?: string | null;
  readonly experimentId?: string | null;
}

export interface RawEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: string;
  readonly data: unknown;
}

export interface NormalizedOperation {
  readonly seq: number;
  readonly timestamp: string;
  readonly opClass: OperationClass;
  readonly tool: string | null;
  readonly rawType: string;
  readonly identityKey: string;
  readonly displayName: string;
  // file-specific
  readonly filePath: string | null;
  readonly contentHash: string | null;
  readonly byteLength: number | null;
  // command-specific
  readonly command: string | null;
  readonly normalizedCommand: string | null;
  readonly workdir: string | null;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  // search-specific
  readonly searchPattern: string | null;
  readonly searchPath: string | null;
  // repo state at time of op
  readonly repoTree: string | null;
  readonly raw: unknown;
}

export interface RunTrace {
  readonly metadata: RunMetadata;
  readonly rawEvents: readonly RawEvent[];
  readonly operations: readonly NormalizedOperation[];
}

export interface DerivedProfile {
  readonly runId: string;
  readonly totalOps: number;
  readonly byClass: Record<OperationClass, number>;
  readonly uniqueOps: number;
  readonly repeatedOps: number;
  readonly repeatPct: number;
  readonly fileReads: number;
  readonly uniqueFileReads: number;
  readonly repeatedUnchangedReads: number;
  readonly bytesRead: number | null;
  readonly shellCommands: number;
  readonly duplicateShellCommands: number;
  readonly shellReadLike: number;
  readonly searches: number;
  readonly repeatedSearches: number;
  readonly gitOps: number;
  readonly testOps: number;
  readonly repeatedTests: number;
  readonly buildOps: number;
  readonly repeatedBuilds: number;
  readonly toolCallCounts: Record<string, number>;
  readonly unknownOps: number;
  readonly cohort?: string | null;
  readonly taskId?: string | null;
}

export interface CrossRunAnalysis {
  readonly runIds: readonly string[];
  readonly totalOps: number;
  readonly uniqueOpsAcrossRuns: number;
  readonly repeatedOpsAcrossRuns: number;
  readonly crossRunRepeatPct: number;
  readonly deterministicReuseCandidates: number;
  readonly deterministicReusePct: number;
  readonly byClass: Record<OperationClass, { total: number; repeated: number }>;
  readonly topRepeatedFiles: readonly { key: string; count: number; paths: string[] }[];
  readonly topRepeatedCommands: readonly { key: string; count: number }[];
  readonly topRepeatedSearches: readonly { key: string; count: number }[];
  readonly topRepeatedTestsBuilds: readonly { key: string; count: number }[];
  readonly tokenOverlap: {
    readonly totalInput: number | null;
    readonly totalOutput: number | null;
    readonly totalCacheRead: number | null;
    readonly repeatedEstimate: number | null;
    readonly confidence: "high" | "low" | "unmeasurable";
  };
  readonly unmeasurablePortion: number;
  readonly perRun: readonly DerivedProfile[];
  readonly shellReadLikeTotal: number;
  readonly byCohort: Record<string, CrossRunAnalysis>;
}
