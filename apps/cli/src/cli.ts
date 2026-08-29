import { resolve } from "node:path";
import {
  formatScenarioResult,
  listScenarios,
  runNamedScenario,
  type ScenarioStatus,
} from "@rapture/core";
import {
  analyzeCrossRun,
  deriveProfile,
  formatCrossRunReport,
  formatSingleReport,
  listRuns,
  loadManifest,
  loadRunTrace,
  profileOpenCode,
  runExperiment,
} from "@rapture/profiler";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const processIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function usage(): string {
  return [
    "Usage:",
    "  rapture scenario list",
    "  rapture run <scenario> [--json]",
    "  rapture profile opencode --task <task> [OpenCode args...]",
    "  rapture profile opencode --task-file <path> [OpenCode args...]",
    "  rapture runs list [--json]",
    "  rapture runs show <run-id> [--json]",
    "  rapture analyze <run-id> [<run-id>...] [--json]",
    "  rapture analyze --all [--json]",
    "  rapture experiment run <manifest> [--no-task-text]",
    "  rapture change ingest <provider> --file <path> [--repo <repo>]",
    "  rapture change build",
    "  rapture change list [--json]",
    "  rapture change show <change-id> [--json]",
    "  rapture change trace <identifier> [--json]",
    "",
  ].join("\n");
}

function exitCodeFor(status: ScenarioStatus): number {
  if (status === "PASS") return 0;
  if (status === "FAIL") return 1;
  return 2;
}

export async function main(argv: readonly string[], io: CliIo = processIo): Promise<number> {
  if (argv.length === 2 && argv[0] === "scenario" && argv[1] === "list") {
    for (const scenario of listScenarios()) {
      io.stdout(`${scenario.name}\t${scenario.description}\n`);
    }
    return 0;
  }

  if (argv[0] === "run") {
    const name = argv[1];
    const options = argv.slice(2);
    if (name === undefined || options.some((option) => option !== "--json")) {
      io.stderr(usage());
      return 2;
    }
    try {
      const result = await runNamedScenario(name);
      io.stdout(
        options.includes("--json")
          ? `${JSON.stringify(result, null, 2)}\n`
          : formatScenarioResult(result),
      );
      return exitCodeFor(result.status);
    } catch (error: unknown) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }

  // rapture profile opencode ...
  if (argv[0] === "profile" && argv[1] === "opencode") {
    return handleProfile(argv.slice(2), io);
  }

  if (argv[0] === "runs" && argv[1] === "list") {
    const json = argv.includes("--json");
    const repoRoot = process.cwd();
    const runs = await listRuns(repoRoot);
    if (json) {
      io.stdout(`${JSON.stringify(runs, null, 2)}\n`);
    } else {
      if (runs.length === 0) io.stdout("No runs found in .rapture/runs/\n");
      else
        for (const r of runs)
          io.stdout(
            `${r.runId}\t${r.startTime}\t${r.status}\t${r.taskHash?.slice(0, 8) ?? "-"} ${r.model ?? ""}\n`,
          );
    }
    return 0;
  }

  if (argv[0] === "runs" && argv[1] === "show") {
    const runId = argv[2];
    const json = argv.includes("--json");
    if (!runId) {
      io.stderr(usage());
      return 2;
    }
    const repoRoot = process.cwd();
    const trace = await loadRunTrace(repoRoot, runId);
    if (!trace) {
      io.stderr(`run not found: ${runId}\n`);
      return 2;
    }
    if (json) {
      io.stdout(`${JSON.stringify(trace, null, 2)}\n`);
    } else {
      io.stdout(formatSingleReport(trace));
    }
    return 0;
  }

  if (argv[0] === "analyze") {
    const args = argv.slice(1);
    const json = args.includes("--json");
    const filtered = args.filter((a) => a !== "--json");
    const repoRoot = process.cwd();
    const traces = [];
    if (filtered.length === 1 && filtered[0] === "--all") {
      const runs = await listRuns(repoRoot);
      for (const r of runs) {
        const t = await loadRunTrace(repoRoot, r.runId);
        if (t) traces.push(t);
      }
      if (traces.length === 0) {
        io.stderr("No runs to analyze\n");
        return 2;
      }
    } else if (filtered.length >= 1) {
      for (const id of filtered) {
        const t = await loadRunTrace(repoRoot, id);
        if (!t) {
          io.stderr(`run not found: ${id}\n`);
          return 2;
        }
        traces.push(t);
      }
    } else {
      io.stderr(usage());
      return 2;
    }
    // single run analyze: show single report + cross analysis if >1
    if (traces.length === 1 && traces[0]) {
      const single = traces[0];
      if (json) {
        const profile = deriveProfile(single);
        io.stdout(`${JSON.stringify(profile, null, 2)}\n`);
      } else {
        io.stdout(formatSingleReport(single));
      }
      return 0;
    }
    const analysis = analyzeCrossRun(traces);
    if (json) io.stdout(`${JSON.stringify(analysis, null, 2)}\n`);
    else io.stdout(formatCrossRunReport(analysis));
    return 0;
  }

  if (argv[0] === "experiment" && argv[1] === "run") {
    const manifestPath = argv[2];
    if (!manifestPath) {
      io.stderr(usage());
      return 2;
    }
    const noTaskText = argv.includes("--no-task-text");
    try {
      const manifest = await loadManifest(resolve(manifestPath));
      const result = await runExperiment(manifest, resolve(manifestPath), {
        persistTaskText: !noTaskText,
      });
      io.stdout(`Experiment completed: ${result.runTraces.length} runs\n`);
      for (const t of result.perTask)
        io.stdout(`  ${t.taskId} rep=${t.repetition} run=${t.runId} status=${t.status}\n`);
      const analysis = analyzeCrossRun(result.runTraces);
      io.stdout("\n" + formatCrossRunReport(analysis));
      return 0;
    } catch (error: unknown) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }

  if (argv[0] === "change") {
    const sub = argv[1];
    const rest = argv.slice(2);
    const { handleChange } = await import("@rapture/change");
    return handleChange([sub ?? "", ...rest], io, process.cwd());
  }

  io.stderr(usage());
  return 2;
}

