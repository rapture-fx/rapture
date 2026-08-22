/**
 * Exploration metrics derived from an agent's own structured event stream.
 *
 * These describe how much work the agent did *finding* things before and while changing
 * them: files opened, searches issued, commands run, and how long it took to make a first
 * edit. They are read from OpenCode's `--format json` output rather than inferred, and any
 * field that the stream does not support is null rather than estimated. Host-level
 * telemetry is deliberately not used as a stand-in, because it cannot attribute work to a
 * particular agent action.
 */

export interface AgentExplorationMetrics {
  readonly totalToolCalls: number;
  readonly fileReads: number;
  readonly uniqueFilesRead: number;
  readonly searchOperations: number;
  readonly commandsExecuted: number;
  readonly editOperations: number;
  readonly uniqueFilesEdited: number;
  readonly repeatedEdits: number;
  readonly invalidToolCalls: number;
  readonly toolCallsBeforeFirstEdit: number | null;
  readonly msToFirstEdit: number | null;
  readonly toolBreakdown: Readonly<Record<string, number>>;
}

/** Tool names OpenCode uses for reading, searching and mutating files. */
const READ_TOOLS = new Set(["read"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "list", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"]);
const COMMAND_TOOLS = new Set(["bash", "shell"]);

/** Shell invocations that are really repository searching rather than execution. */
const SEARCH_COMMAND = /(^|[\s|;&])(grep|rg|find|ag|ls|fd)\b/u;

interface ToolCall {
  readonly tool: string;
  readonly startedAt: number | null;
  readonly filePath: string | null;
  readonly command: string | null;
}

function readToolCalls(stdout: string): readonly ToolCall[] {
  const calls: ToolCall[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const record = event as {
      type?: string;
      part?: {
        type?: string;
        tool?: string;
        state?: {
          input?: Record<string, unknown>;
          time?: { start?: number };
        };
      };
    };
    if (record.type !== "tool_use" || record.part?.type !== "tool") continue;
    const state = record.part.state ?? {};
    const input = state.input ?? {};
    const filePath = typeof input.filePath === "string" ? input.filePath : null;
    const command = typeof input.command === "string" ? input.command : null;
    calls.push({
      tool: record.part.tool ?? "unknown",
      startedAt: typeof state.time?.start === "number" ? state.time.start : null,
      filePath,
      command,
    });
  }
  return calls;
}

export function extractAgentExploration(stdout: string): AgentExplorationMetrics | null {
  const calls = readToolCalls(stdout);
  if (calls.length === 0) return null;

  const toolBreakdown: Record<string, number> = {};
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  let fileReads = 0;
  let searchOperations = 0;
  let commandsExecuted = 0;
  let editOperations = 0;
  let repeatedEdits = 0;
  let invalidToolCalls = 0;
  let toolCallsBeforeFirstEdit: number | null = null;
  let firstEditAt: number | null = null;

  const firstStart = calls.find((call) => call.startedAt !== null)?.startedAt ?? null;

  calls.forEach((call, index) => {
    toolBreakdown[call.tool] = (toolBreakdown[call.tool] ?? 0) + 1;
    if (call.tool === "invalid") invalidToolCalls += 1;
    if (READ_TOOLS.has(call.tool)) {
      fileReads += 1;
      if (call.filePath !== null) filesRead.add(call.filePath);
    }
    if (SEARCH_TOOLS.has(call.tool)) searchOperations += 1;
    if (COMMAND_TOOLS.has(call.tool)) {
      commandsExecuted += 1;
      // A shell call that only searches counts as exploration, not execution.
      if (call.command !== null && SEARCH_COMMAND.test(call.command)) searchOperations += 1;
    }
    if (EDIT_TOOLS.has(call.tool)) {
      editOperations += 1;
      if (call.filePath !== null) {
        if (filesEdited.has(call.filePath)) repeatedEdits += 1;
        filesEdited.add(call.filePath);
      }
      if (toolCallsBeforeFirstEdit === null) {
        toolCallsBeforeFirstEdit = index;
        firstEditAt = call.startedAt;
      }
    }
  });

  return {
    totalToolCalls: calls.length,
    fileReads,
    uniqueFilesRead: filesRead.size,
    searchOperations,
    commandsExecuted,
    editOperations,
    uniqueFilesEdited: filesEdited.size,
    repeatedEdits,
    invalidToolCalls,
    toolCallsBeforeFirstEdit,
    msToFirstEdit:
      firstEditAt === null || firstStart === null ? null : Math.max(0, firstEditAt - firstStart),
    toolBreakdown,
  };
}
