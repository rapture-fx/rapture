export function parseAmountToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError("amount must be numeric");
  return Math.round(amount * 100);
}
