import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);

const { positionals } = parseArgs({ allowPositionals: true });
const destinationArgument = positionals[0];
if (destinationArgument === undefined) {
  throw new Error("usage: node fixtures/create-fixture.mjs <destination>");
}
const destination = resolve(destinationArgument);
await mkdir(destination, { recursive: false });
await writeFile(
  resolve(destination, "calculator.mjs"),
  "export function subtract(left, right) {\n  return left - right;\n}\n",
  "utf8",
);
await execute("git", ["init", "-q", "-b", "main"], { cwd: destination });
await execute("git", ["add", "."], { cwd: destination });
await execute(
  "git",
  [
    "-c",
    "user.name=Rapture Fixture",
    "-c",
    "user.email=fixture@invalid.example",
    "commit",
    "-q",
    "-m",
    "fixture baseline",
  ],
  { cwd: destination },
);
process.stdout.write(`${destination}\n`);
