import { describe, expect, it } from "vitest";
import {
  addMoney,
  isWithinBudget,
  microUsd,
  serializeMoney,
  subtractMoney,
} from "../src/domain/money.js";

describe("exact money", () => {
  it("adds and serializes integer micro-USD without floating point", () => {
    expect(
      serializeMoney(addMoney(microUsd("9007199254740993"), microUsd("7"))),
    ).toBe("9007199254741000");
  });

  it("rejects invalid and negative amounts", () => {
    expect(() => microUsd("1.5")).toThrow();
    expect(() => microUsd(-1n)).toThrow("money cannot be negative");
    expect(() => subtractMoney(microUsd(1n), microUsd(2n))).toThrow();
  });

  it("uses inclusive exact budget eligibility", () => {
    expect(isWithinBudget(microUsd(5n), microUsd(5n))).toBe(true);
    expect(isWithinBudget(microUsd(6n), microUsd(5n))).toBe(false);
  });
});
