import { readFileSync } from "node:fs";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { microUsd } from "../src/domain/money.js";
import { ProviderFailure } from "../src/domain/provider-adapter.js";
import type { HttpClient } from "../src/http/http-client.js";
import { createHunterAdapter, normalizeHunter } from "../src/providers/hunter.js";
import { createKickboxAdapter, normalizeKickbox } from "../src/providers/kickbox.js";
import { normalizeZeroBounce } from "../src/providers/zerobounce.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

describe("provider normalization", () => {
  it("normalizes documented Hunter deliverable evidence", () => {
    const raw = fixture("hunter-valid.json") as Parameters<typeof normalizeHunter>[0];
    expect(normalizeHunter(raw)).toMatchObject({
      decision: "send",
      confidence: "high",
      evidence: { syntax: "valid", domain: "reachable", mailbox: "exists" },
    });
  });

  it("preserves ZeroBounce catch-all uncertainty", () => {
    const raw = fixture("zerobounce-catch-all.json") as Parameters<typeof normalizeZeroBounce>[0];
    expect(normalizeZeroBounce(raw)).toMatchObject({
      decision: "uncertain",
      confidence: "low",
      evidence: { catchAll: true, mailbox: "unknown" },
    });
  });

  it("maps Kickbox rejected mailbox without inferring domain reachability", () => {
    const raw = fixture("kickbox-undeliverable.json") as Parameters<typeof normalizeKickbox>[0];
    expect(normalizeKickbox(raw)).toMatchObject({
      decision: "do_not_send",
      evidence: { mailbox: "missing", domain: "unknown" },
    });
  });

  it("maps new provider statuses to full uncertainty", () => {
    expect(
      normalizeHunter({
        data: {
          status: "future_status",
          regexp: true,
          disposable: false,
          mx_records: true,
          smtp_server: true,
          smtp_check: true,
          accept_all: false,
          block: false,
        },
      }),
    ).toMatchObject({
      decision: "uncertain",
      confidence: "unknown",
      evidence: { syntax: "unknown", domain: "unknown", mailbox: "unknown" },
    });
  });
});

describe("provider boundary failures", () => {
  const request = { email: "controlled@example.test", objective: "safe_to_send" as const };

  it("rejects malformed JSON after transport success", async () => {
    const httpClient: HttpClient = { getJson: () => Effect.succeed({ data: { status: "valid" } }) };
    const adapter = createHunterAdapter({ apiKey: "secret-value", costPerAttempt: microUsd(1n), httpClient });
    const exit = await Effect.runPromiseExit(adapter.verify(request));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("provider_malformed_response");
  });

  it("preserves typed provider errors without leaking secrets or input", async () => {
    const httpClient: HttpClient = {
      getJson: () => Effect.fail(new ProviderFailure("kickbox", "authentication_failure", false)),
    };
    const secret = "never-log-this-api-key";
    const adapter = createKickboxAdapter({ apiKey: secret, costPerAttempt: microUsd(1n), httpClient });
    const exit = await Effect.runPromiseExit(adapter.verify(request));
    const rendered = String(exit);
    expect(rendered).toContain("authentication_failure");
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain(request.email);
  });
});
