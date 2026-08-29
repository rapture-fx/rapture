import { isDeterministicReusable, isShellReadLike } from "./normalize.js";
import type {
  CrossRunAnalysis,
  DerivedProfile,
  NormalizedOperation,
  OperationClass,
  RunTrace,
} from "./schema.js";

const ALL_CLASSES: OperationClass[] = [
  "file_read",
  "file_write",
  "file_stat",
  "directory_list",
  "search",
  "git",
  "shell",
  "test",
  "build",
  "install",
  "network",
  "agent_tool",
  "unknown",
];

export function deriveProfile(trace: RunTrace): DerivedProfile {
  const ops = trace.operations;
  const totalOps = ops.length;
  const byClass: Record<OperationClass, number> = Object.fromEntries(
    ALL_CLASSES.map((c) => [c, 0]),
  ) as Record<OperationClass, number>;
  for (const op of ops) byClass[op.opClass] = (byClass[op.opClass] ?? 0) + 1;

  const keyCounts = new Map<string, number>();
  for (const op of ops) keyCounts.set(op.identityKey, (keyCounts.get(op.identityKey) ?? 0) + 1);
  const uniqueOps = keyCounts.size;
  const repeatedOps = totalOps - uniqueOps;

  // file_read breakdown
  const fileReads = byClass["file_read"] ?? 0;
  const fileReadKeys = new Set<string>();
  let repeatedUnchangedReads = 0;
  const fileKeyCounts = new Map<string, number>();
  for (const op of ops)
    if (op.opClass === "file_read") {
      fileKeyCounts.set(op.identityKey, (fileKeyCounts.get(op.identityKey) ?? 0) + 1);
      fileReadKeys.add(op.identityKey);
    }
  for (const [, c] of fileKeyCounts) if (c > 1) repeatedUnchangedReads += c - 1;
  const uniqueFileReads = fileReadKeys.size;

  let bytesRead: number | null = null;
  let bytesSum = 0;
  let bytesKnown = false;
  for (const op of ops)
    if (op.byteLength !== null && op.opClass === "file_read") {
      bytesSum += op.byteLength;
      bytesKnown = true;
    }
  if (bytesKnown) bytesRead = bytesSum;

  const shellCommands =
    (byClass["shell"] ?? 0) +
    (byClass["git"] ?? 0) +
    (byClass["test"] ?? 0) +
    (byClass["build"] ?? 0) +
    (byClass["install"] ?? 0);
  // duplicate identical shell commands (including git/test/build) by normalizedCommand
  const cmdCounts = new Map<string, number>();
  for (const op of ops)
    if (op.normalizedCommand)
      cmdCounts.set(op.normalizedCommand, (cmdCounts.get(op.normalizedCommand) ?? 0) + 1);
  let duplicateShellCommands = 0;
  for (const [, c] of cmdCounts) if (c > 1) duplicateShellCommands += c - 1;

  const searches = byClass["search"] ?? 0;
  const searchKeyCounts = new Map<string, number>();
  for (const op of ops)
    if (op.opClass === "search")
      searchKeyCounts.set(op.identityKey, (searchKeyCounts.get(op.identityKey) ?? 0) + 1);
  let repeatedSearches = 0;
  for (const [, c] of searchKeyCounts) if (c > 1) repeatedSearches += c - 1;

  const gitOps = byClass["git"] ?? 0;
  const testOps = byClass["test"] ?? 0;
  let repeatedTests = 0;
  {
    const m = new Map<string, number>();
    for (const op of ops)
      if (op.opClass === "test") m.set(op.identityKey, (m.get(op.identityKey) ?? 0) + 1);
    for (const [, c] of m) if (c > 1) repeatedTests += c - 1;
  }
  const buildOps = byClass["build"] ?? 0;
  let repeatedBuilds = 0;
  {
    const m = new Map<string, number>();
    for (const op of ops)
      if (op.opClass === "build") m.set(op.identityKey, (m.get(op.identityKey) ?? 0) + 1);
    for (const [, c] of m) if (c > 1) repeatedBuilds += c - 1;
  }

  const toolCallCounts: Record<string, number> = {};
  for (const op of ops) if (op.tool) toolCallCounts[op.tool] = (toolCallCounts[op.tool] ?? 0) + 1;

  const unknownOps = byClass["unknown"] ?? 0;

  const repeatPct = totalOps === 0 ? 0 : (repeatedOps / totalOps) * 100;

  let shellReadLike = 0;
  for (const op of ops) if (isShellReadLike(op)) shellReadLike++;

  return {
    runId: trace.metadata.runId,
    totalOps,
    byClass,
    uniqueOps,
    repeatedOps,
    repeatPct,
    fileReads,
    uniqueFileReads,
    repeatedUnchangedReads,
    bytesRead,
    shellCommands,
    duplicateShellCommands,
    shellReadLike,
    searches,
    repeatedSearches,
    gitOps,
    testOps,
    repeatedTests,
    buildOps,
    repeatedBuilds,
    toolCallCounts,
    unknownOps,
    cohort: trace.metadata.cohort ?? null,
    taskId: trace.metadata.taskId ?? null,
  };
}

