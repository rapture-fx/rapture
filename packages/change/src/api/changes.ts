import { loadChange, loadIndex, listChanges } from "../store/storage.js";
import type { Change } from "../schema/change.js";

export interface ChangeApi {
  get(id: string): Promise<Change | null>;
  findByCommit(sha: string): Promise<Change | null>;
  findByPullRequest(provider: string, repository: string, number: number): Promise<Change | null>;
  findByDeployment(provider: string, id: string): Promise<Change | null>;
  findByIntent(provider: string, externalId: string): Promise<Change | null>;
  trace(identifier: string): Promise<Change | null>;
  list(): Promise<readonly Change[]>;
}

export function createChangeApi(repoRoot: string, customDir?: string): ChangeApi {
  return {
    async get(id: string): Promise<Change | null> {
      return loadChange(repoRoot, id, customDir);
    },
    async findByCommit(sha: string): Promise<Change | null> {
      const idx = await loadIndex(repoRoot, customDir);
      const changeId = idx.byCommit[sha];
      if (!changeId) return null;
      return loadChange(repoRoot, changeId, customDir);
    },
    async findByPullRequest(provider: string, repository: string, number: number): Promise<Change | null> {
      if (provider !== "github") return null;
      const idx = await loadIndex(repoRoot, customDir);
      const key = `${repository}#${number}`;
      const changeId = idx.byPr[key];
      if (!changeId) return null;
      return loadChange(repoRoot, changeId, customDir);
    },
    async findByDeployment(provider: string, id: string): Promise<Change | null> {
      const idx = await loadIndex(repoRoot, customDir);
      const key = `${provider}:${id}`;
      const changeId = idx.byDeployment[key];
      if (!changeId) return null;
      return loadChange(repoRoot, changeId, customDir);
    },
    async findByIntent(provider: string, externalId: string): Promise<Change | null> {
      const idx = await loadIndex(repoRoot, customDir);
      const key = `${provider}:${externalId}`;
      const changeId = idx.byIntent[key];
      if (!changeId) return null;
      return loadChange(repoRoot, changeId, customDir);
    },
    async trace(identifier: string): Promise<Change | null> {
      // Try commit SHA (40 hex or 7+)
      if (/^[0-9a-f]{7,40}$/i.test(identifier)) {
        const byCommit = await loadChange(repoRoot, `chg_${identifier.slice(0, 8)}`, customDir);
        if (byCommit) return byCommit;
        // fallback to index
        const found = await (async () => {
          const idx = await loadIndex(repoRoot, customDir);
          const changeId = idx.byCommit[identifier];
          if (changeId) return loadChange(repoRoot, changeId, customDir);
          // try short
          for (const [sha, cid] of Object.entries(idx.byCommit)) {
            if (sha.startsWith(identifier) || identifier.startsWith(sha)) {
              return loadChange(repoRoot, cid, customDir);
            }
          }
          return null;
        })();
        if (found) return found;
      }
      // Try PR number: "123" or "owner/repo#123"
      const prMatch = identifier.match(/^(?:(.+)\#)?(\d+)$/);
      if (prMatch) {
        const repoPart = prMatch[1];
        const num = Number(prMatch[2]);
        if (!Number.isNaN(num)) {
          if (repoPart) {
            const found = await (async () => {
              const idx = await loadIndex(repoRoot, customDir);
              const key = `${repoPart}#${num}`;
              const cid = idx.byPr[key];
              if (cid) return loadChange(repoRoot, cid, customDir);
              return null;
            })();
            if (found) return found;
          }
          // Try any repo with that number
          const all = await listChanges(repoRoot, customDir);
          for (const ch of all) {
            if (ch.pullRequests.some((pr) => pr.number === num)) return ch;
          }
        }
      }
      // Try deployment id
      {
        const idx = await loadIndex(repoRoot, customDir);
        const depKey = `vercel:${identifier}`;
        const cid = idx.byDeployment[depKey];
        if (cid) return loadChange(repoRoot, cid, customDir);
      }
      // Try intent
      {
        const idx = await loadIndex(repoRoot, customDir);
        for (const [key, cid] of Object.entries(idx.byIntent)) {
          if (key.endsWith(`:${identifier}`)) {
            return loadChange(repoRoot, cid, customDir);
          }
        }
      }
      // Try change id directly
      const direct = await loadChange(repoRoot, identifier, customDir);
      if (direct) return direct;

      return null;
    },
    async list(): Promise<readonly Change[]> {
      return listChanges(repoRoot, customDir);
    },
  };
}
