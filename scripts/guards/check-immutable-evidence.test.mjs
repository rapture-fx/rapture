import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectEvidenceMutation, repositoryRoot } from "./check-immutable-evidence.mjs";
import { protectedEvidenceRoots } from "./protected-evidence.mjs";

describe("immutable research evidence", () => {
  it("survives every write-capable formatting command unchanged", async () => {
    const { protectedFiles, mutated } = await detectEvidenceMutation();
    assert.ok(protectedFiles.length > 0, "expected protected evidence to be discovered");
    assert.deepEqual(mutated, [], "write-capable formatting mutated protected evidence");
  });

  // Negative control. Without this the guard could pass simply because Biome happens to
  // agree with how the evidence is already formatted, which would make it worthless the
  // moment a rule changed. Dropping the exclusions must cause detectable mutation.
  it("detects mutation when the protective exclusions are removed", async () => {
    const weakened = JSON.stringify(
      {
        $schema: "https://biomejs.dev/schemas/2.5.8/schema.json",
        files: { includes: ["**", "!!**/dist", "!!**/node_modules"] },
        formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
        linter: { enabled: true, rules: { preset: "recommended" } },
        javascript: {
          formatter: { quoteStyle: "double", semicolons: "always", trailingCommas: "all" },
        },
      },
      null,
      2,
    );
    const { mutated } = await detectEvidenceMutation({ biomeConfig: weakened });
    assert.ok(
      mutated.length > 0,
      "removing the exclusions did not mutate any protected file, so the guard proves nothing",
    );
  });

  it("protects every path an integrity sidecar or benchmark manifest hashes", async () => {
    const covered = (path) =>
      protectedEvidenceRoots.some((root) => path === root || path.startsWith(`${root}/`));

    const { readdir } = await import("node:fs/promises");
    const sidecars = (await readdir(join(repositoryRoot, "experiments"))).filter((name) =>
      name.endsWith(".integrity.json"),
    );
    assert.ok(sidecars.length > 0, "expected at least one integrity sidecar");
    for (const sidecar of sidecars) {
      const payload = JSON.parse(
        await readFile(join(repositoryRoot, "experiments", sidecar), "utf8"),
      );
      for (const path of Object.keys(payload.files)) {
        assert.ok(covered(path), `${sidecar} hashes unprotected path ${path}`);
      }
    }

    for (const suite of await readdir(join(repositoryRoot, "benchmarks"))) {
      const manifestPath = join(repositoryRoot, "benchmarks", suite, "manifest.json");
      const manifest = await readFile(manifestPath, "utf8").catch(() => null);
      if (manifest === null) continue;
      const parsed = JSON.parse(manifest);
      const suiteRelative = (path) => `benchmarks/${suite}/${path}`;
      for (const path of Object.keys(parsed.integrity.protectedAssets)) {
        assert.ok(covered(suiteRelative(path)), `${suite} hashes unprotected asset ${path}`);
      }
      for (const repository of parsed.repositories) {
        assert.ok(
          covered(suiteRelative(repository.source.fixturePath)),
          `${suite} fixture ${repository.source.fixturePath} is unprotected`,
        );
      }
    }
  });
});
