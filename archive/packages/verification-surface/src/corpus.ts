import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ChangedFile, PullRequestInput } from "./types.js";

export interface CorpusEntry {
  readonly repo: string;
  readonly prNumber: number;
  readonly agent: string;
  readonly url: string;
}

/** Load the frozen PR corpus from its on-disk evidence directory. */
export function loadCorpus(corpusRoot: string): readonly PullRequestInput[] {
  const manifest = JSON.parse(readFileSync(join(corpusRoot, "manifest.json"), "utf8")) as {
    repo: string;
    prNumber: number;
    baseSha: string;
    headSha: string;
  }[];
  const out: PullRequestInput[] = [];
  for (const m of manifest) {
    const dir = join(corpusRoot, "raw", m.repo.replace("/", "__"), String(m.prNumber));
    if (!existsSync(dir)) continue;
    const allFiles = JSON.parse(readFileSync(join(dir, "files.json"), "utf8")) as {
      filename: string;
      status: string;
      previous_filename?: string;
    }[];
    const vfiles = JSON.parse(readFileSync(join(dir, "verification-files.json"), "utf8")) as {
      filename: string;
      status: string;
      key: string;
      hasBase: boolean;
      hasHead: boolean;
      previousFilename?: string | null;
    }[];
    const files: ChangedFile[] = vfiles.map((f) => {
      const basePath = join(dir, `base__${f.key}.txt`);
      const headPath = join(dir, `head__${f.key}.txt`);
      return {
        filename: f.filename,
        previousFilename: f.previousFilename ?? null,
        status: f.status as ChangedFile["status"],
        baseContent: f.hasBase && existsSync(basePath) ? readFileSync(basePath, "utf8") : null,
        headContent: f.hasHead && existsSync(headPath) ? readFileSync(headPath, "utf8") : null,
      };
    });
    out.push({
      repo: m.repo,
      prNumber: m.prNumber,
      baseSha: m.baseSha,
      headSha: m.headSha,
      allChangedPaths: allFiles.map((f) => ({ path: f.filename, status: f.status })),
      files,
    });
  }
  return out;
}

export function listCorpusDirs(corpusRoot: string): readonly string[] {
  const raw = join(corpusRoot, "raw");
  const out: string[] = [];
  for (const repo of readdirSync(raw)) for (const pr of readdirSync(join(raw, repo))) out.push(`${repo}/${pr}`);
  return out;
}
