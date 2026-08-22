import { runValidator } from "./lib.mjs";
import { assertRepairedSuite } from "./mutation-suite.mjs";

await runValidator(async (repository) => {
  assertRepairedSuite(repository, {
    suitePath: "test/option.test.js",
    mutationTarget: "lib/option.js",
    mutants: [
      {
        id: "option-matches-any-flag",
        code: "Option.prototype.is = () => true;",
        requires: "a flag an option must NOT recognise",
      },
      {
        id: "option-matches-no-flag",
        code: "Option.prototype.is = () => false;",
        requires: "a flag an option MUST recognise",
      },
      {
        id: "attribute-name-constant",
        code: 'Option.prototype.attributeName = function () { return "mutated"; };',
        requires: "coverage of how a long flag becomes a camelcased attribute name",
      },
      {
        id: "everything-is-boolean",
        code: "Option.prototype.isBoolean = function () { return true; };",
        requires: "an option carrying a value, which is not boolean",
      },
    ],
  });
});
