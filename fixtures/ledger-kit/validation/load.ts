import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadFixtureModule<T>(relativePath: string): Promise<T> {
  const url = pathToFileURL(join(process.cwd(), relativePath)).href;
  return (await import(url)) as T;
}
