import type { Language } from "./classify.js";

export interface TestBlock {
  readonly name: string;
  readonly assertions: number;
  readonly skipped: boolean;
}

const ASSERTION_PATTERNS: Record<Language, RegExp> = {
  python: /(^|[^A-Za-z0-9_])(assert\s|self\.assert[A-Za-z]+\(|pytest\.raises\()/,
  jsts: /(^|[^A-Za-z0-9_])(expect\(|assert\.[A-Za-z]+\(|assert\(|should\.|assertTrue\(|assertEqual\()/,
  csharp: /(^|[^A-Za-z0-9_])(Assert\.[A-Za-z]+\(|Should\(\)|\.Should\()/,
  unknown: /(?!)/,
};

const SKIP_PATTERNS: RegExp[] = [
  /@pytest\.mark\.skip/,
  /@unittest\.skip/,
  /\bpytest\.skip\(/,
  /\b(it|test|describe)\.skip\s*\(/,
  /\b(xit|xdescribe|xtest)\s*\(/,
  /\b(it|test)\.todo\s*\(/,
  /\[Ignore\]/,
  /\bt\.Skip\(/,
];

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/#.*$/, "");
}

function isAssertionLine(line: string, lang: Language): boolean {
  const code = stripComments(line);
  if (code.trim() === "") return false;
  return ASSERTION_PATTERNS[lang].test(code);
}

export function isSkipLine(line: string): boolean {
  const code = stripComments(line);
  return SKIP_PATTERNS.some((r) => r.test(code));
}

export function countAssertions(content: string, lang: Language): number {
  let n = 0;
  for (const line of content.split("\n")) if (isAssertionLine(line, lang)) n++;
  return n;
}

export function countSkips(content: string): number {
  let n = 0;
  for (const line of content.split("\n")) if (isSkipLine(line)) n++;
  return n;
}

/**
 * Extract named test blocks with their assertion counts.
 *
 * Python is split on indentation, which its grammar makes reliable. JS/TS is
 * split by brace balance from the opening `it(`/`test(`. Anything else returns
 * no blocks, so callers fall back to whole-file counts rather than guessing.
 */
export function extractTestBlocks(content: string, lang: Language): readonly TestBlock[] {
  const lines = content.split("\n");
  const blocks: TestBlock[] = [];

  if (lang === "python") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = line.match(/^(\s*)(?:async\s+)?def\s+(test[A-Za-z0-9_]*)\s*\(/);
      if (!m) continue;
      const indent = (m[1] ?? "").length;
      const name = m[2] ?? "";
      // A decorator directly above the def can carry the skip marker.
      let skipped = false;
      for (let k = i - 1; k >= 0; k--) {
        const prev = lines[k] ?? "";
        if (prev.trim() === "") continue;
        if (!prev.trim().startsWith("@")) break;
        if (isSkipLine(prev)) skipped = true;
      }
      let assertions = 0;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const body = lines[j] ?? "";
        if (body.trim() === "") continue;
        const bodyIndent = body.length - body.trimStart().length;
        if (bodyIndent <= indent) break;
        if (isAssertionLine(body, lang)) assertions++;
        if (isSkipLine(body)) skipped = true;
      }
      blocks.push({ name, assertions, skipped });
      i = j - 1;
    }
    return blocks;
  }

  if (lang === "jsts") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = line.match(
        /(?:^|[^A-Za-z0-9_.])(?:it|test)(?:\.(skip|only|todo))?\s*\(\s*(['"`])(.*?)\2/,
      );
      if (!m) continue;
      const name = m[3] ?? "";
      const skipped = m[1] === "skip" || m[1] === "todo" || isSkipLine(line);
      let depth = 0;
      let started = false;
      let assertions = 0;
      let j = i;
      for (; j < lines.length; j++) {
        const body = lines[j] ?? "";
        for (const ch of body) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") depth--;
        }
        if (j > i && isAssertionLine(body, lang)) assertions++;
        if (started && depth <= 0) break;
      }
      blocks.push({ name, assertions, skipped });
      i = j;
    }
    return blocks;
  }

  return [];
}
