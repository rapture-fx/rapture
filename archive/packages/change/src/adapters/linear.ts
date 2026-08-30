import type { Intent } from "../schema/change.js";
import type { NormalizedRecords, ProviderAdapter, RawSnapshot } from "./contracts.js";

export interface LinearIssueRaw {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly branchName?: string | null;
}

function intentId(externalId: string): string {
  return `intent_linear_${externalId}`;
}

export function normalizeLinearIssue(raw: LinearIssueRaw): Intent {
  return {
    id: intentId(raw.identifier),
    source: "linear",
    externalId: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    url: raw.url,
  };
}

export function extractLinearId(text: string): string | null {
  const match = text.match(/\b([A-Z]+-\d+)\b/);
  return match ? (match[1] ?? null) : null;
}

export const linearAdapter: ProviderAdapter = {
  provider: "linear",
  normalize(raw: RawSnapshot): NormalizedRecords {
    const data = raw.data as Record<string, unknown>;
    if (typeof data["identifier"] === "string" && typeof data["title"] === "string") {
      const intent = normalizeLinearIssue(data as unknown as LinearIssueRaw);
      return { intents: [intent] };
    }
    return {};
  },
};
