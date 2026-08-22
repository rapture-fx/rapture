import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractAgentExploration } from "../src/agent-exploration.js";
import {
  changeContractFingerprint,
  compileChangeContract,
  parseChangeContract,
} from "../src/change-contract.js";
import { runGit } from "../src/git.js";
import {
  analyzeRepositoryMechanics,
  buildModuleGraph,
  collectRelevantFiles,
  stripComments,
} from "../src/repo-mechanics.js";
import { materializeTaskContext } from "../src/task-context.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rapture-mechanics-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

describe("module graph", () => {
  it("resolves imports and importers across CommonJS and ESM", async () => {
    const root = await fixture({
      "index.js": "import { a } from './lib/a.js';\nexport { a };\n",
      "lib/a.js": "const b = require('./b');\nexports.a = () => b;\n",
      "lib/b.js": "module.exports = 1;\n",
    });
    try {
      const graph = await buildModuleGraph(root);
      expect(graph.files).toEqual(["index.js", "lib/a.js", "lib/b.js"]);
      expect(graph.imports["index.js"]).toEqual(["lib/a.js"]);
      // A specifier without an extension still resolves to the file on disk.
      expect(graph.imports["lib/a.js"]).toEqual(["lib/b.js"]);
      expect(graph.importers["lib/b.js"]).toEqual(["lib/a.js"]);
      expect(graph.exportedSymbols["lib/a.js"]).toEqual(["a"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores requires inside comments and records non-literal specifiers", async () => {
    const root = await fixture({
      "a.js": [
        "/**",
        " * Example:",
        " * const pm = require('..');",
        " */",
        "const real = require('./b.js');",
        "const dynamic = require(process.env.NAME);",
        "const url = 'https://example.invalid/x';",
        "module.exports = { real, dynamic, url };",
      ].join("\n"),
      "b.js": "module.exports = 1;\n",
    });
    try {
      const graph = await buildModuleGraph(root);
      // The documentation sample must not become a dependency edge.
      expect(graph.imports["a.js"]).toEqual(["b.js"]);
      expect(graph.unresolvedSpecifiers["a.js"]).toEqual(["<1 non-literal specifier(s)>"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a URL in a string intact when stripping comments", () => {
    const stripped = stripComments("const u = 'https://x.invalid/a'; // trailing\n");
    expect(stripped).toContain("https://x.invalid/a");
    expect(stripped).not.toContain("trailing");
  });

  it("never switches direction while walking, so a shared module does not pull in the world", async () => {
    // `shared.js` is imported by everything. Walking importers-of-imports from `edit.js`
    // would reach every consumer of shared.js, which is noise rather than context.
    const files: Record<string, string> = {
      "edit.js": "const s = require('./shared.js');\nmodule.exports = s;\n",
      "shared.js": "module.exports = 1;\n",
    };
    for (let index = 0; index < 12; index += 1) {
      files[`consumer${index}.js`] = "const s = require('./shared.js');\nmodule.exports = s;\n";
    }
    const root = await fixture(files);
    try {
      const graph = await buildModuleGraph(root);
      const relevant = collectRelevantFiles(graph, ["edit.js"], 2);
      const paths = relevant.map((file) => file.path);
      expect(paths).toContain("edit.js");
      expect(paths).toContain("shared.js");
      expect(paths).not.toContain("consumer0.js");
      expect(relevant.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("change contract", () => {
  const build = async (): Promise<ReturnType<typeof compileChangeContract>> => {
    const mechanics = await analyzeRepositoryMechanics({
      repositoryRoot: join(workspaceRoot, "benchmarks/delegation-v0/fixtures/glob-matcher-core"),
      editableScope: ["lib/scan.js"],
    });
    return compileChangeContract({
      taskId: "glob-scan-negation",
      intent: "fix scan",
      repositoryCommit: "ece3d07c9b6dcfddbf99fd2963a3fbf13bbdf807",
      commitTimestamp: "2026-08-22T00:00:00Z",
      editableScope: ["lib/scan.js"],
      protectedPaths: ["index.js"],
      acceptanceCommands: ["external validator"],
      requiredEvidence: ["stays in scope"],
      mechanics,
    });
  };

  it("is byte-reproducible for the same repository and task", async () => {
    const first = await build();
    const second = await build();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.provenance.contractSha256).toBe(first.provenance.contractSha256);
  });

  it("validates against its own schema and detects tampering", async () => {
    const contract = await build();
    expect(() => parseChangeContract(JSON.parse(JSON.stringify(contract)))).not.toThrow();
    expect(changeContractFingerprint(contract)).toBe(contract.provenance.contractSha256);
    const tampered = {
      ...contract,
      constraints: { ...contract.constraints, editableScope: ["index.js"] },
    };
    expect(() => parseChangeContract(JSON.parse(JSON.stringify(tampered)))).toThrow();
  });

  it("carries explicit unknowns rather than silent gaps", async () => {
    const contract = await build();
    expect(contract.constraints.unknowns.length).toBeGreaterThan(0);
    expect(contract.constraints.unknowns.join(" ")).toContain("literal import/require");
  });

  it("contains no known-good solution content", async () => {
    const contract = await build();
    const serialized = JSON.stringify(contract);
    const overlay = JSON.parse(
      await readFile(
        join(workspaceRoot, "benchmarks/delegation-v0/known-good/glob-scan.json"),
        "utf8",
      ),
    ) as { files: Record<string, string> };
    for (const solution of Object.values(overlay)) {
      void solution;
    }
    for (const [, content] of Object.entries(overlay.files)) {
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= 25);
      const leaked = lines.filter((line) => serialized.includes(line));
      expect(leaked, "contract must not embed solution source").toEqual([]);
    }
    // Nor validator internals beyond the fact that an external validator decides acceptance.
    expect(serialized).not.toContain("assert.deepEqual");
  });
});

describe("agent exploration metrics", () => {
  it("counts reads, searches, commands and time to first edit", () => {
    const events = [
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "read",
          state: { input: { filePath: "/w/a.js" }, time: { start: 1000 } },
        },
      },
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "bash",
          state: { input: { command: "grep -r x ." }, time: { start: 1500 } },
        },
      },
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "read",
          state: { input: { filePath: "/w/a.js" }, time: { start: 1800 } },
        },
      },
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "edit",
          state: { input: { filePath: "/w/a.js" }, time: { start: 3000 } },
        },
      },
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "edit",
          state: { input: { filePath: "/w/a.js" }, time: { start: 3500 } },
        },
      },
      { type: "text", part: { type: "text" } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const metrics = extractAgentExploration(events);
    expect(metrics).not.toBeNull();
    expect(metrics?.totalToolCalls).toBe(5);
    expect(metrics?.fileReads).toBe(2);
    expect(metrics?.uniqueFilesRead).toBe(1);
    // A shell grep counts as exploration as well as a command.
    expect(metrics?.searchOperations).toBe(1);
    expect(metrics?.commandsExecuted).toBe(1);
    expect(metrics?.toolCallsBeforeFirstEdit).toBe(3);
    expect(metrics?.msToFirstEdit).toBe(2000);
    expect(metrics?.repeatedEdits).toBe(1);
  });

  it("returns null when the stream carries no tool calls", () => {
    expect(extractAgentExploration("")).toBeNull();
    expect(extractAgentExploration("not json\n")).toBeNull();
  });
});

describe("injected task context", () => {
  it("is readable by the agent but invisible to change detection", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-context-"));
    const repository = join(root, "repo");
    try {
      await mkdir(repository, { recursive: true });
      await writeFile(join(repository, "a.txt"), "a\n", "utf8");
      await runGit(repository, ["init", "-q", "-b", "main"]);
      await runGit(repository, ["add", "--all"]);
      await runGit(repository, [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@invalid.example",
        "commit",
        "-q",
        "-m",
        "init",
      ]);

      await materializeTaskContext(repository, {
        files: { ".rapture/change-contract.json": '{"schemaVersion":"1"}\n' },
        ignorePaths: [".rapture/"],
        promptSuffix: "see contract",
      });

      const contract = await readFile(join(repository, ".rapture/change-contract.json"), "utf8");
      expect(contract).toContain("schemaVersion");
      const status = await runGit(repository, ["status", "--porcelain"]);
      expect(status.stdout.trim(), "injected context must not look like an agent edit").toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to write outside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "rapture-context-escape-"));
    try {
      await expect(
        materializeTaskContext(root, {
          files: { "../escaped.json": "{}" },
          ignorePaths: [],
          promptSuffix: "",
        }),
      ).rejects.toThrow(/escaped the worktree/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