export function analyzeCrossRun(traces: readonly RunTrace[]): CrossRunAnalysis {
  if (traces.length === 0) {
    return {
      runIds: [],
      totalOps: 0,
      uniqueOpsAcrossRuns: 0,
      repeatedOpsAcrossRuns: 0,
      crossRunRepeatPct: 0,
      deterministicReuseCandidates: 0,
      deterministicReusePct: 0,
      byClass: Object.fromEntries(
        ALL_CLASSES.map((c) => [c, { total: 0, repeated: 0 }]),
      ) as CrossRunAnalysis["byClass"],
      topRepeatedFiles: [],
      topRepeatedCommands: [],
      topRepeatedSearches: [],
      topRepeatedTestsBuilds: [],
      tokenOverlap: {
        totalInput: null,
        totalOutput: null,
        totalCacheRead: null,
        repeatedEstimate: null,
        confidence: "unmeasurable",
      },
      unmeasurablePortion: 0,
      perRun: [],
      shellReadLikeTotal: 0,
      byCohort: {},
    };
  }

  const perRun = traces.map(deriveProfile);
  const totalOps = perRun.reduce((a, p) => a + p.totalOps, 0);

  // cross-run key counts
  const globalKeyCounts = new Map<string, number>();
  const keyToOps = new Map<string, NormalizedOperation[]>();
  for (const t of traces)
    for (const op of t.operations) {
      globalKeyCounts.set(op.identityKey, (globalKeyCounts.get(op.identityKey) ?? 0) + 1);
      const arr = keyToOps.get(op.identityKey) ?? [];
      arr.push(op);
      keyToOps.set(op.identityKey, arr);
    }
  const uniqueOpsAcrossRuns = globalKeyCounts.size;
  let repeatedOpsAcrossRuns = 0;
  for (const [, c] of globalKeyCounts) if (c > 1) repeatedOpsAcrossRuns += c - 1;
  const crossRunRepeatPct = totalOps === 0 ? 0 : (repeatedOpsAcrossRuns / totalOps) * 100;

  // deterministic reuse candidates: count ops that are deterministicReusable AND repeated across runs
  let deterministicReuseCandidates = 0;
  for (const [key, count] of globalKeyCounts)
    if (count > 1) {
      const sample = keyToOps.get(key)?.[0];
      if (sample && isDeterministicReusable(sample)) deterministicReuseCandidates += count - 1;
    }
  // also include within single run? spec says across runs, but we count cross-run repeats that are deterministic
  const deterministicReusePct =
    totalOps === 0 ? 0 : (deterministicReuseCandidates / totalOps) * 100;

  // byClass breakdown
  const byClass = Object.fromEntries(
    ALL_CLASSES.map((c) => [c, { total: 0, repeated: 0 }]),
  ) as Record<OperationClass, { total: number; repeated: number }>;
  for (const t of traces) for (const op of t.operations) byClass[op.opClass].total += 1;
  for (const [key, count] of globalKeyCounts)
    if (count > 1) {
      const sample = keyToOps.get(key)?.[0];
      if (sample) byClass[sample.opClass].repeated += count - 1;
    }

  // top repeated files (file_read only)
  const fileKeyCounts = new Map<string, number>();
  const fileKeyToPath = new Map<string, string>();
  for (const [key, count] of globalKeyCounts) {
    const sample = keyToOps.get(key)?.[0];
    if (sample?.opClass === "file_read") {
      fileKeyCounts.set(key, count);
      if (sample.filePath) fileKeyToPath.set(key, sample.filePath);
    }
  }
  const topRepeatedFiles = [...fileKeyCounts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count, paths: [fileKeyToPath.get(key) ?? key] }));

  // top repeated commands (any with command)
  const cmdKeyCounts = new Map<string, number>();
  for (const [key, count] of globalKeyCounts) {
    const sample = keyToOps.get(key)?.[0];
    if (sample?.normalizedCommand)
      cmdKeyCounts.set(
        sample.normalizedCommand,
        (cmdKeyCounts.get(sample.normalizedCommand) ?? 0) + count,
      );
    // but we aggregated by normalizedCommand not identityKey to catch same command across different trees? Actually identityKey includes tree, so we group by normalizedCommand directly
  }
  // Instead compute by normalizedCommand string
  const cmdAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if (op.normalizedCommand)
        cmdAgg.set(op.normalizedCommand, (cmdAgg.get(op.normalizedCommand) ?? 0) + 1);
  const topRepeatedCommands = [...cmdAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  const searchAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if (op.opClass === "search" && op.searchPattern) {
        const k = `${op.searchPattern}:${op.searchPath ?? ""}`;
        searchAgg.set(k, (searchAgg.get(k) ?? 0) + 1);
      }
  const topRepeatedSearches = [...searchAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  const testBuildAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if ((op.opClass === "test" || op.opClass === "build") && op.normalizedCommand) {
        testBuildAgg.set(op.normalizedCommand, (testBuildAgg.get(op.normalizedCommand) ?? 0) + 1);
      }
  const topRepeatedTestsBuilds = [...testBuildAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  // token overlap
  let totalInput: number | null = null;
  let totalOutput: number | null = null;
  let totalCacheRead: number | null = null;
  let hasToken = false;
  for (const t of traces) {
    const tu = t.metadata.tokenUsage;
    if (tu?.input !== null && tu?.input !== undefined) {
      totalInput = (totalInput ?? 0) + tu.input;
      hasToken = true;
    }
    if (tu?.output !== null && tu?.output !== undefined) {
      totalOutput = (totalOutput ?? 0) + tu.output;
      hasToken = true;
    }
    if (tu?.cacheRead !== null && tu?.cacheRead !== undefined) {
      totalCacheRead = (totalCacheRead ?? 0) + tu.cacheRead;
      hasToken = true;
    }
  }
  const tokenOverlap = {
    totalInput,
    totalOutput,
    totalCacheRead,
    repeatedEstimate: null as number | null,
    confidence: (hasToken ? "low" : "unmeasurable") as "high" | "low" | "unmeasurable",
  };
  // repeated estimate only if we have high confidence? We'll keep null to avoid false claims; if we want defensible, we could estimate input token overlap as 0 unless we have per-operation attribution, which we don't.
  // So we leave repeatedEstimate null

  const unknownTotal = byClass["unknown"]?.total ?? 0;
  const unmeasurablePortion = totalOps === 0 ? 0 : (unknownTotal / totalOps) * 100;

  let shellReadLikeTotal = 0;
  for (const t of traces) for (const op of t.operations) if (isShellReadLike(op)) shellReadLikeTotal++;

  // cohort grouping
  const byCohort: Record<string, CrossRunAnalysis> = {};
  const cohortGroups = new Map<string, RunTrace[]>();
  for (const t of traces) {
    const cohort = t.metadata.cohort ?? "uncategorized";
    const arr = cohortGroups.get(cohort) ?? [];
    arr.push(t);
    cohortGroups.set(cohort, arr);
  }
  // To avoid infinite recursion, compute cohort analyses without nested byCohort
  for (const [cohort, group] of cohortGroups) {
    if (group.length <= 1) {
      // single run cohort → no cross-run repeat, but still compute trivially
      const single = group[0];
      if (!single) continue;
      const p = perRun.find((x) => x.runId === single.metadata.runId);
      byCohort[cohort] = {
        runIds: [single.metadata.runId],
        totalOps: p?.totalOps ?? 0,
        uniqueOpsAcrossRuns: p?.totalOps ?? 0,
        repeatedOpsAcrossRuns: 0,
        crossRunRepeatPct: 0,
        deterministicReuseCandidates: 0,
        deterministicReusePct: 0,
        byClass: Object.fromEntries(
          ALL_CLASSES.map((c) => [c, { total: (p?.byClass[c] ?? 0), repeated: 0 }]),
        ) as CrossRunAnalysis["byClass"],
        topRepeatedFiles: [],
        topRepeatedCommands: [],
        topRepeatedSearches: [],
        topRepeatedTestsBuilds: [],
        tokenOverlap: {
          totalInput: single.metadata.tokenUsage?.input ?? null,
          totalOutput: single.metadata.tokenUsage?.output ?? null,
          totalCacheRead: single.metadata.tokenUsage?.cacheRead ?? null,
          repeatedEstimate: null,
          confidence: "unmeasurable",
        },
        unmeasurablePortion: 0,
        perRun: p ? [p] : [],
        shellReadLikeTotal: group.reduce((acc, g) => acc + g.operations.filter(isShellReadLike).length, 0),
        byCohort: {},
      };
    } else {
      // recursive but without byCohort nesting to avoid recursion depth
      const inner = analyzeCrossRunInner(group);
      byCohort[cohort] = inner;
    }
  }

  return {
    runIds: traces.map((t) => t.metadata.runId),
    totalOps,
    uniqueOpsAcrossRuns,
    repeatedOpsAcrossRuns,
    crossRunRepeatPct,
    deterministicReuseCandidates,
    deterministicReusePct,
    byClass,
    topRepeatedFiles,
    topRepeatedCommands,
    topRepeatedSearches,
    topRepeatedTestsBuilds,
    tokenOverlap,
    unmeasurablePortion,
    perRun,
    shellReadLikeTotal,
    byCohort,
  };
}

function analyzeCrossRunInner(traces: readonly RunTrace[]): CrossRunAnalysis {
  const perRun = traces.map(deriveProfile);
  const totalOps = perRun.reduce((a, p) => a + p.totalOps, 0);
  const globalKeyCounts = new Map<string, number>();
  const keyToOps = new Map<string, NormalizedOperation[]>();
  for (const t of traces)
    for (const op of t.operations) {
      globalKeyCounts.set(op.identityKey, (globalKeyCounts.get(op.identityKey) ?? 0) + 1);
      const arr = keyToOps.get(op.identityKey) ?? [];
      arr.push(op);
      keyToOps.set(op.identityKey, arr);
    }
  const uniqueOpsAcrossRuns = globalKeyCounts.size;
  let repeatedOpsAcrossRuns = 0;
  for (const [, c] of globalKeyCounts) if (c > 1) repeatedOpsAcrossRuns += c - 1;
  const crossRunRepeatPct = totalOps === 0 ? 0 : (repeatedOpsAcrossRuns / totalOps) * 100;
  let deterministicReuseCandidates = 0;
  for (const [key, count] of globalKeyCounts)
    if (count > 1) {
      const sample = keyToOps.get(key)?.[0];
      if (sample && isDeterministicReusable(sample)) deterministicReuseCandidates += count - 1;
    }
  const deterministicReusePct = totalOps === 0 ? 0 : (deterministicReuseCandidates / totalOps) * 100;
  const byClass = Object.fromEntries(
    ALL_CLASSES.map((c) => [c, { total: 0, repeated: 0 }]),
  ) as Record<OperationClass, { total: number; repeated: number }>;
  for (const t of traces) for (const op of t.operations) byClass[op.opClass].total += 1;
  for (const [key, count] of globalKeyCounts)
    if (count > 1) {
      const sample = keyToOps.get(key)?.[0];
      if (sample) byClass[sample.opClass].repeated += count - 1;
    }
  const fileKeyCounts = new Map<string, number>();
  const fileKeyToPath = new Map<string, string>();
  for (const [key, count] of globalKeyCounts) {
    const sample = keyToOps.get(key)?.[0];
    if (sample?.opClass === "file_read") {
      fileKeyCounts.set(key, count);
      if (sample.filePath) fileKeyToPath.set(key, sample.filePath);
    }
  }
  const topRepeatedFiles = [...fileKeyCounts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count, paths: [fileKeyToPath.get(key) ?? key] }));
  const cmdAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if (op.normalizedCommand) cmdAgg.set(op.normalizedCommand, (cmdAgg.get(op.normalizedCommand) ?? 0) + 1);
  const topRepeatedCommands = [...cmdAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
  const searchAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if (op.opClass === "search" && op.searchPattern) {
        const k = `${op.searchPattern}:${op.searchPath ?? ""}`;
        searchAgg.set(k, (searchAgg.get(k) ?? 0) + 1);
      }
  const topRepeatedSearches = [...searchAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
  const testBuildAgg = new Map<string, number>();
  for (const t of traces)
    for (const op of t.operations)
      if ((op.opClass === "test" || op.opClass === "build") && op.normalizedCommand) {
        testBuildAgg.set(op.normalizedCommand, (testBuildAgg.get(op.normalizedCommand) ?? 0) + 1);
      }
  const topRepeatedTestsBuilds = [...testBuildAgg.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
  let totalInput: number | null = null;
  let totalOutput: number | null = null;
  let totalCacheRead: number | null = null;
  let hasToken = false;
  for (const t of traces) {
    const tu = t.metadata.tokenUsage;
    if (tu?.input !== null && tu?.input !== undefined) {
      totalInput = (totalInput ?? 0) + tu.input;
      hasToken = true;
    }
    if (tu?.output !== null && tu?.output !== undefined) {
      totalOutput = (totalOutput ?? 0) + tu.output;
      hasToken = true;
    }
    if (tu?.cacheRead !== null && tu?.cacheRead !== undefined) {
      totalCacheRead = (totalCacheRead ?? 0) + tu.cacheRead;
      hasToken = true;
    }
  }
  const tokenOverlap = {
    totalInput,
    totalOutput,
    totalCacheRead,
    repeatedEstimate: null as number | null,
    confidence: (hasToken ? "low" : "unmeasurable") as "high" | "low" | "unmeasurable",
  };
  const unknownTotal = byClass["unknown"]?.total ?? 0;
  const unmeasurablePortion = totalOps === 0 ? 0 : (unknownTotal / totalOps) * 100;
  let shellReadLikeTotal = 0;
  for (const t of traces) for (const op of t.operations) if (isShellReadLike(op)) shellReadLikeTotal++;
  return {
    runIds: traces.map((t) => t.metadata.runId),
    totalOps,
    uniqueOpsAcrossRuns,
    repeatedOpsAcrossRuns,
    crossRunRepeatPct,
    deterministicReuseCandidates,
    deterministicReusePct,
    byClass,
    topRepeatedFiles,
    topRepeatedCommands,
    topRepeatedSearches,
    topRepeatedTestsBuilds,
    tokenOverlap,
    unmeasurablePortion,
    perRun,
    shellReadLikeTotal,
    byCohort: {},
  };
}
