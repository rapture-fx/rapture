import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/config.js";

describe("provider configuration", () => {
  it("allows a no-provider engineering configuration", async () => {
    const config = await Effect.runPromise(loadRuntimeConfig({}));
    expect(config).toEqual({ storePath: "./results/live/executions.jsonl" });
  });

  it("fails closed on a credential without exact account economics", async () => {
    const exit = await Effect.runPromiseExit(
      loadRuntimeConfig({ HUNTER_API_KEY: "secret" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("HUNTER_COST_MICRO_USD");
    expect(String(exit)).not.toContain("secret");
  });

  it("parses configured economics exactly", async () => {
    const config = await Effect.runPromise(
      loadRuntimeConfig({
        HUNTER_API_KEY: "secret",
        HUNTER_COST_MICRO_USD: "1250",
      }),
    );
    expect(config.hunter?.costPerAttempt).toBe(1250n);
  });
});
