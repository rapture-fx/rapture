import { describe, it, expect } from "vitest";
import { classifyFile, isTestFile, languageOf } from "../src/classify.js";
import { countAssertions, countSkips, extractTestBlocks } from "../src/parse.js";
import { analyzePullRequest, hasCoDeletedSubject } from "../src/rules.js";
import { computeMetrics } from "../src/evaluate.js";
import type { PullRequestInput } from "../src/types.js";

function pr(files: PullRequestInput["files"], all?: PullRequestInput["allChangedPaths"]) {
  return analyzePullRequest({
    repo: "acme/demo",
    prNumber: 1,
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    allChangedPaths: all ?? files.map((f) => ({ path: f.filename, status: f.status })),
    files,
  });
}

describe("file classification", () => {
  it("recognizes the ecosystems present in the frozen corpus", () => {
    expect(classifyFile("tests/unit/test_llm.py")).toBe("test");
    expect(classifyFile("e2e/cycle.spec.ts")).toBe("test");
    expect(classifyFile("lib/__tests__/mobile-dock.test.ts")).toBe("test");
    expect(classifyFile(".github/workflows/build.yml")).toBe("ci");
    expect(classifyFile("pyproject.toml")).toBe("test_config");
    expect(classifyFile("src/app/page.tsx")).toBe("other");
  });

  it("matches a hand-rolled harness at scripts/test-*.mjs", () => {
    // qmu/workaholic#747 in the corpus; missed by tests/-dir and .test. rules.
    expect(isTestFile("scripts/test-workflow-scripts.mjs")).toBe(true);
  });

  it("does not classify a component whose name merely contains 'test'", () => {
    // src/components/TestimonialCarousel.jsx in the corpus.
    expect(isTestFile("src/components/TestimonialCarousel.jsx")).toBe(false);
    expect(isTestFile("mobile/app/gps-test.tsx")).toBe(false);
  });

  it("detects language", () => {
    expect(languageOf("a/test_x.py")).toBe("python");
    expect(languageOf("a/x.spec.ts")).toBe("jsts");
    expect(languageOf("a/XTests.cs")).toBe("csharp");
  });
});

describe("parsing", () => {
  const py = [
    "def test_alpha():",
    "    assert a == 1",
    "    assert b == 2",
    "",
    "@pytest.mark.skip(reason='flaky')",
    "def test_beta():",
    "    assert c == 3",
  ].join("\n");

  it("extracts python blocks with per-block assertion counts", () => {
    const b = extractTestBlocks(py, "python");
    expect(b.map((x) => x.name)).toEqual(["test_alpha", "test_beta"]);
    expect(b[0]?.assertions).toBe(2);
    expect(b[1]?.skipped).toBe(true);
  });

  it("extracts js/ts blocks", () => {
    const ts = [
      "it('does a thing', () => {",
      "  expect(x).toBe(1);",
      "  expect(y).toBe(2);",
      "});",
      "it.skip('disabled', () => { expect(z).toBe(3); });",
    ].join("\n");
    const b = extractTestBlocks(ts, "jsts");
    expect(b[0]?.assertions).toBe(2);
    expect(b[1]?.skipped).toBe(true);
  });

  it("ignores assertions inside comments", () => {
    expect(countAssertions("// expect(x).toBe(1)\nexpect(y).toBe(2);", "jsts")).toBe(1);
    expect(countAssertions("# assert nope\nassert yes", "python")).toBe(1);
  });

  it("counts skip markers", () => {
    expect(countSkips(py)).toBe(1);
  });
});

