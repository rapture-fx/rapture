import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export { assert };

/** Load a CommonJS fixture module by path relative to the candidate repository. */
export function candidateRequire(repository) {
  const root = resolve(repository);
  const load = createRequire(join(root, "rapture-validator-entry.cjs"));
  return (path) => load(join(root, path));
}

/** Load an ES-module fixture by path relative to the candidate repository. */
export function candidateImport(repository) {
  const root = resolve(repository);
  return (path) => import(pathToFileURL(join(root, path)).href);
}

/**
 * Stage a throwaway copy of the candidate repository.
 *
 * Used by validators that must run the fixture's own test suite, or resolve it as an
 * installed package, without mutating the worktree the agent produced.
 */
export function withStagedCopies(repository, count, run) {
  const workspace = mkdtempSync(join(tmpdir(), "rapture-delegation-"));
  try {
    const roots = [];
    for (let index = 0; index < count; index += 1) {
      const root = join(workspace, `copy-${index}`);
      cpSync(resolve(repository), root, {
        recursive: true,
        filter: (source) => !source.split("/").includes(".git"),
      });
      roots.push(root);
    }
    return run(roots, workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/** Run a node process, returning exit status and combined output. */
export function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    cwd: options.cwd,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  if (result.error != null) throw new Error(`unable to run node: ${result.error.message}`);
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

export async function runValidator(validate) {
  const repository = process.argv[2];
  if (repository === undefined) {
    process.stdout.write(
      `${JSON.stringify({ status: "infrastructure_failure", detail: "candidate repository argument missing" })}\n`,
    );
    process.exitCode = 2;
    return;
  }
  try {
    await validate(resolve(repository));
    process.stdout.write(`${JSON.stringify({ status: "accepted" })}\n`);
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      process.stdout.write(`${JSON.stringify({ status: "rejected", detail: error.message })}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${JSON.stringify({ status: "infrastructure_failure", detail: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
