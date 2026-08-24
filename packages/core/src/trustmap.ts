import {
  emptyInvariants,
  globToRegExp,
  type InvariantsConfig,
  invariantsToDetectorOptions,
  isLikelyTestFile,
  type VerificationSurfaceKind,
  verificationSurfaceKind,
} from "@rapture/kernel";
import { runGit } from "./git.js";

export interface TrustMapRow {
  readonly claim: string;
  readonly evidenceSurface: string;
  readonly surfaceFiles: readonly string[];
  readonly agentModifiable: boolean;
  readonly independent: boolean;
}

export interface TrustMap {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly ref: string;
  readonly generatedAt: string;
  readonly rows: readonly TrustMapRow[];
}

async function listFilesAt(repository: string, ref: string): Promise<readonly string[]> {
  const result = await runGit(repository, ["ls-tree", "-r", "--name-only", "-z", ref]);
  return result.stdout
    .split("\0")
    .filter((path) => path.trim().length > 0)
    .sort();
}

function groupByKind(
  files: readonly string[],
  detectorOptions: ReturnType<typeof invariantsToDetectorOptions>,
): Readonly<Record<VerificationSurfaceKind, readonly string[]>> {
  const groups: Record<VerificationSurfaceKind, string[]> = {
    test: [],
    ci: [],
    "coverage-config": [],
    unknown: [],
  };
  for (const file of files) {
    let kind = verificationSurfaceKind(file);
    if (kind === "unknown" && isLikelyTestFile(file, detectorOptions)) kind = "test";
    groups[kind].push(file);
  }
  return groups;
}

const MAX_SAMPLE_PATHS = 3;

function samplePaths(paths: readonly string[]): string {
  if (paths.length === 0) return "none found";
  if (paths.length <= MAX_SAMPLE_PATHS) return paths.join(", ");
  return `${paths.slice(0, MAX_SAMPLE_PATHS).join(", ")}, +${paths.length - MAX_SAMPLE_PATHS} more`;
}

export async function buildTrustMap(input: {
  readonly repository: string;
  readonly ref?: string;
  readonly invariants?: InvariantsConfig;
}): Promise<TrustMap> {
  const invariants = input.invariants ?? emptyInvariants();
  const detectorOptions = invariantsToDetectorOptions(invariants);
  const ref = input.ref ?? "HEAD";
  const files = await listFilesAt(input.repository, ref);
  const groups = groupByKind(files, detectorOptions);
  const protectedGlobs = invariants.protectedPaths;

  const isProtected = (file: string): boolean =>
    protectedGlobs.some((pattern) => globMatches(pattern, file));

  const rows: TrustMapRow[] = [
    {
      claim: "Tests pass ⇒ behavior verified",
      evidenceSurface: `${groups.test.length} test file(s): ${samplePaths(groups.test)}`,
      surfaceFiles: groups.test,
      agentModifiable: groups.test.some((file) => !isProtected(file)),
      independent: false,
    },
    {
      claim: "CI checks pass ⇒ change accepted",
      evidenceSurface: `${groups.ci.length} workflow file(s): ${samplePaths(groups.ci)}`,
      surfaceFiles: groups.ci,
      agentModifiable: groups.ci.some((file) => !isProtected(file)),
      independent: false,
    },
    {
      claim: "Coverage thresholds hold ⇒ regressions caught",
      evidenceSurface:
        groups["coverage-config"].length > 0
          ? `config file(s): ${samplePaths(groups["coverage-config"])}`
          : "none found — no coverage enforcement detected",
      surfaceFiles: groups["coverage-config"],
      agentModifiable: groups["coverage-config"].length > 0,
      independent: false,
    },
    {
      claim: "Protected validators/verification surfaces",
      evidenceSurface:
        protectedGlobs.length > 0
          ? `declared: ${protectedGlobs.join(", ")}`
          : "none declared — declare via .rapture/invariants.json",
      surfaceFiles: files.filter((file) => isProtected(file)),
      agentModifiable: protectedGlobs.length === 0,
      independent: protectedGlobs.length > 0,
    },
    {
      claim: "Independent oracle exists for changed behavior",
      evidenceSurface: "requires external execution evidence; not derivable from repo alone",
      surfaceFiles: [],
      agentModifiable: false,
      independent: false,
    },
  ];
  return {
    schemaVersion: 1,
    repository: input.repository,
    ref,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

function globMatches(pattern: string, path: string): boolean {
  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(path);
  }
  return path === pattern || path.startsWith(`${pattern}/`);
}

export function formatTrustMapMarkdown(map: TrustMap): string {
  const lines: string[] = [];
  lines.push("# Verification Trust Map");
  lines.push("");
  lines.push(
    `**Repository:** \`${map.repository}\` · **Ref:** \`${map.ref}\` · **Generated:** ${map.generatedAt}`,
  );
  lines.push("");
  lines.push("| Claim | Evidence surface | Agent-modifiable | Independent |");
  lines.push("|---|---|---|---|");
  for (const row of map.rows) {
    lines.push(
      `| ${row.claim} | ${row.evidenceSurface} | ${row.agentModifiable ? "⚠️ Yes" : "No"} | ${row.independent ? "✅" : "❌"} |`,
    );
  }
  lines.push("");
  const modifiableClaims = map.rows.filter((row) => row.agentModifiable).length;
  if (modifiableClaims > 0) {
    lines.push(
      `> ⚠️ ${modifiableClaims} acceptance claim(s) rest on evidence the agent can modify. Weakening any of these surfaces makes the corresponding check pass without meaning what it appears to mean.`,
    );
  } else {
    lines.push("> ✅ No agent-modifiable acceptance claims detected.");
  }
  return `${lines.join("\n")}\n`;
}
