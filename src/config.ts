import { Effect } from "effect";
import { microUsd, type MicroUsd } from "./domain/money.js";

export interface ProviderRuntimeConfig {
  readonly apiKey: string;
  readonly costPerAttempt: MicroUsd;
}

export interface RuntimeConfig {
  readonly hunter?: ProviderRuntimeConfig;
  readonly zerobounce?: ProviderRuntimeConfig;
  readonly kickbox?: ProviderRuntimeConfig;
  readonly storePath: string;
}

export class ConfigurationError extends Error {
  readonly _tag = "ConfigurationError";
  constructor(
    readonly variable: string,
    readonly reason: "incomplete_pair" | "invalid_cost",
  ) {
    super(`invalid provider configuration: ${variable} (${reason})`);
    this.name = "ConfigurationError";
  }
}

const providerConfig = (
  env: NodeJS.ProcessEnv,
  keyName: string,
  costName: string,
): ProviderRuntimeConfig | undefined => {
  const apiKey = env[keyName];
  const cost = env[costName];
  if (!apiKey && !cost) return undefined;
  if (!apiKey || !cost)
    throw new ConfigurationError(
      !apiKey ? keyName : costName,
      "incomplete_pair",
    );
  try {
    return { apiKey, costPerAttempt: microUsd(cost) };
  } catch {
    throw new ConfigurationError(costName, "invalid_cost");
  }
};

export const loadRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<RuntimeConfig, ConfigurationError> =>
  Effect.try({
    try: () => {
      const hunter = providerConfig(
        env,
        "HUNTER_API_KEY",
        "HUNTER_COST_MICRO_USD",
      );
      const zerobounce = providerConfig(
        env,
        "ZEROBOUNCE_API_KEY",
        "ZEROBOUNCE_COST_MICRO_USD",
      );
      const kickbox = providerConfig(
        env,
        "KICKBOX_API_KEY",
        "KICKBOX_COST_MICRO_USD",
      );
      return {
        ...(hunter === undefined ? {} : { hunter }),
        ...(zerobounce === undefined ? {} : { zerobounce }),
        ...(kickbox === undefined ? {} : { kickbox }),
        storePath:
          env["OPERATION_ROUTER_STORE_PATH"] ??
          "./results/live/executions.jsonl",
      };
    },
    catch: (error) =>
      error instanceof ConfigurationError
        ? error
        : new ConfigurationError("provider environment", "invalid_cost"),
  });
