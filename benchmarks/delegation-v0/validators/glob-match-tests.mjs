import { runValidator } from "./lib.mjs";
import { assertRepairedSuite } from "./mutation-suite.mjs";

await runValidator(async (repository) => {
  assertRepairedSuite(repository, {
    suitePath: "test/match.test.js",
    mutationTarget: "lib/glob-match.js",
    mutants: [
      {
        id: "matches-nothing",
        code: "globMatch.makeRe = () => /$^/;",
        requires: "at least one path that MUST match its pattern",
      },
      {
        id: "matches-everything",
        code: "globMatch.makeRe = () => /^.*$/;",
        requires: "at least one path that must NOT match its pattern",
      },
      {
        id: "scan-degenerate",
        code:
          'globMatch.scan = () => ({ prefix: "", input: "", start: 0, base: "", glob: "", ' +
          "isBrace: false, isBracket: false, isGlob: false, isExtglob: false, " +
          "isGlobstar: false, negated: false, negatedExtglob: false });",
        requires: "coverage of how scan splits a pattern into base and glob parts",
      },
      {
        id: "matchbase-always-true",
        code: "globMatch.matchBase = () => true;",
        requires: "a basename comparison that must NOT match",
      },
    ],
  });
});
