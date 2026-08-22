import { describe, expect, it } from "vitest";
import { deriveTrialSeed, orderTasks, seededShuffle, trialIdFor } from "../src/trial.js";
import { fakeTask } from "./helpers.js";

describe("trial identity", () => {
  it("constructs a stable trial ID from worker count and repetition", () => {
    expect(trialIdFor(1, 1)).toBe("workers-1-trial-1");
    expect(trialIdFor(2, 3)).toBe("workers-2-trial-3");
    expect(trialIdFor(2, 3)).toBe(trialIdFor(2, 3));
  });

  it("rejects non-positive worker or repetition indexes", () => {
    expect(() => trialIdFor(0, 1)).toThrow(/positive/u);
    expect(() => trialIdFor(1, 0)).toThrow(/positive/u);
  });
});

describe("seeded task ordering", () => {
  const tasks = [
    fakeTask("alpha", "a.txt", "a\n", "node --version"),
    fakeTask("bravo", "b.txt", "b\n", "node --version"),
    fakeTask("charlie", "c.txt", "c\n", "node --version"),
    fakeTask("delta", "d.txt", "d\n", "node --version"),
    fakeTask("echo", "e.txt", "e\n", "node --version"),
    fakeTask("foxtrot", "f.txt", "f\n", "node --version"),
  ];

  it("returns the same order for the same seed", () => {
    const first = orderTasks(tasks, 42).map((task) => task.id);
    const second = orderTasks(tasks, 42).map((task) => task.id);
    expect(first).toEqual(second);
    expect(first).toHaveLength(tasks.length);
    expect(new Set(first)).toEqual(new Set(tasks.map((task) => task.id)));
  });

  it("can change order when the seed changes", () => {
    const original = tasks.map((task) => task.id);
    const observed = new Set<string>();
    for (const seed of [1, 2, 3, 7, 11, 99, 20260817]) {
      observed.add(
        orderTasks(tasks, seed)
          .map((task) => task.id)
          .join(","),
      );
    }
    expect(observed.size).toBeGreaterThan(1);
    expect(observed.has(original.join(",")) || observed.size > 1).toBe(true);
  });

  it("derives the same trial seed for matching repetition indexes", () => {
    expect(deriveTrialSeed(20260817, 2)).toBe(deriveTrialSeed(20260817, 2));
    expect(deriveTrialSeed(20260817, 1)).not.toBe(deriveTrialSeed(20260817, 2));
  });

  it("does not use Math.random", () => {
    const first = seededShuffle(["a", "b", "c", "d", "e"], 9);
    const second = seededShuffle(["a", "b", "c", "d", "e"], 9);
    expect(first).toEqual(second);
  });
});
