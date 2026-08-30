import { classifyFile, languageOf } from "./classify.js";
import { countAssertions, countSkips, extractTestBlocks } from "./parse.js";
import { DETECTOR_VERSION } from "./types.js";
import type {
  ChangedFile,
  PullRequestInput,
  VerificationSignal,
  VerificationSurfaceDelta,
} from "./types.js";

/**
 * Does the PR also delete the source this test file appears to cover?
 *
 * Deleting `foo.test.ts` alongside `foo.ts` removes a check whose subject is
 * gone, which is not a loss of verification capability. The calibration corpus
 * had exactly this case (a route deleted together with its specs), and without
 * this guard the highest-confidence rule fires on it.
 */
export function hasCoDeletedSubject(
  testPath: string,
  allChangedPaths: readonly { path: string; status: string }[],
): boolean {
  const removed = allChangedPaths.filter((p) => p.status === "removed").map((p) => p.path);
  if (removed.length === 0) return false;
  const base = (testPath.split("/").pop() ?? "")
    .replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, "")
    .replace(/^test_/, "")
    .replace(/_test$/, "")
    .replace(/\.[a-z0-9]+$/i, "");
  if (base.length < 3) return false;
  const stem = base.toLowerCase();
  return removed.some((r) => {
    const rBase = (r.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").toLowerCase();
    if (rBase === stem) return true;
    // A route/page deletion is named for its directory, not its file.
    const rDir = r.split("/").slice(0, -1).pop()?.toLowerCase() ?? "";
    return rDir !== "" && (rDir === stem || stem.startsWith(rDir) || rDir.startsWith(stem));
  });
}

function coverageThresholds(content: string): number[] {
  const out: number[] = [];
  for (const m of content.matchAll(
    /(?:fail[_-]?under|minimum|threshold|branches|statements|lines|functions)\s*[:=]\s*(\d{1,3})(?:\.\d+)?/gi,
  )) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v <= 100) out.push(v);
  }
  return out;
}

function ciTestSteps(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!/^-?\s*(run|script)\s*:/.test(t) && !/^\s*-\s+/.test(t)) continue;
    if (
      /\b(pytest|jest|vitest|go test|cargo test|mvn test|npm (run )?test|pnpm (run )?-?r? ?test|yarn test|dotnet test|tox|nox)\b/.test(
        t,
      )
    )
      out.push(t.replace(/\s+/g, " ").slice(0, 160));
  }
  return out;
}

