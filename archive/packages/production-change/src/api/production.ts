import { loadProductionChange, listProductionChanges, loadIndex } from "../store/storage.js";
import type { ProductionChange } from "../schema/production-change.js";

export interface ProductionApi {
  get(id: string): Promise<ProductionChange | null>;
  current(service: string, environment: string): Promise<ProductionChange | null>;
  history(
    service: string,
    environment: string,
    options?: { limit?: number; since?: string; until?: string },
  ): Promise<readonly ProductionChange[]>;
  findByCommit(sha: string): Promise<readonly ProductionChange[]>;
  findByDeployment(provider: string, externalId: string): Promise<ProductionChange | null>;
  trace(identifier: string): Promise<ProductionChange | null>;
  list(): Promise<readonly ProductionChange[]>;
}

export function createProductionApi(repoRoot: string, customDir?: string): ProductionApi {
  return {
    async get(id: string): Promise<ProductionChange | null> {
      return loadProductionChange(repoRoot, id, customDir);
    },
    async current(service: string, environment: string): Promise<ProductionChange | null> {
      const all = await listProductionChanges(repoRoot, customDir);
      const filtered = all
        .filter((pc) => pc.service.id === service || pc.service.name === service)
        .filter((pc) => pc.environment.name === environment);
      if (filtered.length === 0) return null;
      // Latest by completedAt
      filtered.sort((a, b) =>
        (b.deployment.completedAt ?? "").localeCompare(a.deployment.completedAt ?? ""),
      );
      return filtered[0] ?? null;
    },
    async history(
      service: string,
      environment: string,
      options?: { limit?: number; since?: string; until?: string },
    ): Promise<readonly ProductionChange[]> {
      const all = await listProductionChanges(repoRoot, customDir);
      let filtered = all
        .filter((pc) => pc.service.id === service || pc.service.name === service)
        .filter((pc) => pc.environment.name === environment);
      if (options?.since)
        filtered = filtered.filter((pc) => (pc.deployment.completedAt ?? "") >= options.since!);
      if (options?.until)
        filtered = filtered.filter((pc) => (pc.deployment.completedAt ?? "") <= options.until!);
      filtered.sort((a, b) =>
        (a.deployment.completedAt ?? "").localeCompare(b.deployment.completedAt ?? ""),
      );
      if (options?.limit) filtered = filtered.slice(-options.limit);
      return filtered;
    },
    async findByCommit(sha: string): Promise<readonly ProductionChange[]> {
      const all = await listProductionChanges(repoRoot, customDir);
      return all.filter((pc) => pc.source.commitSha === sha);
    },
    async findByDeployment(provider: string, externalId: string): Promise<ProductionChange | null> {
      const idx = await loadIndex(repoRoot, customDir);
      const key = `${provider}:${externalId}`;
      const id = idx.byDeployment[key];
      if (!id) return null;
      return loadProductionChange(repoRoot, id, customDir);
    },
    async trace(identifier: string): Promise<ProductionChange | null> {
      // Try commit SHA
      if (/^[0-9a-f]{7,40}$/i.test(identifier)) {
        const byCommit = await (async () => {
          const all = await listProductionChanges(repoRoot, customDir);
          return all.find((pc) => pc.source.commitSha === identifier) ?? null;
        })();
        if (byCommit) return byCommit;
        // try short
        const all = await listProductionChanges(repoRoot, customDir);
        for (const pc of all) {
          if (
            pc.source.commitSha &&
            (pc.source.commitSha.startsWith(identifier) ||
              identifier.startsWith(pc.source.commitSha))
          )
            return pc;
        }
      }
      // Try deployment id
      {
        const byDep = await (async () => {
          const idx = await loadIndex(repoRoot, customDir);
          const key1 = `vercel:${identifier}`;
          const key2 = `kubernetes:${identifier}`;
          const key3 = `cloudflare:${identifier}`;
          for (const k of [key1, key2, key3]) {
            const id = idx.byDeployment[k];
            if (id) return loadProductionChange(repoRoot, id, customDir);
          }
          return null;
        })();
        if (byDep) return byDep;
      }
      // Try change id directly
      const direct = await loadProductionChange(repoRoot, identifier, customDir);
      if (direct) return direct;
      return null;
    },
    async list(): Promise<readonly ProductionChange[]> {
      return listProductionChanges(repoRoot, customDir);
    },
  };
}
