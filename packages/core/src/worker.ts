import pLimit from "p-limit";

export async function runBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<readonly PromiseSettledResult<R>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive safe integer");
  }
  const limit = pLimit(concurrency);
  return Promise.allSettled(values.map((value, index) => limit(() => operation(value, index))));
}
