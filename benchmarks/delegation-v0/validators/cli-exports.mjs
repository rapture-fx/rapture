import { assertSubpathExports } from "./exports-check.mjs";
import { runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  assertSubpathExports(repository, {
    packageName: "cli-command-core",
    license: "MIT",
    type: "module",
    requiredFiles: ["index.js", "lib/"],
    mustResolve: ["", "/package.json"],
    mustNotResolve: [
      "/lib/command.js",
      "/lib/option.js",
      "/lib/argument.js",
      "/lib/help.js",
      "/index.js",
    ],
  });
});
