export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) {
    throw new RangeError("pageSize must be positive");
  }
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}
