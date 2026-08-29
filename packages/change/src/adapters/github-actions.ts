import type { Check } from "../schema/change.js";
import type { NormalizedRecords, ProviderAdapter, RawSnapshot } from "./contracts.js";

export interface GitHubActionsRunRaw {
  readonly id: number | string;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly head_sha: string;
  readonly html_url: string;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}

function mapStatus(status: string, conclusion: string | null): Check["status"] {
  if (status === "queued") return "queued";
  if (status === "in_progress" || status === "running") return "running";
  if (status === "completed") {
    if (conclusion === "success") return "passed";
    if (conclusion === "failure") return "failed";
    if (conclusion === "cancelled") return "cancelled";
    return "unknown";
  }
  return "unknown";
}

function checkId(externalId: string): string {
  return `check_github_actions_${externalId}`;
}

export function normalizeCheck(raw: GitHubActionsRunRaw): Check {
  return {
    id: checkId(String(raw.id)),
    provider: "github_actions",
    name: raw.name,
    status: mapStatus(raw.status, raw.conclusion),
    commitSha: raw.head_sha,
    startedAt: raw.created_at,
    completedAt: raw.updated_at,
    url: raw.html_url ?? null,
  };
}

export const githubActionsAdapter: ProviderAdapter = {
  provider: "github_actions",
  normalize(raw: RawSnapshot): NormalizedRecords {
    const data = raw.data as Record<string, unknown>;
    // Single run
    if (typeof data["head_sha"] === "string" && (typeof data["id"] === "number" || typeof data["id"] === "string")) {
      const check = normalizeCheck(data as unknown as GitHubActionsRunRaw);
      return { checks: [check] };
    }
    // Workflow runs array
    if (Array.isArray((data as Record<string, unknown>)["workflow_runs"])) {
      const runs = (data as Record<string, unknown>)["workflow_runs"] as GitHubActionsRunRaw[];
      return { checks: runs.map(normalizeCheck) };
    }
    // Check runs array (from /commits/.../check-runs)
    if (Array.isArray((data as Record<string, unknown>)["check_runs"])) {
      const runs = (data as Record<string, unknown>)["check_runs"] as GitHubActionsRunRaw[];
      return { checks: runs.map(normalizeCheck) };
    }
    return {};
  },
};
