import type { ProcessResult } from "./models.js";
import { runProcess } from "./process.js";

export class ValidationCommandError extends Error {
  public override readonly name = "ValidationCommandError";
}

export function parseCommand(command: string): readonly string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped || quote !== null) {
    throw new ValidationCommandError("validation command contains an unterminated escape or quote");
  }
  if (current.length > 0) args.push(current);
  if (args.length === 0) throw new ValidationCommandError("validation command must not be empty");
  return args;
}

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly results: readonly ProcessResult[];
}

export async function validateCommands(
  commands: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<ValidationOutcome> {
  const started = performance.now();
  const results: ProcessResult[] = [];
  for (const command of commands) {
    const args = parseCommand(command);
    const executable = args[0];
    if (executable === undefined) throw new ValidationCommandError("empty validation command");
    const remaining = Math.max(1, timeoutMs - (performance.now() - started));
    const result = await runProcess(executable, args.slice(1), { cwd, timeoutMs: remaining });
    results.push(result);
    if (result.timedOut || result.exitCode !== 0) return { passed: false, results };
  }
  return { passed: true, results };
}
