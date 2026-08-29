const SECRET_ENV_KEYS = new Set([
  "OPENCODE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_API_KEY",
  "GOOGLE_API_KEY",
  "SECRET",
  "PASSWORD",
  "TOKEN",
]);

const KNOWN_SECRET_PATTERNS: readonly RegExp[] = [
  /(authorization:\s*bearer\s+)[^\s]+/giu,
  /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/giu,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

export function redactString(value: string): string {
  let out = value;
  for (const re of KNOWN_SECRET_PATTERNS) {
    out = out.replace(re, (_m, g1?: string) => (g1 ? `${g1}[REDACTED]` : "[REDACTED]"));
  }
  return out;
}

export function redactEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const upper = k.toUpperCase();
    const isSecret =
      SECRET_ENV_KEYS.has(upper) ||
      upper.includes("SECRET") ||
      upper.includes("PASSWORD") ||
      upper.includes("TOKEN") ||
      upper.endsWith("_KEY");
    // be conservative: redact if key matches but still include key name
    if (isSecret) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactString(v);
    }
  }
  return out;
}

export function shouldPersistTaskText(disableTaskText: boolean): boolean {
  return !disableTaskText;
}

import { createHash as createHashCrypto } from "node:crypto";

export function hashTask(task: string): string {
  return createHashCrypto("sha256").update(task, "utf8").digest("hex");
}

export function redactRecord(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactRecord);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes("authorization") ||
        lower.includes("api_key") ||
        lower.includes("apikey") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("token")
      ) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactRecord(v);
      }
    }
    return out;
  }
  return value;
}
