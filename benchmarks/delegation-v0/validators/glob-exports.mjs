import { assertSubpathExports } from "./exports-check.mjs";
import { runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  assertSubpathExports(repository, {
    packageName: "glob-matcher-core",
    license: "MIT",
    requiredFiles: ["index.js", "lib/"],
    mustResolve: ["", "/package.json", "/scan", "/utils"],
    mustNotResolve: [
      "/lib/scan.js",
      "/lib/utils.js",
      "/lib/parse.js",
      "/lib/glob-match.js",
      "/index.js",
    ],
  });
});
