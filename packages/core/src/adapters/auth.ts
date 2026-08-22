export const CODEX_CREDENTIAL_ENV_VARS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
] as const;

export const OPENCODE_CREDENTIAL_ENV_VARS = ["OPENCODE_API_KEY"] as const;

export const REAL_SCALE_2_CREDENTIALS_MISSING = "REAL_SCALE_2_CREDENTIALS_MISSING";

export type CodexCredentialEnvVar = (typeof CODEX_CREDENTIAL_ENV_VARS)[number];
export type OpenCodeCredentialEnvVar = (typeof OPENCODE_CREDENTIAL_ENV_VARS)[number];

export interface AgentCredentialProbe {
  readonly required: boolean;
  readonly present: boolean;
  readonly envVar: string | null;
  readonly method: "api-key" | "access-token" | "chatgpt" | "opencode" | null;
  readonly supportedEnvVars: readonly string[];
}

function nonemptySecret(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function detectCodexCredentialPresence(
  env: Readonly<Record<string, string | undefined>>,
): AgentCredentialProbe {
  const openai = nonemptySecret(env.OPENAI_API_KEY);
  if (openai !== null) {
    return {
      required: true,
      present: true,
      envVar: "OPENAI_API_KEY",
      method: "api-key",
      supportedEnvVars: CODEX_CREDENTIAL_ENV_VARS,
    };
  }
  const codexKey = nonemptySecret(env.CODEX_API_KEY);
  if (codexKey !== null) {
    return {
      required: true,
      present: true,
      envVar: "CODEX_API_KEY",
      method: "api-key",
      supportedEnvVars: CODEX_CREDENTIAL_ENV_VARS,
    };
  }
  const accessToken = nonemptySecret(env.CODEX_ACCESS_TOKEN);
  if (accessToken !== null) {
    return {
      required: true,
      present: true,
      envVar: "CODEX_ACCESS_TOKEN",
      method: "access-token",
      supportedEnvVars: CODEX_CREDENTIAL_ENV_VARS,
    };
  }
  return {
    required: true,
    present: false,
    envVar: null,
    method: null,
    supportedEnvVars: CODEX_CREDENTIAL_ENV_VARS,
  };
}

export function detectOpenCodeCredentialPresence(
  env: Readonly<Record<string, string | undefined>>,
): AgentCredentialProbe {
  const apiKey = nonemptySecret(env.OPENCODE_API_KEY);
  if (apiKey !== null) {
    return {
      required: true,
      present: true,
      envVar: "OPENCODE_API_KEY",
      method: "api-key",
      supportedEnvVars: OPENCODE_CREDENTIAL_ENV_VARS,
    };
  }
  return {
    required: true,
    present: false,
    envVar: null,
    method: null,
    supportedEnvVars: OPENCODE_CREDENTIAL_ENV_VARS,
  };
}

export function fakeCredentialProbe(): AgentCredentialProbe {
  return {
    required: false,
    present: true,
    envVar: null,
    method: null,
    supportedEnvVars: [],
  };
}

export function credentialValuesForLeakCheck(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return [...CODEX_CREDENTIAL_ENV_VARS, ...OPENCODE_CREDENTIAL_ENV_VARS]
    .map((name) => nonemptySecret(env[name]))
    .filter((value): value is string => value !== null);
}
