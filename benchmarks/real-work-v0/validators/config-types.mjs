import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { assert, runValidator } from "./lib.mjs";

await runValidator(async (repository) => {
  const root = await mkdtemp(join(tmpdir(), "rapture-type-validator-"));
  try {
    const source = join(root, "consumer.ts");
    await writeFile(
      source,
      'import { loadEndpoint, type Endpoint } from "fixture";\nconst endpoint: Endpoint = loadEndpoint({ timeoutMs: 2500 });\nendpoint.timeoutMs.toFixed(0);\n',
      "utf8",
    );
    const options = {
      strict: true,
      noEmit: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      baseUrl: root,
      paths: { fixture: [resolve(repository, "types/index.d.ts")] },
    };
    const program = ts.createProgram([source, resolve(repository, "types/index.d.ts")], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.deepEqual(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
