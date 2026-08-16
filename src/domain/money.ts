import * as Schema from "effect/Schema";

declare const MicroUsdBrand: unique symbol;

/** Exact millionths of one US dollar. Never construct from a JS currency float. */
export type MicroUsd = bigint & { readonly [MicroUsdBrand]: "MicroUsd" };

export const MicroUsdStringSchema = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9][0-9]*)$/, {
    message: () => "expected non-negative integer micro-USD",
  }),
);

export const microUsd = (value: bigint | string): MicroUsd => {
  const parsed =
    typeof value === "bigint"
      ? value
      : BigInt(Schema.decodeUnknownSync(MicroUsdStringSchema)(value));
  if (parsed < 0n) throw new RangeError("money cannot be negative");
  return parsed as MicroUsd;
};

export const addMoney = (left: MicroUsd, right: MicroUsd): MicroUsd =>
  microUsd(left + right);
export const subtractMoney = (left: MicroUsd, right: MicroUsd): MicroUsd => {
  if (right > left)
    throw new RangeError("money subtraction cannot be negative");
  return microUsd(left - right);
};
export const isWithinBudget = (
  cost: MicroUsd,
  budget: MicroUsd | undefined,
): boolean => budget === undefined || cost <= budget;
export const serializeMoney = (value: MicroUsd): string => value.toString(10);
