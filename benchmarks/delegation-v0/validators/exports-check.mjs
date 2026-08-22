import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assert, runNode } from "./lib.mjs";

/**
 * Verify a fixture's package subpath exports by resolving it as a real installed package.
 *
 * Staging the candidate under `node_modules/<name>` is what makes this decidable: Node's
 * own resolver, not a source-text inspection, decides which subpaths are reachable, so the
 * task cannot be satisfied by writing a plausible-looking `exports` block that does not work.
 */
export function assertSubpathExports(repository, spec) {
  const manifest = JSON.parse(readFileSync(join(resolve(repository), "package.json"), "utf8"));
  assert.equal(manifest.name, spec.packageName, "package name must not change");
  assert.equal(manifest.license, spec.license, "license field must not change");
  if (spec.type === undefined) {
    assert.ok(manifest.type === undefined, "package type must not change");
  } else {
    assert.equal(manifest.type, spec.type, "package type must not change");
  }
  assert.ok(
    manifest.exports !== undefined && manifest.exports !== null,
    "package.json must declare an exports map",
  );
  assert.ok(Array.isArray(manifest.files), "package.json must declare a files array");
  for (const entry of spec.requiredFiles) {
    assert.ok(
      manifest.files.includes(entry),
      `files must include ${entry}; got ${JSON.stringify(manifest.files)}`,
    );
  }

  const workspace = mkdtempSync(join(tmpdir(), "rapture-exports-"));
  try {
    const modules = join(workspace, "node_modules");
    mkdirSync(modules, { recursive: true });
    cpSync(resolve(repository), join(modules, spec.packageName), {
      recursive: true,
      filter: (source) => !source.split("/").includes(".git"),
    });

    // JSON subpaths are always probed through require: importing JSON from an ES module
    // needs an import attribute, and its absence would look like a resolution failure.
    const load = (specifier) =>
      spec.type === "module" && !specifier.endsWith(".json")
        ? `import(${JSON.stringify(specifier)})`
        : `Promise.resolve(require(${JSON.stringify(specifier)}))`;
    const probe = (specifier) =>
      runNode([
        "--input-type=commonjs",
        "-e",
        `${load(specifier)}.then(
           (m) => { process.stdout.write("OK:" + (m && (typeof m.default !== "undefined" || Object.keys(m).length >= 0) ? "loaded" : "empty")); },
           (e) => { process.stdout.write("ERR:" + (e.code || e.message)); },
         )`,
      ], { cwd: workspace });

    for (const specifier of spec.mustResolve) {
      const { output } = probe(`${spec.packageName}${specifier}`);
      assert.ok(
        output.includes("OK:"),
        `${spec.packageName}${specifier} must resolve through the exports map, got ${output.trim().slice(0, 200)}`,
      );
    }
    for (const specifier of spec.mustNotResolve) {
      const { output } = probe(`${spec.packageName}${specifier}`);
      // Any failure to load is acceptable. What matters is that the path is unreachable,
      // not which resolver error the runtime happens to raise for it.
      assert.ok(
        !output.includes("OK:"),
        `${spec.packageName}${specifier} must NOT be reachable; internals stay private, got ${output.trim().slice(0, 200)}`,
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
