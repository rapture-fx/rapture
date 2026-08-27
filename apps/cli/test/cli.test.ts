import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
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

  it("rejects an unknown world selector", async () => {
    const output = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--world=mysql"], output.io)).toBe(2);
    expect(output.stderr.join("")).toContain("--world=memory|postgres");
  });

  it("fails closed for unknown commands and scenarios", async () => {
    const command = capture();
    const scenario = capture();
    expect(await main(["verify"], command.io)).toBe(2);
    expect(await main(["run", "not-real"], scenario.io)).toBe(2);
    expect(scenario.stderr.join("")).toContain("unknown scenario");
  });
});

describe("rapture CLI against the postgres world", () => {
  let available = false;

  beforeAll(async () => {
    const client = new pg.Client({
      host: process.env.PGHOST ?? "127.0.0.1",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? process.env.USER ?? "postgres",
      database: process.env.PGDATABASE ?? "postgres",
      connectionTimeoutMillis: 3_000,
    });
    try {
      await client.connect();
      await client.end();
      available = true;
    } catch {
      console.warn("SKIPPING postgres CLI tests: no local PostgreSQL server reachable");
    }
  });

  it("runs the reference scenario against real PostgreSQL", async () => {
    if (!available) return;
    const output = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--world=postgres"], output.io)).toBe(0);
    expect(output.stdout.join("")).toContain("PASS permissions.activeSeats expected=15 actual=15");
    expect(output.stdout.join("")).toContain("RESULT: PASS");
  });

  it("reports identical expectation results in human and JSON output", async () => {
    if (!available) return;
    const human = capture();
    const json = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--world=postgres"], human.io)).toBe(0);
    expect(
      await main(["run", "subscription-seat-upgrade", "--world=postgres", "--json"], json.io),
    ).toBe(0);

    const result = JSON.parse(json.stdout.join("")) as {
      schemaVersion: string;
      scenarioName: string;
      status: string;
      resultHash: string;
      expectations: { path: string; status: string; expected: unknown; actual: unknown }[];
      observedState: unknown;
      stages: { phase: string; status: string }[];
    };
    expect(result).toMatchObject({
      schemaVersion: "1",
      scenarioName: "subscription-seat-upgrade",
      status: "PASS",
    });
    expect(result.resultHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.stages).toContainEqual({ phase: "reset", status: "PASS" });

    const humanText = human.stdout.join("");
    for (const expectation of result.expectations) {
      expect(humanText).toContain(
        `${expectation.status} ${expectation.path} expected=${JSON.stringify(
          expectation.expected,
        )} actual=${JSON.stringify(expectation.actual)}`,
      );
    }
  });

  it("produces the same result hash from the memory and postgres worlds", async () => {
    if (!available) return;
    const memory = capture();
    const postgres = capture();
    expect(await main(["run", "subscription-seat-upgrade", "--json"], memory.io)).toBe(0);
    expect(
      await main(["run", "subscription-seat-upgrade", "--world=postgres", "--json"], postgres.io),
    ).toBe(0);
    const memoryResult = JSON.parse(memory.stdout.join("")) as { resultHash: string };
    const postgresResult = JSON.parse(postgres.stdout.join("")) as { resultHash: string };
    expect(postgresResult.resultHash).toBe(memoryResult.resultHash);
  });
});
