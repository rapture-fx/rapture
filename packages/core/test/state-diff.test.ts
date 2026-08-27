import { describe, expect, it } from "vitest";
import { diffState } from "../src/state-diff.js";

describe("diffState", () => {
  it("reports focused nested matches and mismatches", () => {
    const diff = diffState(
      { account: { seats: 15 }, permissions: { activeSeats: 15 } },
      { account: { seats: 15 }, permissions: { activeSeats: 10 } },
    );

    expect(diff).toEqual([
      expect.objectContaining({
        path: "account.seats",
        status: "PASS",
        difference: "MATCH",
        expected: 15,
        actual: 15,
      }),
      expect.objectContaining({
        path: "permissions.activeSeats",
        status: "FAIL",
        difference: "MISMATCH",
        expected: 15,
        actual: 10,
      }),
    ]);
  });

  it("reports missing nested leaves without dumping the containing object", () => {
    const diff = diffState(
      { billing: { quantity: 15, invoiceCreated: true } },
      { billing: { quantity: 15 } },
    );

    expect(diff).toContainEqual({
      path: "billing.invoiceCreated",
      status: "FAIL",
      difference: "MISSING",
      hasExpected: true,
      expected: true,
      hasActual: false,
    });
  });

  it("ignores unexpected fields by default and can fail on them explicitly", () => {
    expect(diffState({ value: 1 }, { value: 1, extra: { flag: true } })).toHaveLength(1);
    expect(
      diffState({ value: 1 }, { value: 1, extra: { flag: true } }, { unexpected: "fail" }),
    ).toContainEqual({
      path: "extra.flag",
      status: "FAIL",
      difference: "UNEXPECTED",
      hasExpected: false,
      hasActual: true,
      actual: true,
    });
  });

  it("reports array differences at focused index paths", () => {
    const diff = diffState(
      { events: [{ kind: "created" }, { kind: "confirmed" }] },
      { events: [{ kind: "created" }, { kind: "missing-confirmation" }] },
    );

    expect(diff).toContainEqual(
      expect.objectContaining({
        path: "events[1].kind",
        status: "FAIL",
        difference: "MISMATCH",
      }),
    );
  });
});
