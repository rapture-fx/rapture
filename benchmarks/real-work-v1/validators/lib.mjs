import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

export { assert };

/**
 * Build a CommonJS loader rooted at the candidate repository. The benchmark fixture is a
 * CommonJS package, so validators load it through `createRequire` rather than dynamic
 * `import()` to avoid ESM/CJS interop differences in named exports.
 */
export function candidateRequire(repository) {
  const root = resolve(repository);
  const load = createRequire(join(root, "rapture-validator-entry.cjs"));
  return (path) => load(join(root, path));
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
