import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../src/cli.js";

function capture(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

describe("rapture CLI", () => {
  it("lists the single reference scenario", async () => {
    const output = capture();
    expect(await main(["scenario", "list"], output.io)).toBe(0);
    expect(output.stdout.join("")).toContain("subscription-seat-upgrade");
    expect(output.stderr).toEqual([]);
  });

  it("runs the reference scenario end-to-end with human-readable output", async () => {
    const output = capture();
    expect(await main(["run", "subscription-seat-upgrade"], output.io)).toBe(0);
    expect(output.stdout.join("")).toContain("PASS permissions.activeSeats expected=15 actual=15");
    expect(output.stdout.join("")).toContain("RESULT: PASS");
  });

  it("emits the structured result in JSON mode", async () => {
    const output = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--json"], output.io)).toBe(0);
    const result = JSON.parse(output.stdout.join("")) as {
      schemaVersion: string;
      scenarioName: string;
      status: string;
      expectations: unknown[];
      observedState: unknown;
    };
    expect(result).toMatchObject({
      schemaVersion: "1",
      scenarioName: "subscription-seat-upgrade",
      status: "PASS",
    });
    expect(result.expectations.length).toBeGreaterThan(0);
    expect(result.observedState).toBeDefined();
  });

  it("runs twice without leaking world state", async () => {
    const first = capture();
    const second = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--json"], first.io)).toBe(0);
    expect(await main(["run", "subscription-seat-upgrade", "--json"], second.io)).toBe(0);
    const firstResult = JSON.parse(first.stdout.join("")) as { resultHash: string };
    const secondResult = JSON.parse(second.stdout.join("")) as { resultHash: string };
    expect(secondResult.resultHash).toBe(firstResult.resultHash);
  });

  it("fails closed for unknown commands and scenarios", async () => {
    const command = capture();
    const scenario = capture();
    expect(await main(["verify"], command.io)).toBe(2);
    expect(await main(["run", "not-real"], scenario.io)).toBe(2);
    expect(scenario.stderr.join("")).toContain("unknown scenario");
  });
});
