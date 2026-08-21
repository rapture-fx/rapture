export function normalizeOrder(input) {
  if (!input.customerId) throw new Error("customerId required");
  input.lines = input.lines.filter((line) => line.quantity > 0);
  for (const line of input.lines) {
    if (!line.sku) throw new Error("sku required");
  }
  return input;
}
