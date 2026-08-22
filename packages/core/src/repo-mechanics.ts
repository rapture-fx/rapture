import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { sha256 } from "./artifacts.js";

/**
 * Deterministic, LLM-free analysis of a repository's module structure.
 *
 * Everything here is derived from bytes on disk by static inspection. No inference about
 * architectural intent, no business rules, and no semantic proof: where a signal cannot be
 * established mechanically it is reported as an explicit unknown rather than guessed.
 *
 * The scanner reads literal module specifiers only. Computed requires, specifiers built at
 * runtime, and re-exports through dynamic indirection are deliberately not resolved; they
 * are recorded in `unresolvedSpecifiers` so a consumer can see exactly what was missed
 * instead of trusting a graph that silently dropped edges.
 */

const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"] as const;
const RESOLUTION_CANDIDATES = [
  "",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  "/index.js",
  "/index.mjs",
  "/index.cjs",
  "/index.ts",
] as const;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".rapture"]);

/** Maximum dependency hops walked outward from the editable files. Bounded by design. */
export const DEFAULT_TRAVERSAL_DEPTH = 2;

export interface ModuleGraph {
  readonly files: readonly string[];
  readonly imports: Readonly<Record<string, readonly string[]>>;
  readonly importers: Readonly<Record<string, readonly string[]>>;
  readonly unresolvedSpecifiers: Readonly<Record<string, readonly string[]>>;
  readonly exportedSymbols: Readonly<Record<string, readonly string[]>>;
  readonly fileSha256: Readonly<Record<string, string>>;
}

const posix = (value: string): string => value.split(sep).join("/");

async function listSourceFiles(root: string, current = root): Promise<readonly string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await listSourceFiles(root, path)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(extname(entry.name) as never)) {
      files.push(posix(relative(root, path)));
    }
  }
  return files.sort();
}

/**
 * Blank out comments while preserving offsets and string literals.
 *
 * Documentation frequently contains code samples, and a `require()` inside a JSDoc block is
 * not a dependency. Scanning raw text produced exactly that false edge on the glob fixture,
 * where a usage example in `lib/scan.js` made it look like the module imported the package
 * root. String literals are tracked so that a `//` inside a URL is not mistaken for a
 * comment.
 */
