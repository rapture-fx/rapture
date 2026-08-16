import { Effect } from "effect";
import {
  ProviderFailure,
  type ProviderFailureKind,
} from "../domain/provider-adapter.js";

export interface HttpRequest {
  readonly providerId: string;
  readonly url: URL;
  readonly timeoutMs: number;
  readonly allowedHost: string;
}

export interface HttpClient {
  readonly getJson: (
    request: HttpRequest,
  ) => Effect.Effect<unknown, ProviderFailure>;
}

const failureKindForStatus = (status: number): ProviderFailureKind => {
  if (status === 401 || status === 403) return "authentication_failure";
  if (status === 429) return "rate_limit";
  return "transport_failure";
};

export const fetchHttpClient: HttpClient = {
  getJson: (request) => {
    if (
      request.url.protocol !== "https:" ||
      request.url.hostname !== request.allowedHost
    ) {
      return Effect.fail(
        new ProviderFailure(request.providerId, "transport_failure", false),
      );
    }
    return Effect.tryPromise({
      try: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeoutMs);
        try {
          const response = await fetch(request.url, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
            redirect: "error",
          });
          if (!response.ok) {
            throw Object.assign(new Error("provider status"), {
              status: response.status,
            });
          }
          return (await response.json()) as unknown;
        } finally {
          clearTimeout(timer);
        }
      },
      catch: (error) => {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? Number(error.status)
            : undefined;
        const aborted =
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError";
        const kind = aborted
          ? "provider_timeout"
          : status === undefined
            ? "transport_failure"
            : failureKindForStatus(status);
        return new ProviderFailure(
          request.providerId,
          kind,
          kind === "rate_limit" || kind === "provider_timeout",
        );
      },
    });
  },
};
