import {
  formatScenarioResult,
  listScenarios,
  runNamedScenario,
  type ScenarioStatus,
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
  return ["Usage:", "  rapture scenario list", "  rapture run <scenario> [--json]", ""].join("\n");
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

  io.stderr(usage());
  return 2;
}
