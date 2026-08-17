export function parseMoney(input: string): number {
  if (typeof input !== "string") {
    throw new TypeError("invalid money amount");
  }
  const cleaned = input.trim().replaceAll("$", "").replaceAll(",", "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/u.test(cleaned)) {
    throw new TypeError("invalid money amount");
  }
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) {
    throw new TypeError("invalid money amount");
  }
  return Math.round(value * 100) / 100;
}
