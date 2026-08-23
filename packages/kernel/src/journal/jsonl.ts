import { open, readFile } from "node:fs/promises";
import pLimit from "p-limit";

export interface JsonlAppender {
  readonly appendLine: (line: string) => Promise<void>;
}

async function readLines(path: string): Promise<string[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").filter((line) => line.length > 0);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readJsonlLines(path: string): Promise<readonly string[]> {
  return readLines(path);
}

export async function createJsonlAppender(path: string): Promise<JsonlAppender> {
  const handle = await open(path, "a");
  await handle.close();
  const serialize = pLimit(1);
  return {
    appendLine: (line) =>
      serialize(async () => {
        const appendHandle = await open(path, "a");
        try {
          await appendHandle.write(`${line}\n`);
          await appendHandle.sync();
        } finally {
          await appendHandle.close();
        }
      }),
  };
}

export async function exclusiveCreateFile(path: string): Promise<void> {
  const handle = await open(path, "wx");
  await handle.close();
}
