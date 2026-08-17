export function applyVolumeDiscount(subtotal: number, quantity: number): number {
  if (!Number.isFinite(subtotal) || !Number.isFinite(quantity) || subtotal < 0 || quantity < 0) {
    throw new RangeError("invalid discount inputs");
  }
  const rate = quantity >= 50 ? 0.1 : quantity >= 10 ? 0.05 : 0;
  return Math.round(subtotal * (1 - rate) * 100) / 100;
}
