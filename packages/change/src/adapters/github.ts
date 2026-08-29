import type { Commit, PullRequest } from "../schema/change.js";
import type { NormalizedRecords, ProviderAdapter, RawSnapshot } from "./contracts.js";

export interface GitHubPrRaw {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url: string;
  readonly merged_at: string | null;
  readonly merge_commit_sha: string | null;
  readonly head: { readonly sha: string };
  readonly base: { readonly repo: { readonly full_name: string } };
  readonly user?: unknown;
}

export interface GitHubCommitRaw {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly date: string | null } | null;
  };
  readonly html_url?: string;
}

function prId(repo: string, number: number): string {
  return `pr_github_${repo.replace(/[^a-zA-Z0-9]/g, "-")}_${number}`;
}

function commitId(sha: string): string {
  return `commit_${sha}`;
}

export function normalizePr(repo: string, raw: GitHubPrRaw): PullRequest {
  return {
    id: prId(repo, raw.number),
    provider: "github",
    repository: repo,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    mergedAt: raw.merged_at,
    mergeCommitSha: raw.merge_commit_sha,
    url: raw.html_url,
  };
}

export function normalizeCommit(repo: string, raw: GitHubCommitRaw): Commit {
  return {
    id: commitId(raw.sha),
    sha: raw.sha,
    repository: repo,
    message: raw.commit.message ?? null,
    authoredAt: raw.commit.author?.date ?? null,
  };
}

export const githubAdapter: ProviderAdapter = {
  provider: "github",
  normalize(raw: RawSnapshot): NormalizedRecords {
    const data = raw.data as Record<string, unknown>;
    // Heuristic: if data has "number" and "html_url" it's a PR, if has "sha" and "commit" it's a commit
    if (typeof data["number"] === "number" && typeof data["html_url"] === "string") {
      const repo = (data["repository"] as string) || (raw.externalId.split("#")[0] ?? "unknown/unknown");
      const pr = normalizePr(repo, data as unknown as GitHubPrRaw);
      return { pullRequests: [pr] };
    }
    if (typeof data["sha"] === "string" && typeof data["commit"] === "object") {
      const repo = (data["repository"] as string) || (raw.externalId.split("/")[0] ?? "unknown/unknown");
      const commit = normalizeCommit(repo, data as unknown as GitHubCommitRaw);
      return { commits: [commit] };
    }
    return {};
  },
};
