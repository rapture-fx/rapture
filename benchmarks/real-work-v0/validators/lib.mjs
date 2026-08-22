import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export { assert };

export async function candidateModule(repository, path) {
  const url = pathToFileURL(resolve(repository, path));
  url.searchParams.set("validator", `${process.pid}-${Date.now()}`);
  return import(url.href);
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
