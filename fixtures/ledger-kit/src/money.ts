export function parseMoney(input: string): number {
  const digits = input.replace(/[^0-9-]/g, "");
  if (digits.length === 0 || digits === "-") {
    throw new TypeError("invalid money amount");
  }
  return Number.parseInt(digits, 10);
}