export function stripComments(source: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (quote !== null) {
      output += char;
      if (char === "\\") {
        output += next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") output += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

/** Literal module specifiers, plus a marker for any require/import we refused to guess at. */
function readSpecifiers(rawSource: string): {
  readonly literal: readonly string[];
  readonly dynamic: number;
} {
  const source = stripComments(rawSource);
  const literal: string[] = [];
  const patterns = [
    /\bimport\s+(?:[\w*{},\s]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\w*{},\s]+\s+)?from\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) literal.push(specifier);
    }
  }
  // A require/import whose argument is not a string literal cannot be resolved statically.
  const dynamic =
    [...source.matchAll(/\brequire\s*\(\s*(?!["'])/g)].length +
    [...source.matchAll(/\bimport\s*\(\s*(?!["'])/g)].length;
  return { literal: [...new Set(literal)].sort(), dynamic };
}

/** Exported names, as far as they can be read syntactically. */
function readExportedSymbols(rawSource: string): readonly string[] {
  const source = stripComments(rawSource);
  const symbols = new Set<string>();
  for (const match of source.matchAll(
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    if (match[1] !== undefined) symbols.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/u)
        .pop()
        ?.trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/u.test(name)) symbols.add(name);
    }
  }
  for (const match of source.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    if (match[1] !== undefined) symbols.add(match[1]);
  }
  for (const match of source.matchAll(/\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g)) {
    if (match[1] !== undefined) symbols.add(match[1]);
  }
  return [...symbols].sort();
}

async function resolveSpecifier(
  root: string,
  fromFile: string,
  specifier: string,
): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(root, dirname(fromFile), specifier);
  for (const candidate of RESOLUTION_CANDIDATES) {
    const target = `${base}${candidate}`;
    const stats = await stat(target).catch(() => null);
    if (stats?.isFile() === true) return posix(relative(root, target));
  }
  return null;
}

export async function buildModuleGraph(repositoryRoot: string): Promise<ModuleGraph> {
  const root = resolve(repositoryRoot);
  const files = await listSourceFiles(root);
  const imports: Record<string, string[]> = {};
  const importers: Record<string, string[]> = {};
  const unresolvedSpecifiers: Record<string, string[]> = {};
  const exportedSymbols: Record<string, string[]> = {};
  const fileSha256: Record<string, string> = {};

  for (const file of files) {
    const bytes = await readFile(join(root, file));
    fileSha256[file] = sha256(bytes);
    const source = bytes.toString("utf8");
    exportedSymbols[file] = [...readExportedSymbols(source)];
    const { literal, dynamic } = readSpecifiers(source);
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const specifier of literal) {
      const target = await resolveSpecifier(root, file, specifier);
      if (target === null) unresolved.push(specifier);
      else resolved.push(target);
    }
    if (dynamic > 0) unresolved.push(`<${dynamic} non-literal specifier(s)>`);
    imports[file] = [...new Set(resolved)].sort();
    if (unresolved.length > 0) unresolvedSpecifiers[file] = [...new Set(unresolved)].sort();
  }

  for (const file of files) {
    for (const target of imports[file] ?? []) {
      const existing = importers[target] ?? [];
      existing.push(file);
      importers[target] = existing;
    }
  }
  for (const key of Object.keys(importers)) importers[key] = [...new Set(importers[key])].sort();

  return { files, imports, importers, unresolvedSpecifiers, exportedSymbols, fileSha256 };
}

export interface RelevantFile {
  readonly path: string;
  readonly depth: number;
  readonly reason: "editable" | "imported_by_editable" | "imports_editable";
}

/**
 * Walk outward from the editable files, bounded by `maxDepth`, following each direction
 * separately.
 *
 * Both directions matter for a change, but they mean different things: what the edited file
 * depends on constrains how it may be written, and what depends on it is the blast radius.
 * Crucially the walk never switches direction mid-path. Collecting "importers of things the
 * edited file imports" reaches almost every file in a library with a shared low-level
 * module -- on the semver fixture it pulled in 44 of 52 files, which is noise rather than
 * context, and a contract full of irrelevant files can push an agent away from the change
 * instead of toward it.
 */
export function collectRelevantFiles(
  graph: ModuleGraph,
  editableFiles: readonly string[],
  maxDepth: number = DEFAULT_TRAVERSAL_DEPTH,
): readonly RelevantFile[] {
  const found = new Map<string, RelevantFile>();
  const roots = editableFiles.filter((file) => graph.files.includes(file));
  for (const file of roots) found.set(file, { path: file, depth: 0, reason: "editable" });

  const walk = (
    edges: Readonly<Record<string, readonly string[]>>,
    reason: RelevantFile["reason"],
  ): void => {
    let frontier = [...roots];
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const next: string[] = [];
      for (const file of frontier) {
        for (const neighbour of edges[file] ?? []) {
          if (found.has(neighbour)) continue;
          found.set(neighbour, { path: neighbour, depth, reason });
          next.push(neighbour);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  };

  walk(graph.imports, "imported_by_editable");
  walk(graph.importers, "imports_editable");

  return [...found.values()].sort((left, right) =>
    left.depth === right.depth ? left.path.localeCompare(right.path) : left.depth - right.depth,
  );
}

export interface VerificationSurface {
  readonly mechanism: string;
  readonly command: readonly string[];
  readonly evidence: string;
}

export interface RepositoryMechanics {
  readonly relevantFiles: readonly RelevantFile[];
  readonly dependencyDepth: {
    readonly maxDepthWalked: number;
    readonly bounded: true;
    readonly filesByDepth: Readonly<Record<string, number>>;
  };
  readonly fanOut: Readonly<Record<string, number>>;
  readonly entrySymbols: readonly { readonly file: string; readonly symbols: readonly string[] }[];
  readonly testSurfaces: {
    readonly files: readonly string[];
    readonly commands: readonly (readonly string[])[];
  };
  readonly verificationSurface: readonly VerificationSurface[];
  readonly changeBreadth: "local" | "module" | "cross_module" | null;
  readonly unknowns: readonly string[];
  readonly sourceHashes: Readonly<Record<string, string>>;
}

const topLevel = (path: string): string => path.split("/")[0] ?? "";

const isTestFile = (path: string): boolean =>
  /(^|\/)tests?\//u.test(path) || /\.(test|spec)\.[cm]?[jt]s$/u.test(path);

export async function analyzeRepositoryMechanics(input: {
  readonly repositoryRoot: string;
  readonly editableScope: readonly string[];
  readonly maxDepth?: number;
}): Promise<RepositoryMechanics> {
  const root = resolve(input.repositoryRoot);
  const graph = await buildModuleGraph(root);
  const maxDepth = input.maxDepth ?? DEFAULT_TRAVERSAL_DEPTH;
  const editable = [...input.editableScope].sort();
  const unknowns: string[] = [];

  const missing = editable.filter((file) => !graph.files.includes(file));
  for (const file of missing) {
    unknowns.push(
      `editable path ${file} is not a analyzable source file; its dependency edges are unknown`,
    );
  }

  const relevantFiles = collectRelevantFiles(graph, editable, maxDepth);
  const filesByDepth: Record<string, number> = {};
  for (const file of relevantFiles) {
    const key = String(file.depth);
    filesByDepth[key] = (filesByDepth[key] ?? 0) + 1;
  }

  const fanOut: Record<string, number> = {};
  for (const file of editable) {
    if (!graph.files.includes(file)) continue;
    fanOut[file] = (graph.importers[file] ?? []).length;
  }

  const entrySymbols = editable
    .filter((file) => (graph.exportedSymbols[file] ?? []).length > 0)
    .map((file) => ({ file, symbols: graph.exportedSymbols[file] ?? [] }));

  // Tests are reported only when a runnable command can be named for them.
  const testFiles = graph.files.filter(isTestFile);
  const testCommands: string[][] = [];
  for (const file of testFiles) {
    const source = await readFile(join(root, file), "utf8").catch(() => "");
    if (/from\s+["']node:test["']|require\(["']node:test["']\)/u.test(source)) {
      testCommands.push(["node", "--test", file]);
    }
  }
  const manifestPath = join(root, "package.json");
  const manifestRaw = await readFile(manifestPath, "utf8").catch(() => null);
  const verificationSurface: VerificationSurface[] = [];
  if (manifestRaw !== null) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(manifestRaw) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      unknowns.push("package.json is present but could not be parsed; scripts are unknown");
    }
    for (const name of Object.keys(scripts).sort()) {
      verificationSurface.push({
        mechanism: `npm script: ${name}`,
        command: ["npm", "run", name],
        evidence: "package.json scripts",
      });
    }
  } else {
    unknowns.push("no package.json found; declared scripts are unknown");
  }
  for (const file of editable.filter((path) => graph.files.includes(path))) {
    verificationSurface.push({
      mechanism: "syntax check",
      command: ["node", "--check", file],
      evidence: "file is a parseable source module",
    });
  }
  for (const command of testCommands) {
    verificationSurface.push({
      mechanism: "node:test suite",
      command,
      evidence: "file imports node:test",
    });
  }

  const touchedTopLevels = new Set(relevantFiles.map((file) => topLevel(file.path)));
  const totalFanOut = Object.values(fanOut).reduce((sum, value) => sum + value, 0);
  const changeBreadth: RepositoryMechanics["changeBreadth"] =
    missing.length === editable.length
      ? null
      : totalFanOut === 0
        ? "local"
        : touchedTopLevels.size <= 1
          ? "module"
          : "cross_module";

  unknowns.push(
    "dependency edges come from literal import/require specifiers only; computed specifiers are not resolved",
  );
  unknowns.push("no type information, call-graph, or runtime behaviour was analyzed");
  const unresolvedFiles = Object.keys(graph.unresolvedSpecifiers).filter((file) =>
    relevantFiles.some((relevant) => relevant.path === file),
  );
  for (const file of unresolvedFiles.sort()) {
    unknowns.push(
      `${file} has unresolved specifiers: ${(graph.unresolvedSpecifiers[file] ?? []).join(", ")}`,
    );
  }

  const sourceHashes: Record<string, string> = {};
  for (const file of relevantFiles) {
    const hash = graph.fileSha256[file.path];
    if (hash !== undefined) sourceHashes[file.path] = hash;
  }

  return {
    relevantFiles,
    dependencyDepth: { maxDepthWalked: maxDepth, bounded: true, filesByDepth },
    fanOut,
    entrySymbols,
    testSurfaces: { files: testFiles, commands: testCommands },
    verificationSurface,
    changeBreadth,
    unknowns: [...new Set(unknowns)],
    sourceHashes,
  };
}
