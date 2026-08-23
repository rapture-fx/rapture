import { isAbsolute, relative, resolve, sep } from "node:path";
import { sha256File } from "../evidence/artifacts.js";
import { runProcess } from "../process/run.js";
import type { ProcessResult } from "../types.js";

export type ValidatorClassification = "accepted" | "rejected" | "infrastructure_failure";

export interface ValidatorRunResult {
  readonly classification: ValidatorClassification;
  readonly process: ProcessResult | null;
  readonly detail: string;
}

export class ValidatorAssetError extends Error {
  public override readonly name = "ValidatorAssetError";
}

function inside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

async function verifyFile(path: string, expected: string): Promise<void> {
  const actual = await sha256File(path);
  if (actual !== expected) {
    throw new ValidatorAssetError(`asset drift for ${path}: expected ${expected}, got ${actual}`);
  }
}

export async function runExternalValidator(input: {
  readonly validatorPath: string;
  readonly expectedSha256: string;
  readonly repositoryPath: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}): Promise<ValidatorRunResult> {
  try {
    const validator = resolve(input.validatorPath);
    await verifyFile(validator, input.expectedSha256);
    const repository = resolve(input.repositoryPath);
    if (inside(repository, validator)) {
      return {
        classification: "infrastructure_failure",
        process: null,
        detail: "validator entered candidate repository",
      };
    }
    const processResult = await runProcess(process.execPath, [validator, repository], {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    });
    if (processResult.timedOut) {
      return {
        classification: "infrastructure_failure",
        process: processResult,
        detail: "validator timed out",
      };
    }
    if (processResult.exitCode === 0) {
      return {
        classification: "accepted",
        process: processResult,
        detail: "validator accepted task",
      };
    }
    if (processResult.exitCode === 1) {
      return {
        classification: "rejected",
        process: processResult,
        detail: "validator rejected task",
      };
    }
    return {
      classification: "infrastructure_failure",
      process: processResult,
      detail: `validator exited ${processResult.exitCode ?? "without status"}`,
    };
  } catch (error: unknown) {
    return {
      classification: "infrastructure_failure",
      process: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
