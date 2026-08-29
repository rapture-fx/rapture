import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "@rapture/kernel";
import { SCHEMA_VERSION } from "../schema/version.js";
import type { ProductionChange } from "../schema/production-change.js";

export const DEFAULT_PROD_DIR = ".rapture/production";

export function prodRoot(repoRoot: string, customDir?: string): string {
  const dir = customDir ?? DEFAULT_PROD_DIR;
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
  const root = prodRoot(repoRoot, customDir);
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
  const root = prodRoot(repoRoot, customDir);
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

export async function saveProductionChange(
  repoRoot: string,
  pc: ProductionChange,
  customDir?: string,
): Promise<string> {
  const root = prodRoot(repoRoot, customDir);
  await mkdir(join(root, "canonical"), { recursive: true });
  const path = join(root, "canonical", `${pc.id}.json`);
  await writeFile(path, `${JSON.stringify(pc, null, 2)}\n`, "utf8");
  await updateIndex(repoRoot, pc, customDir);
  return path;
}

async function updateIndex(repoRoot: string, pc: ProductionChange, customDir?: string): Promise<void> {
  const root = prodRoot(repoRoot, customDir);
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
    byServiceEnv?: Record<string, string[]>;
    byCommit?: Record<string, string[]>;
    byDeployment?: Record<string, string>;
    byCurrent?: Record<string, string>;
  };
  idx.byId = idx.byId ?? {};
  idx.byServiceEnv = idx.byServiceEnv ?? {};
  idx.byCommit = idx.byCommit ?? {};
  idx.byDeployment = idx.byDeployment ?? {};
  idx.byCurrent = idx.byCurrent ?? {};

  idx.byId[pc.id] = pc.id;
  const serviceEnvKey = `${pc.service.id}|${pc.environment.name}`;
  const list = idx.byServiceEnv[serviceEnvKey] ?? [];
  if (!list.includes(pc.id)) list.push(pc.id);
  idx.byServiceEnv[serviceEnvKey] = list;

  if (pc.source.commitSha) {
    const arr = idx.byCommit[pc.source.commitSha] ?? [];
    if (!arr.includes(pc.id)) arr.push(pc.id);
    idx.byCommit[pc.source.commitSha] = arr;
  }
  idx.byDeployment[`${pc.deployment.provider}:${pc.deployment.externalId}`] = pc.id;

  // Update current: latest ready per service+env (by completedAt)
  // This will be recomputed on load, but store latest for quick lookup
  // For now, just store; actual current resolution will sort by completedAt

  await mkdir(root, { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");
}

export async function loadIndex(
  repoRoot: string,
  customDir?: string,
): Promise<{
  byId: Record<string, string>;
  byServiceEnv: Record<string, string[]>;
  byCommit: Record<string, string[]>;
  byDeployment: Record<string, string>;
  byCurrent: Record<string, string>;
}> {
  const root = prodRoot(repoRoot, customDir);
  const indexPath = join(root, "index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      byId: (parsed["byId"] as Record<string, string>) ?? {},
      byServiceEnv: (parsed["byServiceEnv"] as Record<string, string[]>) ?? {},
      byCommit: (parsed["byCommit"] as Record<string, string[]>) ?? {},
      byDeployment: (parsed["byDeployment"] as Record<string, string>) ?? {},
      byCurrent: (parsed["byCurrent"] as Record<string, string>) ?? {},
    };
  } catch {
    return { byId: {}, byServiceEnv: {}, byCommit: {}, byDeployment: {}, byCurrent: {} };
  }
}

export async function loadProductionChange(
  repoRoot: string,
  id: string,
  customDir?: string,
): Promise<ProductionChange | null> {
  const root = prodRoot(repoRoot, customDir);
  const path = join(root, "canonical", `${id}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ProductionChange;
  } catch {
    return null;
  }
}

export async function listProductionChanges(
  repoRoot: string,
  customDir?: string,
): Promise<readonly ProductionChange[]> {
  const root = prodRoot(repoRoot, customDir);
  const dir = join(root, "canonical");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: ProductionChange[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      out.push(JSON.parse(raw) as ProductionChange);
    } catch {
      continue;
    }
  }
  return out;
}

export function hashProductionChange(pc: ProductionChange): string {
  return sha256(JSON.stringify(pc));
}
