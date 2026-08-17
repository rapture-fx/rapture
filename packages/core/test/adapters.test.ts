import { expect, it } from "vitest";
import { fakeAgentAdapter } from "../src/adapters/fake.js";
import type { AgentAdapter } from "../src/adapters/types.js";

it("implements a provider-neutral deterministic adapter", async () => {
  const adapter: AgentAdapter = fakeAgentAdapter;
  expect(adapter.name()).toBe("fake");
  await expect(adapter.version()).resolves.toBe("1");
  await expect(adapter.isAvailable()).resolves.toMatchObject({ available: true });
});