async function handleProfile(argv: readonly string[], io: CliIo): Promise<number> {
  let task: string | null = null;
  let taskFile: string | null = null;
  const extra: string[] = [];
  let persistTaskText = true;
  // parse --task, --task-file, --no-task-text, and passthrough rest as opencode args
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--task" && i + 1 < argv.length) {
      task = argv[i + 1] ?? null;
      i++;
    } else if (arg?.startsWith("--task=")) {
      task = arg.slice("--task=".length);
    } else if (arg === "--task-file" && i + 1 < argv.length) {
      taskFile = argv[i + 1] ?? null;
      i++;
    } else if (arg?.startsWith("--task-file=")) {
      taskFile = arg.slice("--task-file=".length);
    } else if (arg === "--no-task-text") {
      persistTaskText = false;
    } else if (arg === "--json") {
      // ignore? we handle json output via runs show
      extra.push(arg);
    } else {
      extra.push(arg ?? "");
    }
  }
  if (!task && !taskFile) {
    io.stderr("profile opencode requires --task <task> or --task-file <path>\n");
    io.stderr(usage());
    return 2;
  }
  const repoRoot = process.cwd();
  try {
    io.stderr(`Profiling opencode task... repo=${repoRoot}\n`);
    const trace = await profileOpenCode({
      repoRoot,
      task,
      taskFile,
      persistTaskText,
      extraOpenCodeArgs: extra,
      model: null,
      agent: null,
    });
    io.stdout(formatSingleReport(trace));
    io.stdout(`\nTrace stored: .rapture/runs/${trace.metadata.runId}/\n`);
    return trace.metadata.exitCode === 0 ? 0 : (trace.metadata.exitCode ?? 0);
  } catch (error: unknown) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
