import { expect, it } from "vitest";
import {
  changesWithInvariantContext,
  emptyInvariants,
  filterIgnoredSignals,
  invariantsToDetectorOptions,
  isIgnoredPath,
  parseInvariants,
} from "../src/signals/invariants.js";
import { globToRegExp } from "../src/signals/glob.js";
import { detectIntegritySignals } from "../src/signals/detect.js";

it("translates glob patterns to anchored regexes", () => {
  const pattern = globToRegExp("tests/**/*.test.ts");
  expect(pattern.test("tests/a/b.test.ts")).toBe(true);
  expect(pattern.test("tests/root.test.ts")).toBe(true);
  expect(pattern.test("src/tests/a.test.ts")).toBe(true);
  expect(pattern.test("tests/a/b.spec.ts")).toBe(false);

  const single = globToRegExp("src/*.ts");
  expect(single.test("src/app.ts")).toBe(true);
  expect(single.test("src/sub/app.ts")).toBe(false);

  const protectedGlob = globToRegExp("validation/**");
  expect(protectedGlob.test("validation/sku.ts")).toBe(true);
  expect(protectedGlob.test("src/validation/sku.ts")).toBe(true);
});

it("parses and rejects invariant configs", () => {
  const parsed = parseInvariants({
    schemaVersion: 1,
    protectedPaths: ["validation/**"],
    testFilePatterns: ["suites/**/*.spec.ts"],
    ignorePaths: ["vendor/**", "generated/*"],
  });
  expect(parsed.protectedPaths).toEqual(["validation/**"]);
  expect(parsed.ignorePaths).toEqual(["vendor/**", "generated/*"]);

  expect(() => parseInvariants({ schemaVersion: 2 })).toThrow();
  expect(() => parseInvariants({ schemaVersion: 1, unknownKey: true })).toThrow();
  expect(() => parseInvariants({ schemaVersion: 1, protectedPaths: [42] })).toThrow();
});

it("converts invariants into detector options", () => {
  const config = parseInvariants({
    schemaVersion: 1,
    protectedPaths: ["tools/verify.mjs"],
    testFilePatterns: ["suites/**/*.spec.ts"],
  });
  const options = invariantsToDetectorOptions(config);
  expect(options.protectedPaths).toContain("tools/verify.mjs");
  expect(options.testFilePatterns?.[0]?.test("suites/deep/x.spec.ts")).toBe(true);

  expect(invariantsToDetectorOptions(emptyInvariants())).toEqual({});
});

it("suppresses signals on ignored paths only", () => {
  const config = parseInvariants({
    schemaVersion: 1,
    ignorePaths: ["vendor/**"],
  });
  const changes = [
    {
      path: "vendor/lib/index.js",
      status: "added" as const,
      before: null,
      after: "process.exit(0) || true",
    },
    {
      path: "scripts/run.sh",
      status: "modified" as const,
      before: "node x",
      after: "node x || true",
    },
  ];
  const signals = detectIntegritySignals(changes);
  const filtered = filterIgnoredSignals(signals, config);
  expect(filtered.map((signal) => signal.path)).toEqual(["scripts/run.sh"]);
  expect(isIgnoredPath("vendor/new/thing.js", config)).toBe(true);
  expect(isIgnoredPath("src/app.ts", config)).toBe(false);
  expect(filterIgnoredSignals(signals, emptyInvariants())).toHaveLength(
    signals.length,
  );
  void changesWithInvariantContext;
});
