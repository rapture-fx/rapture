import {
  formatScenarioResult,
  isScenarioWorldKind,
  listScenarios,
  runNamedScenario,
  type ScenarioStatus,
  type ScenarioWorldKind,
} from "@rapture/core";

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
    "  rapture run <scenario> [--json] [--world=memory|postgres]",
    "",
  ].join("\n");
}

function exitCodeFor(status: ScenarioStatus): number {
  if (status === "PASS") return 0;
  if (status === "FAIL") return 1;
  return 2;
}

const WORLD_PREFIX = "--world=";

interface ParsedRunOptions {
  readonly json: boolean;
  readonly world: ScenarioWorldKind;
}

function parseRunOptions(options: readonly string[]): ParsedRunOptions | undefined {
  let json = false;
  let world: ScenarioWorldKind = "memory";
  for (const option of options) {
    if (option === "--json") {
      json = true;
      continue;
    }
    if (option.startsWith(WORLD_PREFIX)) {
      const value = option.slice(WORLD_PREFIX.length);
      if (!isScenarioWorldKind(value)) return undefined;
      world = value;
      continue;
    }
    return undefined;
  }
  return { json, world };
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
    const options = parseRunOptions(argv.slice(2));
    if (name === undefined || options === undefined) {
      io.stderr(usage());
      return 2;
    }
    try {
      const result = await runNamedScenario(name, {}, options.world);
      io.stdout(
        options.json ? `${JSON.stringify(result, null, 2)}\n` : formatScenarioResult(result),
      );
      return exitCodeFor(result.status);
    } catch (error: unknown) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }

  io.stderr(usage());
  return 2;
}
