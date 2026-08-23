import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createJsonlAppender, exclusiveCreateFile, readJsonlLines } from "../src/journal/jsonl.js";

it("appends lines durably and reads them back in order", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-jsonl-"));
  const path = join(root, "log.jsonl");
  const appender = await createJsonlAppender(path);
  await Promise.all([
    appender.appendLine(JSON.stringify({ n: 1 })),
    appender.appendLine(JSON.stringify({ n: 2 })),
  ]);
  const lines = await readJsonlLines(path);
  expect(lines).toHaveLength(2);
  expect(lines.map((line) => JSON.parse(line).n)).toEqual([1, 2]);
});

it("returns empty for a missing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-jsonl-"));
  expect(await readJsonlLines(join(root, "missing.jsonl"))).toEqual([]);
});

it("resumes an existing file without truncation", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-jsonl-"));
  const path = join(root, "log.jsonl");
  const first = await createJsonlAppender(path);
  await first.appendLine("a");
  const second = await createJsonlAppender(path);
  await second.appendLine("b");
  expect(await readJsonlLines(path)).toEqual(["a", "b"]);
});

it("exclusiveCreateFile refuses to overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-jsonl-"));
  const path = join(root, "lock.jsonl");
  await exclusiveCreateFile(path);
  await writeFile(path, "x\n");
  await expect(exclusiveCreateFile(path)).rejects.toMatchObject({ code: "EEXIST" });
});

it("writes newline-terminated content", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-jsonl-"));
  const path = join(root, "log.jsonl");
  const appender = await createJsonlAppender(path);
  await appender.appendLine("{}");
  const content = await readFile(path, "utf8");
  expect(content.endsWith("\n")).toBe(true);
});
