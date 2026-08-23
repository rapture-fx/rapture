import { expect, it } from "vitest";
import { parseCommand, ValidationCommandError, validateCommands } from "../src/index.js";

it("parses quoted argv without invoking a shell", () => {
  expect(parseCommand("node -e \"console.log('ok')\"")).toEqual([
    "node",
    "-e",
    "console.log('ok')",
  ]);
});

it("rejects unterminated quotes", () => {
  expect(() => parseCommand("node -e 'broken")).toThrow(/unterminated/u);
});

it("rejects unterminated escapes", () => {
  expect(() => parseCommand("node -e broken\\")).toThrow(ValidationCommandError);
});

it("rejects empty commands", () => {
  expect(() => parseCommand("   ")).toThrow(/must not be empty/u);
});

it("handles escaped quotes inside double quotes", () => {
  expect(parseCommand('echo "a \\"b\\" c"')).toEqual(["echo", 'a "b" c']);
});

it("passes when all commands succeed", async () => {
  const outcome = await validateCommands(
    [`${JSON.stringify(process.execPath)} -e "process.exit(0)"`],
    process.cwd(),
    30_000,
  );
  expect(outcome.passed).toBe(true);
  expect(outcome.results).toHaveLength(1);
  expect(outcome.results[0]?.exitCode).toBe(0);
  expect(outcome.results[0]?.timedOut).toBe(false);
});

it("stops at the first failing command", async () => {
  const outcome = await validateCommands(
    [
      `${JSON.stringify(process.execPath)} -e "process.exit(3)"`,
      `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
    ],
    process.cwd(),
    30_000,
  );
  expect(outcome.passed).toBe(false);
  expect(outcome.results).toHaveLength(1);
  expect(outcome.results[0]?.exitCode).toBe(3);
});

it("reports timeouts as failures", async () => {
  const outcome = await validateCommands(
    [`${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 60_000)"`],
    process.cwd(),
    1_500,
  );
  expect(outcome.passed).toBe(false);
  expect(outcome.results[0]?.timedOut).toBe(true);
});
