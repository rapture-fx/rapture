import { createJsonlAppender, readJsonlLines } from "@rapture/kernel";
import pLimit from "p-limit";
import type { LogicalRunState } from "./logical-run.js";
import type { RunStateSummary } from "./models.js";

export interface LedgerEntry {
  readonly logicalRunId: string;
  readonly attemptId: string | null;
  readonly state: LogicalRunState;
  readonly trialId: string;
  readonly workerCount: number;
  readonly repetition: number;
  readonly taskId: string;
  readonly attemptedAt: string | null;
  readonly attemptCount: number;
}

export interface RunLedger {
  readonly get: (logicalRunId: string) => LedgerEntry | null;
  readonly entries: readonly LedgerEntry[];
  readonly record: (entry: LedgerEntry) => Promise<void>;
  readonly countByState: () => Readonly<Record<LogicalRunState, number>>;
}

function entryFromLine(line: string): LedgerEntry {
  const parsed = JSON.parse(line) as LedgerEntry;
  return {
    logicalRunId: parsed.logicalRunId,
    attemptId: parsed.attemptId,
    state: parsed.state,
    trialId: parsed.trialId,
    workerCount: parsed.workerCount,
    repetition: parsed.repetition,
    taskId: parsed.taskId,
    attemptedAt: parsed.attemptedAt,
    attemptCount: parsed.attemptCount,
  };
}

export async function createRunLedger(path: string): Promise<RunLedger> {
  const appender = await createJsonlAppender(path);
  const entries = await readJsonlLines(path).then((lines) => lines.map(entryFromLine));
  const map = new Map<string, LedgerEntry>();
  for (const entry of entries) map.set(entry.logicalRunId, entry);
  const serialize = pLimit(1);
  return {
    get: (logicalRunId) => map.get(logicalRunId) ?? null,
    entries: [...map.values()],
    record: (entry) =>
      serialize(async () => {
        map.set(entry.logicalRunId, entry);
        await appender.appendLine(JSON.stringify(entry));
      }),
    countByState: () => {
      const counts = {} as Record<LogicalRunState, number>;
      for (const entry of map.values()) {
        counts[entry.state] = (counts[entry.state] ?? 0) + 1;
      }
      return counts;
    },
  };
}

export function summaryFromEntries(entries: readonly LedgerEntry[]): readonly RunStateSummary[] {
  return entries.map((entry) => ({
    logicalRunId: entry.logicalRunId,
    attemptId: entry.attemptId,
    state: entry.state,
    trialId: entry.trialId,
    workerCount: entry.workerCount,
    repetition: entry.repetition,
    taskId: entry.taskId,
    attemptedAt: entry.attemptedAt,
    attemptCount: entry.attemptCount,
  }));
}
