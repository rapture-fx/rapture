import { performance } from "node:perf_hooks";
import pLimit from "p-limit";

export async function runBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number, queueWaitMs: number) => Promise<R>,
): Promise<readonly PromiseSettledResult<R>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive safe integer");
  }
  const limit = pLimit(concurrency);
  const submittedAt = values.map(() => performance.now());
  return Promise.allSettled(
    values.map((value, index) => {
      const submitted = submittedAt[index] ?? performance.now();
      return limit(() => operation(value, index, Math.max(0, performance.now() - submitted)));
    }),
  );
}
