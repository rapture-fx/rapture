import * as Schema from "effect/Schema";
import { Effect } from "effect";
import type { MicroUsd } from "../domain/money.js";
import type {
  NormalizedProviderOutcome,
  ProviderAdapter,
} from "../domain/provider-adapter.js";
import type { HttpClient } from "../http/http-client.js";
import { decodeProviderResponse, unknownOutcome } from "./shared.js";

const KickboxResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.String,
  reason: Schema.String,
  role: Schema.Boolean,
  disposable: Schema.Boolean,
  accept_all: Schema.Boolean,
});
export type KickboxResponse = typeof KickboxResponseSchema.Type;

export const normalizeKickbox = (
  value: KickboxResponse,
): NormalizedProviderOutcome => {
  const syntaxInvalid = value.reason === "invalid_email";
  const domainInvalid = value.reason === "invalid_domain";
  const evidence = {
    syntax: syntaxInvalid ? ("invalid" as const) : ("valid" as const),
    domain: domainInvalid ? ("unreachable" as const) : ("unknown" as const),
    mailbox:
      value.reason === "accepted_email"
        ? ("exists" as const)
        : value.reason === "rejected_email"
          ? ("missing" as const)
          : ("unknown" as const),
    catchAll: value.accept_all,
    disposable: value.disposable,
    roleBased: value.role,
  };
  if (!value.success) return unknownOutcome(`unsuccessful:${value.reason}`);
  switch (value.result) {
    case "deliverable":
      return {
        decision: "send",
        confidence: "high",
        evidence,
        mappingCode: `deliverable:${value.reason}`,
      };
    case "undeliverable":
      return {
        decision: "do_not_send",
        confidence: "high",
        evidence,
        mappingCode: `undeliverable:${value.reason}`,
      };
    case "risky":
      return {
        decision: "uncertain",
        confidence: "low",
        evidence,
        mappingCode: `risky:${value.reason}`,
      };
    case "unknown":
      return {
        decision: "uncertain",
        confidence: "unknown",
        evidence,
        mappingCode: `unknown:${value.reason}`,
      };
    default:
      return unknownOutcome(`unmapped:${value.result}:${value.reason}`);
  }
};

export const createKickboxAdapter = (options: {
  readonly apiKey: string;
  readonly costPerAttempt: MicroUsd;
  readonly httpClient: HttpClient;
  readonly timeoutMs?: number;
}): ProviderAdapter => ({
  id: "kickbox",
  configured: options.apiKey.length > 0,
  costPerAttempt: options.costPerAttempt,
  verify: (request) => {
    const url = new URL("https://api.kickbox.com/v2/verify");
    url.searchParams.set("email", request.email);
    url.searchParams.set("apikey", options.apiKey);
    url.searchParams.set("timeout", String(options.timeoutMs ?? 20_000));
    return options.httpClient
      .getJson({
        providerId: "kickbox",
        url,
        timeoutMs: options.timeoutMs ?? 20_000,
        allowedHost: "api.kickbox.com",
      })
      .pipe(
        Effect.flatMap((body) =>
          decodeProviderResponse("kickbox", KickboxResponseSchema, body),
        ),
        Effect.map(normalizeKickbox),
      );
  },
});
