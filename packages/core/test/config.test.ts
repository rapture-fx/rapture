import { describe, expect, it } from "vitest";
import { ConfigurationError, parseTaskFile, parseWorkerCounts } from "../src/config.js";

function task(id: string, dependsOn: readonly string[] = []): object {
  return {
    id,
    description: "make a change",
    validation: ["node --version"],
    dependsOn,
  };
}

describe("configuration", () => {
  it.each(["", "0", "-1", "1,1", "one"])("rejects invalid workers %s", (workers) => {
    expect(() => parseWorkerCounts(workers)).toThrow(ConfigurationError);
  });

  it("parses unique positive workers", () => {
    expect(parseWorkerCounts("1,2,4")).toEqual([1, 2, 4]);
  });

  it("rejects duplicate task IDs", () => {
    expect(() => parseTaskFile({ tasks: [task("same"), task("same")] })).toThrow(
      /duplicate task ID/u,
    );
  });

  it("rejects missing dependencies", () => {
    expect(() => parseTaskFile({ tasks: [task("one", ["missing"])] })).toThrow(
      /unknown dependency/u,
    );
  });

  it("rejects dependency cycles", () => {
    expect(() => parseTaskFile({ tasks: [task("one", ["two"]), task("two", ["one"])] })).toThrow(
      /dependency cycle/u,
    );
  });

  it("rejects missing validation", () => {
    expect(() => parseTaskFile({ tasks: [{ ...task("one"), validation: [] }] })).toThrow(
      /validation/u,
    );
  });
});