describe("high-confidence rules", () => {
  it("flags a surviving test that lost assertions", () => {
    const base = "def test_a():\n    assert x == 1\n    assert y == 2\n";
    const head = "def test_a():\n    assert x == 1\n";
    const d = pr([
      {
        filename: "tests/test_a.py",
        previousFilename: null,
        status: "modified",
        baseContent: base,
        headContent: head,
      },
    ]);
    expect(d.materialWeakeningDetected).toBe(true);
    expect(d.signals[0]?.ruleId).toBe("R3_assertion_removed");
  });

  it("flags newly skipped tests", () => {
    const base = "def test_a():\n    assert x == 1\n";
    const head = "@pytest.mark.skip\ndef test_a():\n    assert x == 1\n";
    const d = pr([
      {
        filename: "tests/test_a.py",
        previousFilename: null,
        status: "modified",
        baseContent: base,
        headContent: head,
      },
    ]);
    expect(d.signals.some((s) => s.ruleId === "R2_test_disabled")).toBe(true);
  });

  it("flags a lowered coverage threshold", () => {
    const d = pr([
      {
        filename: "pyproject.toml",
        previousFilename: null,
        status: "modified",
        baseContent: "fail_under = 90\n",
        headContent: "fail_under = 60\n",
      },
    ]);
    expect(d.signals[0]?.ruleId).toBe("R5_coverage_threshold_lowered");
    expect(d.materialWeakeningDetected).toBe(true);
  });

  it("flags a removed CI test invocation", () => {
    const d = pr([
      {
        filename: ".github/workflows/ci.yml",
        previousFilename: null,
        status: "modified",
        baseContent: "steps:\n  - run: pytest -q\n  - run: ruff check .\n",
        headContent: "steps:\n  - run: ruff check .\n",
      },
    ]);
    expect(d.signals[0]?.ruleId).toBe("R6_ci_test_job_removed");
  });
});

describe("no-false-positive cases taken from the frozen corpus", () => {
  it("does not flag assertions whose expected values were updated", () => {
    // uist1idrju3i/acd-agent#233 tests/adapters/cad/test_project.py (+2/-2)
    const base = [
      "def test_projection_exports():",
      "    assert report.shell_volume_mm3 == pytest.approx(4567.86193, abs=1e-3)",
      "    assert report.lid_volume_mm3 == pytest.approx(2232.0, abs=1e-3)",
    ].join("\n");
    const head = [
      "def test_projection_exports():",
      "    assert report.shell_volume_mm3 == pytest.approx(4493.532021, abs=1e-3)",
      "    assert report.lid_volume_mm3 == pytest.approx(2201.589383, abs=1e-3)",
    ].join("\n");
    const d = pr([
      {
        filename: "tests/adapters/cad/test_project.py",
        previousFilename: null,
        status: "modified",
        baseContent: base,
        headContent: head,
      },
    ]);
    expect(d.materialWeakeningDetected).toBe(false);
    expect(d.signals).toHaveLength(0);
  });

  it("does not flag a test file deleted together with its subject", () => {
    // FloorLamp/allos#4168 deleted the /timeline route and its specs.
    const d = pr(
      [
        {
          filename: "lib/__tests__/timeline-card-surface.test.ts",
          previousFilename: null,
          status: "removed",
          baseContent: "it('renders', () => { expect(a).toBe(1); });",
          headContent: null,
        },
      ],
      [
        { path: "lib/__tests__/timeline-card-surface.test.ts", status: "removed" },
        { path: "lib/timeline-card-surface.ts", status: "removed" },
      ],
    );
    expect(d.materialWeakeningDetected).toBe(false);
    expect(d.signals[0]?.ruleId).toBe("R1b_test_file_deleted_with_subject");
  });

  it("still flags a test file deleted with its subject left in place", () => {
    const d = pr(
      [
        {
          filename: "lib/__tests__/payments.test.ts",
          previousFilename: null,
          status: "removed",
          baseContent: "it('charges', () => { expect(a).toBe(1); });",
          headContent: null,
        },
      ],
      [{ path: "lib/__tests__/payments.test.ts", status: "removed" }],
    );
    expect(d.materialWeakeningDetected).toBe(true);
    expect(d.signals[0]?.ruleId).toBe("R1_test_file_deleted");
  });

  it("does not flag a pure test addition", () => {
    // OpenHands/OpenHands#9666 added a new test, +39/-0.
    const d = pr([
      {
        filename: "tests/unit/test_llm.py",
        previousFilename: null,
        status: "modified",
        baseContent: "def test_a():\n    assert x\n",
        headContent: "def test_a():\n    assert x\n\ndef test_b():\n    assert y\n",
      },
    ]);
    expect(d.materialWeakeningDetected).toBe(false);
  });

  it("treats an unattributable file-level drop as contextual, not material", () => {
    const d = pr([
      {
        filename: "tests/Thing.cs",
        previousFilename: null,
        status: "modified",
        baseContent: "Assert.True(a);\nAssert.True(b);\n",
        headContent: "Assert.True(a);\n",
      },
    ]);
    expect(d.materialWeakeningDetected).toBe(false);
    expect(d.signals[0]?.confidence).toBe("contextual");
  });
});

