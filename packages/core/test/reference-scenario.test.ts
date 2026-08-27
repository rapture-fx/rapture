import { afterEach, describe, expect, it, vi } from "vitest";
import { subscriptionSeatUpgradeScenario } from "../src/reference/subscription-seat-upgrade.js";
import { runScenario } from "../src/scenario.js";

describe("subscription-seat-upgrade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes the real local workflow without network or LLM access", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network access is forbidden");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runScenario(subscriptionSeatUpgradeScenario);

    expect(result.status).toBe("PASS");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.observedState).toEqual({
      account: { seats: 15 },
      billing: { quantity: 15 },
      permissions: { activeSeats: 15 },
      prorationInvoiceCreated: true,
      auditEventCreated: true,
      confirmationNotificationCreated: true,
    });
  });

  it("is isolated and deterministically equivalent across consecutive runs", async () => {
    const first = await runScenario(subscriptionSeatUpgradeScenario);
    const second = await runScenario(subscriptionSeatUpgradeScenario);

    expect(first.status).toBe("PASS");
    expect(second.status).toBe("PASS");
    expect(second.observedState).toEqual(first.observedState);
    expect(second.expectations).toEqual(first.expectations);
    expect(second.resultHash).toBe(first.resultHash);
  });
});
