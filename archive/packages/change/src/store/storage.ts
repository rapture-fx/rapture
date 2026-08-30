import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "@rapture/kernel";
import { SCHEMA_VERSION } from "../schema/version.js";
import type { Change } from "../schema/change.js";

export const DEFAULT_CHANGE_DIR = ".rapture/change";

export function changeRoot(repoRoot: string, customDir?: string): string {
  const dir = customDir ?? DEFAULT_CHANGE_DIR;
  if (dir.startsWith("/")) return dir;
  return resolve(repoRoot, dir);
}

export async function saveRaw(
  repoRoot: string,
  provider: string,
  externalId: string,
  data: unknown,
  customDir?: string,
): Promise<string> {
  const root = changeRoot(repoRoot, customDir);
  const safeId = externalId.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 100);
  const path = join(root, "raw", provider, `${safeId}.json`);
  await mkdir(join(root, "raw", provider), { recursive: true });
  const payload = {
    provider,
    externalId,
    fetchedAt: new Date().toISOString(),
    data,
    schemaVersion: SCHEMA_VERSION,
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

export async function listRaw(
  repoRoot: string,
  provider: string,
  customDir?: string,
): Promise<readonly { externalId: string; data: unknown }[]> {
  const root = changeRoot(repoRoot, customDir);
  const dir = join(root, "raw", provider);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: { externalId: string; data: unknown }[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const parsed = JSON.parse(raw) as { externalId: string; data: unknown };
      out.push({ externalId: parsed.externalId, data: parsed.data });
    } catch {
      continue;
    }
  }
  return out;
}

export async function saveCanonical(
  repoRoot: string,
  change: Change,
  customDir?: string,
): Promise<string> {
  const root = changeRoot(repoRoot, customDir);
  await mkdir(join(root, "canonical"), { recursive: true });
  const path = join(root, "canonical", `${change.id}.json`);
  await writeFile(path, `${JSON.stringify(change, null, 2)}\n`, "utf8");
  // update index
  await updateIndex(repoRoot, change, customDir);
  return path;
}

async function updateIndex(repoRoot: string, change: Change, customDir?: string): Promise<void> {
  const root = changeRoot(repoRoot, customDir);
  const indexPath = join(root, "index.json");
  let index: Record<string, unknown> = {};
  try {
    const raw = await readFile(indexPath, "utf8");
    index = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    index = {};
  }
  const idx = index as {
    byId?: Record<string, string>;
    byCommit?: Record<string, string>;
    byPr?: Record<string, string>;
    byDeployment?: Record<string, string>;
    byIntent?: Record<string, string>;
  };
  idx.byId = idx.byId ?? {};
  idx.byCommit = idx.byCommit ?? {};
  idx.byPr = idx.byPr ?? {};
  idx.byDeployment = idx.byDeployment ?? {};
  idx.byIntent = idx.byIntent ?? {};

  idx.byId[change.id] = change.id;
  for (const c of change.commits) idx.byCommit[c.sha] = change.id;
  for (const pr of change.pullRequests) idx.byPr[`${pr.repository}#${pr.number}`] = change.id;
  for (const dep of change.deployments)
    idx.byDeployment[`${dep.provider}:${dep.externalId}`] = change.id;
  if (change.intent?.externalId)
    idx.byIntent[`${change.intent.source}:${change.intent.externalId}`] = change.id;

  await mkdir(root, { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");
}

export async function loadIndex(
  repoRoot: string,
  customDir?: string,
): Promise<{
  byId: Record<string, string>;
  byCommit: Record<string, string>;
  byPr: Record<string, string>;
  byDeployment: Record<string, string>;
  byIntent: Record<string, string>;
}> {
  const root = changeRoot(repoRoot, customDir);
  const indexPath = join(root, "index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      byId: (parsed["byId"] as Record<string, string>) ?? {},
      byCommit: (parsed["byCommit"] as Record<string, string>) ?? {},
      byPr: (parsed["byPr"] as Record<string, string>) ?? {},
      byDeployment: (parsed["byDeployment"] as Record<string, string>) ?? {},
      byIntent: (parsed["byIntent"] as Record<string, string>) ?? {},
    };
  } catch {
    return { byId: {}, byCommit: {}, byPr: {}, byDeployment: {}, byIntent: {} };
  }
}

export async function loadChange(
  repoRoot: string,
  changeId: string,
  customDir?: string,
): Promise<Change | null> {
  const root = changeRoot(repoRoot, customDir);
  const path = join(root, "canonical", `${changeId}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Change;
  } catch {
    return null;
  }
}

export async function listChanges(
  repoRoot: string,
  customDir?: string,
): Promise<readonly Change[]> {
  const root = changeRoot(repoRoot, customDir);
  const dir = join(root, "canonical");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: Change[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      out.push(JSON.parse(raw) as Change);
    } catch {
      continue;
    }
  }
  return out;
}

export function hashCanonical(change: Change): string {
  return sha256(JSON.stringify(change));
}
