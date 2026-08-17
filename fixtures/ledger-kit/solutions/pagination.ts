export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a 1-based integer");
  }
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError("pageSize must be a positive integer");
  }
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
