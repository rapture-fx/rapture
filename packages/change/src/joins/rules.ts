export const JOIN_RULES = {
  PR_COMMIT: "pr.commit.merge_sha",
  CHECK_COMMIT: "check.commit.head_sha",
  DEPLOYMENT_COMMIT: "deployment.commit.sha",
  SENTRY_RELEASE_COMMIT: "sentry.release.version_sha",
  LINEAR_PR_BRANCH: "linear.pr.branch",
  LINEAR_PR_TITLE: "linear.pr.title",
  LINEAR_PR_BODY: "linear.pr.body",
} as const;

export type JoinRule = (typeof JOIN_RULES)[keyof typeof JOIN_RULES];

export interface JoinProvenance {
  readonly rule: JoinRule;
  readonly sourceIds: readonly string[];
  readonly constructedAt: string;
}

export function provenance(rule: JoinRule, sourceIds: readonly string[]): JoinProvenance {
  return {
    rule,
    sourceIds,
    constructedAt: new Date().toISOString(),
  };
}
