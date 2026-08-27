import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createScenarioJournal,
  defineScenario,
  runScenario,
  type ScenarioWorld,
} from "../src/scenario.js";

type Fixture = { readonly initial: number };
type Observation = { readonly value: number };

function scenarioWith(world: ScenarioWorld<Fixture, Observation>, expectedValue = 2) {
  return defineScenario({
    name: "lifecycle-test",
    description: "Exercise the scenario lifecycle.",
    fixture: { initial: 1 },
    expected: { value: expectedValue },
    createWorld: () => world,
  });
}

describe("runScenario", () => {
  it("prepares, seeds, runs, observes, evaluates, and resets in order", async () => {
    const calls: string[] = [];
    let value = 0;
    const result = await runScenario(
      scenarioWith({
        prepare: async () => {
          calls.push("prepare");
        },
        seedOrRestore: async (fixture) => {
          calls.push("seed");
          value = fixture.initial;
        },
        run: async () => {
          calls.push("action");
          value += 1;
        },
        observe: async () => {
          calls.push("observe");
          return { value };
        },
        disposeOrReset: async () => {
          calls.push("reset");
          value = 0;
        },
      }),
    );

    expect(result.status).toBe("PASS");
    expect(calls).toEqual(["prepare", "seed", "action", "observe", "reset"]);
    expect(value).toBe(0);
    expect(result.expectations).toContainEqual(
      expect.objectContaining({ path: "value", status: "PASS" }),
    );
  });

  it("returns FAIL when the workflow runs but business state is wrong and still resets", async () => {
    const reset = vi.fn(async () => undefined);
    const result = await runScenario(
      scenarioWith(
        {
          prepare: async () => undefined,
          seedOrRestore: async () => undefined,
          run: async () => undefined,
          observe: async () => ({ value: 1 }),
          disposeOrReset: reset,
        },
        2,
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.failures).toEqual([]);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("returns ERROR for a thrown action and still resets", async () => {
    const reset = vi.fn(async () => undefined);
    const result = await runScenario(
      scenarioWith({
        prepare: async () => undefined,
        seedOrRestore: async () => undefined,
        run: async () => {
          throw new Error("action unavailable");
        },
        observe: async () => ({ value: 2 }),
        disposeOrReset: reset,
      }),
    );

    expect(result.status).toBe("ERROR");
    expect(result.failures).toContainEqual({
      phase: "action",
      name: "Error",
      message: "action unavailable",
    });
    expect(reset).toHaveBeenCalledOnce();
  });

  it("upgrades any PASS or FAIL to ERROR when reset itself fails", async () => {
    const result = await runScenario(
      scenarioWith({
        prepare: async () => undefined,
        seedOrRestore: async () => undefined,
        run: async () => undefined,
        observe: async () => ({ value: 2 }),
        disposeOrReset: async () => {
          throw new Error("reset failed");
        },
      }),
    );

    expect(result.status).toBe("ERROR");
    expect(result.failures.at(-1)?.phase).toBe("reset");
  });

  it("writes append-only lifecycle evidence through the retained journal primitive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rapture-journal-"));
    const path = join(directory, "events.jsonl");
    const journal = await createScenarioJournal(path);
    const result = await runScenario(
      scenarioWith({
        prepare: async () => undefined,
        seedOrRestore: async () => undefined,
        run: async () => undefined,
        observe: async () => ({ value: 2 }),
        disposeOrReset: async () => undefined,
      }),
      { journal },
    );
    const events = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { phase: string });

    expect(result.status).toBe("PASS");
    expect(events.map((event) => event.phase)).toEqual([
      "prepare",
      "seed",
      "action",
      "observe",
      "expect",
      "reset",
    ]);
  });
});
