import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { saveRaw } from "../store/storage.js";
import { buildChanges } from "../joins/builder.js";
import { githubAdapter } from "../adapters/github.js";
import { githubActionsAdapter } from "../adapters/github-actions.js";
import { vercelAdapter } from "../adapters/vercel.js";
import { linearAdapter } from "../adapters/linear.js";
import { sentryAdapter } from "../adapters/sentry.js";
import type { NormalizedRecords } from "../adapters/contracts.js";
import { listRaw, saveCanonical } from "../store/storage.js";
import { createChangeApi } from "../api/changes.js";

export interface ChangeCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export async function handleChange(argv: readonly string[], io: ChangeCliIo, repoRoot: string): Promise<number> {
  const cmd = argv[0];
  if (cmd === "ingest") {
    return handleIngest(argv.slice(1), io, repoRoot);
  }
  if (cmd === "build") {
    return handleBuild(io, repoRoot);
  }
  if (cmd === "list") {
    const json = argv.includes("--json");
    const api = createChangeApi(repoRoot);
    const changes = await api.list();
    if (json) {
      io.stdout(`${JSON.stringify(changes, null, 2)}\n`);
    } else {
      if (changes.length === 0) io.stdout("No changes\n");
      else for (const ch of changes) io.stdout(`${ch.id}\t${ch.pullRequests[0]?.title ?? ch.commits[0]?.message?.slice(0, 60) ?? "unknown"}\t${ch.provenance.sources.length} sources\n`);
    }
    return 0;
  }
  if (cmd === "show") {
    const id = argv[1];
    const json = argv.includes("--json");
    if (!id) {
      io.stderr("usage: rapture change show <change-id> [--json]\n");
      return 2;
    }
    const api = createChangeApi(repoRoot);
    const ch = await api.get(id);
    if (!ch) {
      io.stderr(`change not found: ${id}\n`);
      return 2;
    }
    if (json) io.stdout(`${JSON.stringify(ch, null, 2)}\n`);
    else io.stdout(formatChange(ch));
    return 0;
  }
  if (cmd === "trace") {
    const identifier = argv[1];
    const json = argv.includes("--json");
    if (!identifier) {
      io.stderr("usage: rapture change trace <identifier> [--json]\n");
      return 2;
    }
    const api = createChangeApi(repoRoot);
    const ch = await api.trace(identifier);
    if (!ch) {
      io.stderr(`no change found for identifier: ${identifier}\n`);
      return 2;
    }
    if (json) io.stdout(`${JSON.stringify(ch, null, 2)}\n`);
    else io.stdout(formatChange(ch));
    return 0;
  }
  io.stderr("usage: rapture change <ingest|build|list|show|trace> ...\n");
  return 2;
}

async function handleIngest(argv: readonly string[], io: ChangeCliIo, repoRoot: string): Promise<number> {
  const provider = argv[0];
  if (!provider || !["github", "github_actions", "vercel", "linear", "sentry"].includes(provider)) {
    io.stderr("usage: rapture change ingest <provider> [--file <path>] [--repo <repo>] [--id <id>]\n");
    return 2;
  }
  const fileIdx = argv.indexOf("--file");
  let data: unknown = null;
  let externalId = "unknown";
  if (fileIdx !== -1 && argv[fileIdx + 1]) {
    const filePath = resolve(argv[fileIdx + 1]!);
    const raw = await readFile(filePath, "utf8");
    data = JSON.parse(raw);
    externalId = (data as Record<string, unknown>)["id"] as string || (data as Record<string, unknown>)["number"] as string || filePath;
  } else {
    io.stderr("ingest requires --file <path> in V0 (live API not yet implemented for this provider)\n");
    return 2;
  }
  const repoIdx = argv.indexOf("--repo");
  if (repoIdx !== -1 && argv[repoIdx + 1]) {
    // add repository to data for normalization
    (data as Record<string, unknown>)["repository"] = argv[repoIdx + 1];
  }
  await saveRaw(repoRoot, provider as never, String(externalId), data);
  io.stdout(`ingested ${provider} ${externalId}\n`);
  return 0;
}

async function handleBuild(io: ChangeCliIo, repoRoot: string): Promise<number> {
  // Load all raw snapshots and normalize
  const store = {
    pullRequests: [] as never[],
    commits: [] as never[],
    checks: [] as never[],
    deployments: [] as never[],
    productionEffects: [] as never[],
    intents: [] as never[],
  } as unknown as NormalizedRecords & {
    pullRequests: never[];
    commits: never[];
    checks: never[];
    deployments: never[];
    productionEffects: never[];
    intents: never[];
  };

  const adapters = {
    github: githubAdapter,
    github_actions: githubActionsAdapter,
    vercel: vercelAdapter,
    linear: linearAdapter,
    sentry: sentryAdapter,
  } as const;

  for (const provider of Object.keys(adapters) as (keyof typeof adapters)[]) {
    const raws = await listRaw(repoRoot, provider);
    for (const raw of raws) {
      const snapshot = { provider, externalId: raw.externalId, fetchedAt: new Date().toISOString(), data: raw.data };
      const normalized = adapters[provider].normalize(snapshot as never);
      if (normalized.pullRequests) (store.pullRequests as unknown[]).push(...normalized.pullRequests);
      if (normalized.commits) (store.commits as unknown[]).push(...normalized.commits);
      if (normalized.checks) (store.checks as unknown[]).push(...normalized.checks);
      if (normalized.deployments) (store.deployments as unknown[]).push(...normalized.deployments);
      if (normalized.productionEffects) (store.productionEffects as unknown[]).push(...normalized.productionEffects);
      if (normalized.intents) (store.intents as unknown[]).push(...normalized.intents);
    }
  }

  const changes = buildChanges(store);
  for (const ch of changes) {
    await saveCanonical(repoRoot, ch);
  }
  io.stdout(`built ${changes.length} changes\n`);
  return 0;
}

function formatChange(ch: import("../schema/change.js").Change): string {
  const lines: string[] = [];
  lines.push(`Change ${ch.id}`);
  lines.push(`  Intent: ${ch.intent ? `${ch.intent.source}:${ch.intent.externalId} ${ch.intent.title ?? ""}` : "unknown"}`);
  lines.push(`  PRs: ${ch.pullRequests.map((pr) => `#${pr.number} ${pr.title} (${pr.state})`).join(", ") || "none"}`);
  lines.push(`  Commits: ${ch.commits.map((c) => c.sha.slice(0, 7)).join(", ") || "none"}`);
  lines.push(`  Checks: ${ch.checks.map((c) => `${c.name}:${c.status}`).join(", ") || "none"}`);
  lines.push(`  Deployments: ${ch.deployments.map((d) => `${d.provider}:${d.externalId} ${d.environment} ${d.status}`).join(", ") || "none"}`);
  lines.push(`  Effects: ${ch.productionEffects.map((e) => `${e.provider}:${e.type} ${e.title ?? e.externalId}`).join(", ") || "none"}`);
  lines.push(`  Relationships: ${ch.relationships.length}`);
  for (const rel of ch.relationships) lines.push(`    ${rel.from} --${rel.type}--> ${rel.to} [${rel.provenance.rule}]`);
  lines.push(`  Provenance: ${ch.provenance.sources.join(", ")} @ ${ch.provenance.constructedAt}`);
  return lines.join("\n") + "\n";
}
