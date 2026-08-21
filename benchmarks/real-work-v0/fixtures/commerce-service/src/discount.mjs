export function priceAfterDiscount(subtotalCents, policy) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  const percent = policy.percent ?? 0;
  return subtotalCents - Math.floor((subtotalCents * percent) / 100);
}
