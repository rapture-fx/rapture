import type { TaskDefinition } from "./models.js";

export function trialIdFor(workerCount: number, repetition: number): string {
  if (!Number.isSafeInteger(workerCount) || workerCount <= 0) {
    throw new RangeError("worker count must be a positive safe integer");
  }
  if (!Number.isSafeInteger(repetition) || repetition <= 0) {
    throw new RangeError("repetition must be a positive safe integer");
  }
  return `workers-${workerCount}-trial-${repetition}`;
}

export function deriveTrialSeed(rootSeed: number, repetition: number): number {
  if (!Number.isSafeInteger(rootSeed)) {
    throw new RangeError("root seed must be a safe integer");
  }
  if (!Number.isSafeInteger(repetition) || repetition <= 0) {
    throw new RangeError("repetition must be a positive safe integer");
  }
  return (Math.imul(rootSeed, 0x9e3779b1) ^ Math.imul(repetition, 0x85ebca77)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): readonly T[] {
  const result = [...items];
  const random = mulberry32(seed >>> 0);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const other = result[swapIndex];
    if (current === undefined || other === undefined) {
      throw new Error("seeded shuffle index out of range");
    }
    result[index] = other;
    result[swapIndex] = current;
  }
  return result;
}

export function orderTasks(
  tasks: readonly TaskDefinition[],
  trialSeed: number,
): readonly TaskDefinition[] {
  return seededShuffle(tasks, trialSeed);
}
