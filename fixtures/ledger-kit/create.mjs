import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const { positionals } = parseArgs({ allowPositionals: true });
const destinationArgument = positionals[0];
if (destinationArgument === undefined) {
  throw new Error("usage: node fixtures/ledger-kit/create.mjs <destination>");
}
const destination = resolve(destinationArgument);
await mkdir(destination, { recursive: false });
for (const entry of ["package.json", "tsconfig.json", "README.md", "src", "tests"]) {
  await cp(join(root, entry), join(destination, entry), { recursive: true });
}
await rm(join(destination, "src", "solutions"), { recursive: true, force: true });
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
    "ledger-kit baseline",
  ],
  { cwd: destination },
);
process.stdout.write(`${destination}\n`);
