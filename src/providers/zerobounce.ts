import * as Schema from "effect/Schema";
import { Effect } from "effect";
import type { MicroUsd } from "../domain/money.js";
import type {
  NormalizedProviderOutcome,
  ProviderAdapter,
} from "../domain/provider-adapter.js";
import type { HttpClient } from "../http/http-client.js";
import { decodeProviderResponse, unknownOutcome } from "./shared.js";

const ZeroBounceResponseSchema = Schema.Struct({
  status: Schema.String,
  sub_status: Schema.String,
  mx_found: Schema.Union(Schema.Boolean, Schema.Literal("true", "false")),
  catchall_domain: Schema.NullOr(Schema.Boolean),
});
export type ZeroBounceResponse = typeof ZeroBounceResponseSchema.Type;

const zbBoolean = (value: boolean | "true" | "false"): boolean =>
  value === true || value === "true";

export const normalizeZeroBounce = (
  value: ZeroBounceResponse,
): NormalizedProviderOutcome => {
  const syntaxInvalid = value.sub_status === "failed_syntax_check";
  const domainInvalid =
    value.sub_status === "no_dns_entries" ||
    value.sub_status === "does_not_accept_mail";
  const evidence = {
    syntax: syntaxInvalid ? ("invalid" as const) : ("valid" as const),
    domain: domainInvalid
      ? ("unreachable" as const)
      : zbBoolean(value.mx_found)
        ? ("reachable" as const)
        : ("unknown" as const),
    mailbox: "unknown" as const,
    catchAll: value.catchall_domain,
    disposable: value.sub_status === "disposable" ? true : null,
    roleBased:
      value.sub_status === "role_based" ||
      value.sub_status === "role_based_catch_all"
        ? true
        : null,
  };
  switch (value.status) {
    case "valid":
      return {
        decision: "send",
        confidence: "high",
        evidence: { ...evidence, mailbox: "exists" },
        mappingCode: `valid:${value.sub_status || "none"}`,
      };
    case "invalid":
      return {
        decision: "do_not_send",
        confidence: "high",
        evidence: {
          ...evidence,
          mailbox:
            value.sub_status === "mailbox_not_found" ? "missing" : "unknown",
        },
        mappingCode: `invalid:${value.sub_status || "none"}`,
      };
    case "spamtrap":
    case "abuse":
    case "do_not_mail":
      return {
        decision: "do_not_send",
        confidence: "high",
        evidence,
        mappingCode: `${value.status}:${value.sub_status || "none"}`,
      };
    case "catch-all":
      return {
        decision: "uncertain",
        confidence: "low",
        evidence: { ...evidence, catchAll: true },
        mappingCode: `catch-all:${value.sub_status || "none"}`,
      };
    case "unknown":
      return {
        decision: "uncertain",
        confidence: "unknown",
        evidence,
        mappingCode: `unknown:${value.sub_status || "none"}`,
      };
    default:
      return unknownOutcome(
        `unmapped:${value.status}:${value.sub_status || "none"}`,
      );
  }
};

export const createZeroBounceAdapter = (options: {
  readonly apiKey: string;
  readonly costPerAttempt: MicroUsd;
  readonly httpClient: HttpClient;
  readonly timeoutMs?: number;
}): ProviderAdapter => ({
  id: "zerobounce",
  configured: options.apiKey.length > 0,
  costPerAttempt: options.costPerAttempt,
  verify: (request) => {
    const url = new URL("https://api.zerobounce.net/v2/validate");
    url.searchParams.set("email", request.email);
    url.searchParams.set("api_key", options.apiKey);
    return options.httpClient
      .getJson({
        providerId: "zerobounce",
        url,
        timeoutMs: options.timeoutMs ?? 20_000,
        allowedHost: "api.zerobounce.net",
      })
      .pipe(
        Effect.flatMap((body) =>
          decodeProviderResponse("zerobounce", ZeroBounceResponseSchema, body),
        ),
        Effect.map(normalizeZeroBounce),
      );
  },
});
