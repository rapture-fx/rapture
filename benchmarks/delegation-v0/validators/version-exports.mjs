import { assertSubpathExports } from "./exports-check.mjs";
import { runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  assertSubpathExports(repository, {
    packageName: "version-core",
    license: "ISC",
    requiredFiles: ["classes/", "functions/", "internal/", "ranges/", "index.js"],
    mustResolve: [
      "",
      "/package.json",
      "/functions/parse",
      "/functions/satisfies",
      "/ranges/valid",
      "/ranges/subset",
      "/classes/range",
      "/classes/semver",
    ],
    mustNotResolve: ["/internal/re", "/internal/lrucache", "/index.js", "/functions/parse.js"],
  });
});
