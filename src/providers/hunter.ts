import * as Schema from "effect/Schema";
import { Effect } from "effect";
import type { MicroUsd } from "../domain/money.js";
import type { NormalizedProviderOutcome, ProviderAdapter } from "../domain/provider-adapter.js";
import type { HttpClient } from "../http/http-client.js";
import { decodeProviderResponse, unknownOutcome } from "./shared.js";

const HunterResponseSchema = Schema.Struct({
  data: Schema.Struct({
    status: Schema.String,
    regexp: Schema.Boolean,
    disposable: Schema.Boolean,
    mx_records: Schema.Boolean,
    smtp_server: Schema.Boolean,
    smtp_check: Schema.Boolean,
    accept_all: Schema.Boolean,
    block: Schema.Boolean,
  }),
});
export type HunterResponse = typeof HunterResponseSchema.Type;

export const normalizeHunter = (response: HunterResponse): NormalizedProviderOutcome => {
  const value = response.data;
  const base = {
    syntax: value.regexp ? ("valid" as const) : ("invalid" as const),
    domain: value.mx_records ? ("reachable" as const) : ("unreachable" as const),
    catchAll: value.accept_all,
    disposable: value.disposable,
    roleBased: null,
  };
  switch (value.status) {
    case "valid":
    case "webmail":
      return {
        decision: "send",
        confidence: "high",
        evidence: { ...base, mailbox: value.smtp_check ? "exists" : "unknown" },
        mappingCode: value.status,
      };
    case "invalid":
      return {
        decision: "do_not_send",
        confidence: "high",
        evidence: {
          ...base,
          mailbox: value.regexp && value.mx_records && !value.smtp_check ? "missing" : "unknown",
        },
        mappingCode: value.status,
      };
    case "disposable":
      return {
        decision: "do_not_send",
        confidence: "high",
        evidence: { ...base, mailbox: "unknown", disposable: true },
        mappingCode: value.status,
      };
    case "accept_all":
      return {
        decision: "uncertain",
        confidence: "low",
        evidence: { ...base, mailbox: "unknown", catchAll: true },
        mappingCode: value.status,
      };
    case "unknown":
      return { ...unknownOutcome("unknown"), evidence: { ...base, mailbox: "unknown" } };
    default:
      return unknownOutcome(`unmapped:${value.status}`);
  }
};

export const createHunterAdapter = (options: {
  readonly apiKey: string;
  readonly costPerAttempt: MicroUsd;
  readonly httpClient: HttpClient;
  readonly timeoutMs?: number;
}): ProviderAdapter => ({
  id: "hunter",
  configured: options.apiKey.length > 0,
  costPerAttempt: options.costPerAttempt,
  verify: (request) => {
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", request.email);
    url.searchParams.set("api_key", options.apiKey);
    return options.httpClient
      .getJson({
        providerId: "hunter",
        url,
        timeoutMs: options.timeoutMs ?? 20_000,
        allowedHost: "api.hunter.io",
      })
      .pipe(
        Effect.flatMap((body) => decodeProviderResponse("hunter", HunterResponseSchema, body)),
        Effect.map(normalizeHunter),
      );
  },
});

