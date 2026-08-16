import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHttpClient } from "../src/http/http-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("fixed-host HTTP boundary", () => {
  it("rejects arbitrary hosts before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const exit = await Effect.runPromiseExit(
      fetchHttpClient.getJson({
        providerId: "hunter",
        url: new URL("https://attacker.example/collect"),
        allowedHost: "api.hunter.io",
        timeoutMs: 100,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authentication_failure"],
    [403, "authentication_failure"],
    [429, "rate_limit"],
    [500, "transport_failure"],
  ])(
    "maps HTTP %i to %s without response or URL leakage",
    async (status, kind) => {
      const secret = "credential-must-not-leak";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("sensitive provider body", { status }),
          ),
      );
      const url = new URL("https://api.hunter.io/v2/email-verifier");
      url.searchParams.set("api_key", secret);
      const exit = await Effect.runPromiseExit(
        fetchHttpClient.getJson({
          providerId: "hunter",
          url,
          allowedHost: "api.hunter.io",
          timeoutMs: 100,
        }),
      );
      const rendered = String(exit);
      expect(rendered).toContain(kind);
      expect(rendered).not.toContain(secret);
      expect(rendered).not.toContain("sensitive provider body");
    },
  );
});
