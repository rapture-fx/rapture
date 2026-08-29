import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProductionChanges } from "../joins/production-builder.js";
import { vercelAdapter } from "../adapters/vercel.js";
import { kubernetesAdapter } from "../adapters/kubernetes.js";
import { cloudflareAdapter } from "../adapters/cloudflare.js";
import { createProductionApi } from "../api/production.js";

export interface ProdCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export async function handleProduction(argv: readonly string[], io: ProdCliIo, repoRoot: string): Promise<number> {
  const cmd = argv[0];
  if (cmd === "ingest") {
    return handleIngest(argv.slice(1), io, repoRoot);
  }
  if (cmd === "build") {
    return handleBuild(io, repoRoot);
  }
  if (cmd === "current") {
    const service = argv[1];
    const envIdx = argv.indexOf("--env");
    const env = envIdx !== -1 ? argv[envIdx + 1] : "production";
    const json = argv.includes("--json");
    if (!service) {
      io.stderr("usage: rapture production current <service> --env <env> [--json]\n");
      return 2;
    }
    const api = createProductionApi(repoRoot);
    const pc = await api.current(service, env ?? "production");
    if (!pc) {
      io.stderr(`no current production change for ${service} env ${env}\n`);
      return 2;
    }
    if (json) io.stdout(`${JSON.stringify(pc, null, 2)}\n`);
    else io.stdout(formatProductionChange(pc));
    return 0;
  }
  if (cmd === "history") {
    const service = argv[1];
    const envIdx = argv.indexOf("--env");
    const env = envIdx !== -1 ? argv[envIdx + 1] : "production";
    const json = argv.includes("--json");
    if (!service) {
      io.stderr("usage: rapture production history <service> --env <env> [--json]\n");
      return 2;
    }
    const api = createProductionApi(repoRoot);
    const hist = await api.history(service, env ?? "production");
    if (json) io.stdout(`${JSON.stringify(hist, null, 2)}\n`);
    else {
      if (hist.length === 0) io.stdout("No history\n");
      else for (const pc of hist) io.stdout(`${pc.id}\t${pc.source.commitSha?.slice(0, 7) ?? "no-sha"}\t${pc.deployment.status}\t${pc.deployment.completedAt ?? ""}\n`);
    }
    return 0;
  }
  if (cmd === "show") {
    const id = argv[1];
    const json = argv.includes("--json");
    if (!id) {
      io.stderr("usage: rapture production show <id> [--json]\n");
      return 2;
    }
    const api = createProductionApi(repoRoot);
    const pc = await api.get(id);
    if (!pc) {
      io.stderr(`not found: ${id}\n`);
      return 2;
    }
    if (json) io.stdout(`${JSON.stringify(pc, null, 2)}\n`);
    else io.stdout(formatProductionChange(pc));
    return 0;
  }
  if (cmd === "trace") {
    const identifier = argv[1];
    const json = argv.includes("--json");
    if (!identifier) {
      io.stderr("usage: rapture production trace <identifier> [--json]\n");
      return 2;
    }
    const api = createProductionApi(repoRoot);
    const pc = await api.trace(identifier);
    if (!pc) {
      io.stderr(`no production change for ${identifier}\n`);
      return 2;
    }
    if (json) io.stdout(`${JSON.stringify(pc, null, 2)}\n`);
    else io.stdout(formatProductionChange(pc));
    return 0;
  }
  io.stderr("usage: rapture production <ingest|build|current|history|show|trace> ...\n");
  return 2;
}

async function handleIngest(argv: readonly string[], io: ProdCliIo, repoRoot: string): Promise<number> {
  const provider = argv[0];
  if (!provider || !["vercel", "kubernetes", "cloudflare", "sentry", "github"].includes(provider)) {
    io.stderr("usage: rapture production ingest <provider> --file <path>\n");
    return 2;
  }
  const fileIdx = argv.indexOf("--file");
  if (fileIdx === -1 || !argv[fileIdx + 1]) {
    io.stderr("ingest requires --file <path>\n");
    return 2;
  }
  const filePath = resolve(argv[fileIdx + 1]!);
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  const externalId = (data as Record<string, unknown>)["id"] as string || (data as Record<string, unknown>)["uid"] as string || filePath;
  const { saveRaw } = await import("../store/storage.js");
  await saveRaw(repoRoot, provider, String(externalId), data);
  io.stdout(`ingested ${provider} ${externalId}\n`);
  return 0;
}

async function handleBuild(io: ProdCliIo, repoRoot: string): Promise<number> {
  const { listRaw, saveProductionChange } = await import("../store/storage.js");
  const adapters: Record<string, { normalize: (raw: { provider: string; externalId: string; fetchedAt: string; data: unknown }) => import("../adapters/contracts.js").DeploymentRecord | null }> = {
    vercel: vercelAdapter,
    kubernetes: kubernetesAdapter,
    cloudflare: cloudflareAdapter,
  };
  const deployments: import("../adapters/contracts.js").DeploymentRecord[] = [];
  for (const provider of Object.keys(adapters) as (keyof typeof adapters)[]) {
    const raws = await listRaw(repoRoot, provider);
    for (const raw of raws) {
      const rec = adapters[provider]!.normalize({ provider, externalId: raw.externalId, fetchedAt: new Date().toISOString(), data: raw.data });
      if (rec) deployments.push(rec);
    }
  }
  // Sentry and GitHub are handled via runtime observations, but for V0 we just use deployments
  const changes = buildProductionChanges({ deployments });
  for (const pc of changes) {
    await saveProductionChange(repoRoot, pc);
  }
  io.stdout(`built ${changes.length} production changes\n`);
  return 0;
}

function formatProductionChange(pc: import("../schema/production-change.js").ProductionChange): string {
  const lines: string[] = [];
  lines.push(`ProductionChange ${pc.id}`);
  lines.push(`  Service: ${pc.service.name} (${pc.service.id})`);
  lines.push(`  Env: ${pc.environment.name} (${pc.environment.providerEnvironmentId ?? "unknown"})`);
  lines.push(`  Source: ${pc.source.repository ?? "unknown"} ${pc.source.commitSha ?? "no-sha"} ${pc.source.branch ?? ""}`);
  lines.push(`  Artifact: ${pc.artifact.type} ${pc.artifact.digest ?? pc.artifact.externalId ?? "unknown"}`);
  lines.push(`  Deployment: ${pc.deployment.provider}:${pc.deployment.externalId} ${pc.deployment.status} ${pc.deployment.completedAt ?? ""}`);
  lines.push(`  Transition: prev ${pc.transition.previousProductionChangeId ?? "none"} prevSha ${pc.transition.previousCommitSha ?? "none"} -> ${pc.transition.resultingCommitSha ?? "none"}`);
  lines.push(`  Observations: ${pc.runtimeObservations.length}`);
  for (const obs of pc.runtimeObservations) lines.push(`    ${obs.provider}:${obs.type} ${obs.externalId} [${obs.deterministicLinkRule}]`);
  lines.push(`  Provenance: ${pc.provenance.sources.join(", ")} @ ${pc.provenance.constructedAt}`);
  return lines.join("\n") + "\n";
}
