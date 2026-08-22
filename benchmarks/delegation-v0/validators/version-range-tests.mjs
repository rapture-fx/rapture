import { runValidator } from "./lib.mjs";
import { assertRepairedSuite } from "./mutation-suite.mjs";

await runValidator(async (repository) => {
  assertRepairedSuite(repository, {
    suitePath: "test/range.test.js",
    mutationTarget: "classes/range.js",
    mutants: [
      {
        id: "range-test-always-true",
        code: "Range.prototype.test = function () { return true };",
        requires: "at least one version that must NOT satisfy a range",
      },
      {
        id: "range-test-always-false",
        code: "Range.prototype.test = function () { return false };",
        requires: "at least one version that MUST satisfy a range",
      },
      {
        id: "range-intersects-always-true",
        code: "Range.prototype.intersects = function () { return true };",
        requires: "a pair of ranges that must NOT intersect",
      },
      {
        id: "range-intersects-always-false",
        code: "Range.prototype.intersects = function () { return false };",
        requires: "a pair of ranges that MUST intersect",
      },
    ],
  });
});
