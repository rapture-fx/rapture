import * as Schema from "effect/Schema";
import { Effect } from "effect";
import { ProviderFailure, type NormalizedProviderOutcome } from "../domain/provider-adapter.js";

export const unknownOutcome = (mappingCode: string): NormalizedProviderOutcome => ({
  decision: "uncertain",
  confidence: "unknown",
  evidence: {
    syntax: "unknown",
    domain: "unknown",
    mailbox: "unknown",
    catchAll: null,
    disposable: null,
    roleBased: null,
  },
  mappingCode,
});

export const decodeProviderResponse = <A, I>(
  providerId: string,
  schema: Schema.Schema<A, I>,
  input: unknown,
): Effect.Effect<A, ProviderFailure> =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => new ProviderFailure(providerId, "provider_malformed_response", false)),
  );

