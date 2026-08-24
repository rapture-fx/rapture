import { expect, it } from "vitest";
import {
  detectIntegritySignals,
  type FileChange,
  hasWeakeningSignals,
} from "../src/signals/detect.js";

const clean = (path: string, before: string, after: string): FileChange => ({
  path,
  status: "modified",
  before,
  after,
});

it("detects deleted test files", () => {
  const signals = detectIntegritySignals([
    { path: "src/money.test.ts", status: "deleted", before: "expect(1).toBe(1);", after: null },
  ]);
  expect(signals.map((signal) => signal.kind)).toContain("test_file_deleted");
});

it("detects newly added skip markers", () => {
  const signals = detectIntegritySignals([
    clean("tests/pagination.test.ts", "it('works', () => {});", "it.skip('works', () => {});"),
  ]);
  const skipped = signals.find((signal) => signal.kind === "test_skipped");
  expect(skipped?.detail).toBe("1 skip marker(s) added");
});

it("detects xit-style skips in added files", () => {
  const signals = detectIntegritySignals([
    { path: "tests/new.test.ts", status: "added", before: null, after: "xit('later', () => {});" },
  ]);
  expect(signals.map((signal) => signal.kind)).toContain("test_skipped");
});

it("does not flag pre-existing skip markers", () => {
  const signals = detectIntegritySignals([
    clean(
      "tests/pagination.test.ts",
      "it.skip('old', () => {});\nit('works', () => {});",
      "it.skip('old', () => {});\nit('changed', () => {});",
    ),
  ]);
  expect(signals.filter((signal) => signal.kind === "test_skipped")).toEqual([]);
});

it("detects assertion count drops in test files", () => {
  const signals = detectIntegritySignals([
    clean(
      "src/money.spec.ts",
      "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);",
      "expect(a).toBe(1);",
    ),
  ]);
  const dropped = signals.find((signal) => signal.kind === "assertions_removed");
  expect(dropped?.detail).toBe("assertion count changed by -2");
});

it("does not flag assertion churn outside test files", () => {
  const signals = detectIntegritySignals([clean("src/app.ts", "expect(x);", "// removed")]);
  expect(signals.filter((signal) => signal.kind === "assertions_removed")).toEqual([]);
});

it("flags modifications to coverage and CI configuration", () => {
  const signals = detectIntegritySignals([
    clean("vitest.config.ts", "coverage: { thresholds: 80 }", "coverage: { thresholds: 10 }"),
    { path: ".github/workflows/ci.yml", status: "deleted", before: "jobs:", after: null },
    clean(".github/workflows/release.yml", "on: push", "on: push # tweaked"),
  ]);
  const kinds = signals.map((signal) => signal.kind);
  expect(kinds).toContain("verification_config_modified");
  expect(kinds).toContain("ci_workflow_deleted");
  expect(kinds).toContain("ci_workflow_modified");
});

it("detects exit-code suppression markers", () => {
  const signals = detectIntegritySignals([
    clean(
      "scripts/check.sh",
      "node validate.mjs",
      "node validate.mjs || true\nset +e\ncontinue-on-error: true",
    ),
  ]);
  const weakened = signals.find((signal) => signal.kind === "exit_code_handling_weakened");
  expect(weakened?.path).toBe("scripts/check.sh");
  expect(weakened?.detail).toBe("3 exit-code suppression marker(s) added");
});

it("flags protected verification files supplied by the caller", () => {
  const signals = detectIntegritySignals([clean("tools/validator.mjs", "a", "b")], {
    protectedPaths: ["tools/validator.mjs"],
  });
  expect(signals.map((signal) => signal.kind)).toContain("protected_file_modified");
});

it("flags new files created inside a protected surface", () => {
  const signals = detectIntegritySignals(
    [
      {
        path: "validation/new-check.mjs",
        status: "added",
        before: null,
        after: "process.exit(0);",
      },
    ],
    { protectedPaths: ["validation/**"] },
  );
  expect(signals.map((signal) => signal.kind)).toContain("protected_file_modified");
  expect(signals[0]?.detail).toBe("file created inside protected verification surface");
});

it("treats a deleted protected file as a deleted test/verification file", () => {
  const signals = detectIntegritySignals(
    [{ path: "validation/sku.ts", status: "deleted", before: "x", after: null }],
    { protectedPaths: ["validation/sku.ts"] },
  );
  expect(signals.map((signal) => signal.kind)).toEqual(["test_file_deleted"]);
});

it("returns nothing for an innocuous change set", () => {
  const signals = detectIntegritySignals([
    clean("src/feature.ts", "const a = 1;", "const a = 2;"),
    { path: "docs/readme.md", status: "added", before: null, after: "# docs" },
  ]);
  expect(signals).toEqual([]);
  expect(hasWeakeningSignals(signals)).toBe(false);
});

it("normalizes windows separators and leading ./", () => {
  const signals = detectIntegritySignals([
    { path: ".github\\workflows\\ci.yml", status: "modified", before: "a", after: "b" },
  ]);
  expect(signals[0]?.path).toBe(".github/workflows/ci.yml");
});

it("detects newly added lint/type suppression markers", () => {
  const signals = detectIntegritySignals([
    clean("src/parser.ts", "// ok", "// @ts-nocheck\n// eslint-disable no-unused-vars"),
    clean("src/other.py", "x = 1", "x = 1  # type: ignore  # noqa"),
  ]);
  const suppressed = signals.filter((signal) => signal.kind === "static_analysis_suppressed");
  expect(suppressed).toHaveLength(2);
  expect(suppressed[0]?.detail).toContain("2 lint/type-check");
});

it("does not flag pre-existing suppression markers", () => {
  const signals = detectIntegritySignals([
    clean("src/legacy.ts", "// eslint-disable eqeqeq\nfoo();", "// eslint-disable eqeqeq\nbar();"),
  ]);
  expect(signals.filter((signal) => signal.kind === "static_analysis_suppressed")).toEqual([]);
});

it("detects empty catch blocks added to non-test code", () => {
  const signals = detectIntegritySignals([
    clean("src/api.ts", "try { go(); } catch (e) { log(e); }", "try { go(); } catch (e) {}"),
    clean(
      "src/jobs.py",
      "try:\n    run()\nexcept Exception:\n    log(e)",
      "try:\n    run()\nexcept Exception:\n    pass",
    ),
  ]);
  const swallowed = signals.filter((signal) => signal.kind === "error_handling_suppressed");
  expect(swallowed).toHaveLength(2);
});

it("flags compiler strictness loosened in JSON config only", () => {
  const configSignals = detectIntegritySignals([
    clean("tsconfig.json", '"strict": true', '"strict": false'),
  ]);
  expect(configSignals.map((signal) => signal.kind)).toContain("static_analysis_suppressed");
  const proseSignals = detectIntegritySignals([
    clean("docs/notes.md", "strict: true", 'we set "strict": false now'),
  ]);
  expect(proseSignals.filter((signal) => signal.kind === "static_analysis_suppressed")).toEqual([]);
});