export function analyzeFile(
  file: ChangedFile,
  pr: PullRequestInput,
): readonly VerificationSignal[] {
  const signals: VerificationSignal[] = [];
  const cls = classifyFile(file.filename);
  const lang = languageOf(file.filename);

  if (cls === "test") {
    if (file.status === "removed") {
      const coDeleted = hasCoDeletedSubject(file.filename, pr.allChangedPaths);
      const before = file.baseContent === null ? 0 : countAssertions(file.baseContent, lang);
      if (!coDeleted) {
        signals.push({
          kind: "test_file_deleted",
          confidence: "high",
          file: file.filename,
          before,
          after: 0,
          evidence: `test file deleted; ${before} assertion(s) removed with no co-deleted subject found`,
          ruleId: "R1_test_file_deleted",
        });
      } else {
        signals.push({
          kind: "test_file_deleted_with_subject",
          confidence: "contextual",
          file: file.filename,
          before,
          after: 0,
          evidence: `test file deleted alongside its subject; treated as co-deletion, not weakening`,
          ruleId: "R1b_test_file_deleted_with_subject",
        });
      }
      return signals;
    }

    const base = file.baseContent ?? "";
    const head = file.headContent ?? "";
    if (file.status !== "added" && base !== "") {
      const skipBefore = countSkips(base);
      const skipAfter = countSkips(head);
      if (skipAfter > skipBefore) {
        signals.push({
          kind: "test_disabled",
          confidence: "high",
          file: file.filename,
          before: skipBefore,
          after: skipAfter,
          evidence: `skip/ignore markers increased from ${skipBefore} to ${skipAfter}`,
          ruleId: "R2_test_disabled",
        });
      }

      const blocksBefore = extractTestBlocks(base, lang);
      const blocksAfter = extractTestBlocks(head, lang);
      if (blocksBefore.length > 0) {
        const afterByName = new Map(blocksAfter.map((b) => [b.name, b]));
        for (const b of blocksBefore) {
          const a = afterByName.get(b.name);
          if (a === undefined) continue; // renamed/removed block: not attributable
          if (a.assertions < b.assertions) {
            // TUNING PASS 1: a file renamed in the same PR is being restructured,
            // and an assertion that disappears with it is as likely to have lost
            // its subject as to have been silenced. Observed on
            // FloorLamp/allos#4168, where e2e/timeline-windowing.spec.ts became
            // history-windowing.spec.ts and dropped an assertion about a fold the
            // PR retired. Distinguishing the two needs semantic knowledge the
            // detector does not have, so a rename downgrades to medium.
            const renamed = file.status === "renamed" || file.previousFilename !== null;
            signals.push({
              kind: "assertion_removed",
              confidence: renamed ? "medium" : "high",
              file: file.filename,
              before: b.assertions,
              after: a.assertions,
              evidence: renamed
                ? `test "${b.name}" lost ${b.assertions - a.assertions} assertion(s) in a file renamed from ${file.previousFilename ?? "unknown"}; subject may have been restructured`
                : `test "${b.name}" lost ${b.assertions - a.assertions} assertion(s) while remaining present`,
              ruleId: "R3_assertion_removed",
            });
          }
        }
      } else {
        // No block structure recognized: fall back to a whole-file count, which
        // cannot attribute the loss to a surviving test, so it stays contextual.
        const ab = countAssertions(base, lang);
        const aa = countAssertions(head, lang);
        if (aa < ab) {
          signals.push({
            kind: "assertion_count_reduced_file",
            confidence: "contextual",
            file: file.filename,
            before: ab,
            after: aa,
            evidence: `file-level assertion count fell ${ab} -> ${aa}; no block structure parsed for ${lang}`,
            ruleId: "R4_assertion_count_reduced_file",
          });
        }
      }
    }
    return signals;
  }

  if (cls === "test_config") {
    const before = coverageThresholds(file.baseContent ?? "");
    const after = coverageThresholds(file.headContent ?? "");
    if (before.length > 0 && after.length > 0) {
      const maxBefore = Math.max(...before);
      const maxAfter = Math.max(...after);
      if (maxAfter < maxBefore) {
        signals.push({
          kind: "coverage_threshold_lowered",
          confidence: "high",
          file: file.filename,
          before: maxBefore,
          after: maxAfter,
          evidence: `configured coverage threshold lowered ${maxBefore} -> ${maxAfter}`,
          ruleId: "R5_coverage_threshold_lowered",
        });
      }
    }
    return signals;
  }

  if (cls === "ci") {
    const before = ciTestSteps(file.baseContent ?? "");
    const after = ciTestSteps(file.headContent ?? "");
    const lost = before.filter((s) => !after.includes(s));
    if (file.status !== "added" && lost.length > 0 && after.length < before.length) {
      signals.push({
        kind: "ci_test_job_removed",
        confidence: "high",
        file: file.filename,
        before: before.length,
        after: after.length,
        evidence: `CI test invocation(s) removed: ${lost.slice(0, 2).join(" | ")}`,
        ruleId: "R6_ci_test_job_removed",
      });
    }
    return signals;
  }

  return signals;
}

export function analyzePullRequest(pr: PullRequestInput): VerificationSurfaceDelta {
  const signals = pr.files.flatMap((f) => analyzeFile(f, pr));
  const high = signals.filter((s) => s.confidence === "high").length;
  const medium = signals.filter((s) => s.confidence === "medium").length;
  return {
    repo: pr.repo,
    prNumber: pr.prNumber,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    signals,
    highConfidenceCount: high,
    mediumConfidenceCount: medium,
    // Contextual signals alone never classify a PR as materially weakened.
    materialWeakeningDetected: high > 0,
    detectorVersion: DETECTOR_VERSION,
  };
}
