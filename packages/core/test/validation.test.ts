import { expect, it } from "vitest";
import { parseCommand } from "../src/validation.js";

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