describe("co-deletion detection", () => {
  it("matches a test to its source stem", () => {
    expect(
      hasCoDeletedSubject("lib/__tests__/mobile-dock.test.ts", [
        { path: "lib/mobile-dock.ts", status: "removed" },
      ]),
    ).toBe(true);
  });
  it("does not match unrelated deletions", () => {
    expect(
      hasCoDeletedSubject("lib/__tests__/payments.test.ts", [
        { path: "docs/readme.md", status: "removed" },
      ]),
    ).toBe(false);
  });
});

describe("metrics", () => {
  it("returns null precision when the detector fires on nothing", () => {
    const m = computeMetrics([
      { label: "NON_MATERIAL_CHANGE", detected: false },
      { label: "NO_VERIFICATION_CHANGE", detected: false },
    ]);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.trueNegatives).toBe(2);
  });

  it("computes a normal confusion matrix", () => {
    const m = computeMetrics([
      { label: "MATERIAL_WEAKENING", detected: true },
      { label: "MATERIAL_WEAKENING", detected: false },
      { label: "NON_MATERIAL_CHANGE", detected: true },
      { label: "NO_VERIFICATION_CHANGE", detected: false },
    ]);
    expect(m.truePositives).toBe(1);
    expect(m.falseNegatives).toBe(1);
    expect(m.falsePositives).toBe(1);
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBeCloseTo(0.5);
  });

  it("excludes UNCLEAR from scoring", () => {
    const m = computeMetrics([{ label: "UNCLEAR", detected: true }]);
    expect(m.unclear).toBe(1);
    expect(m.truePositives + m.falsePositives).toBe(0);
  });
});

describe("tuning pass 1: renamed files downgrade assertion loss", () => {
  it("downgrades assertion loss in a renamed file to medium", () => {
    // FloorLamp/allos#4168: timeline-windowing.spec.ts -> history-windowing.spec.ts
    // dropped one assertion about a fold the same PR retired.
    const base = "test('x', () => {\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});";
    const head = "test('x', () => {\n  expect(a).toBe(1);\n});";
    const d = pr([
      {
        filename: "e2e/history-windowing.spec.ts",
        previousFilename: "e2e/timeline-windowing.spec.ts",
        status: "renamed",
        baseContent: base,
        headContent: head,
      },
    ]);
    expect(d.signals[0]?.ruleId).toBe("R3_assertion_removed");
    expect(d.signals[0]?.confidence).toBe("medium");
    expect(d.materialWeakeningDetected).toBe(false);
  });

  it("keeps assertion loss high-confidence when the file was not renamed", () => {
    const base = "test('x', () => {\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});";
    const head = "test('x', () => {\n  expect(a).toBe(1);\n});";
    const d = pr([
      {
        filename: "e2e/payments.spec.ts",
        previousFilename: null,
        status: "modified",
        baseContent: base,
        headContent: head,
      },
    ]);
    expect(d.signals[0]?.confidence).toBe("high");
    expect(d.materialWeakeningDetected).toBe(true);
  });
});
