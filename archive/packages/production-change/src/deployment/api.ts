import { loadConfig, resolveService } from "./config.js";
import { createVercelProvider } from "./vercel.js";
import { createCloudflareProvider } from "./cloudflare.js";
import type { DeploymentProvider } from "./provider.js";
import type {
  DeployInput,
  DeployResult,
  RollbackInput,
  RollbackResult,
  DeploymentStatus,
} from "./types.js";
import { createProductionApi } from "../api/production.js";
import { saveProductionChange } from "../store/storage.js";
import { buildProductionChanges } from "../joins/production-builder.js";
import type { DeploymentRecord } from "../adapters/contracts.js";

function getProvider(
  repoRoot: string,
  service: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
): DeploymentProvider {
  const svc = resolveService(config, service);
  if (!svc) throw new Error(`service not found: ${service}`);
  if (svc.provider === "vercel") return createVercelProvider(repoRoot, svc.providerProject);
  if (svc.provider === "cloudflare") return createCloudflareProvider(repoRoot, svc.providerProject);
  throw new Error(`unsupported provider: ${svc.provider}`);
}

export async function deploy(repoRoot: string, input: DeployInput): Promise<DeployResult> {
  const config = await loadConfig(repoRoot);
  const provider = getProvider(repoRoot, input.service, config);
  const result = await provider.deploy(input);
  // Build a DeploymentRecord for canonical storage
  const record: DeploymentRecord = {
    provider: result.provider,
    externalId: result.deploymentId,
    serviceId: `${result.provider}:${input.service}`,
    serviceName: input.service,
    environment: input.environment,
    providerEnvironmentId: input.environment,
    status: result.status,
    startedAt: new Date().toISOString(),
    completedAt: result.status === "ready" ? new Date().toISOString() : null,
    commitSha: result.sourceRevision,
    branch: null,
    repository: (await loadConfig(repoRoot)).services[input.service]?.repository ?? null,
    artifactDigest: null,
    artifactExternalId: result.deploymentId,
    raw: { deploymentId: result.deploymentId, status: result.status },
  };
  // Save raw and canonical
  const { saveRaw } = await import("../store/storage.js");
  await saveRaw(repoRoot, result.provider, result.deploymentId, {
    id: result.deploymentId,
    status: result.status,
    commitSha: result.sourceRevision,
    providerEvidence: result.raw ?? null,
  });
  // Build a single ProductionChange for this deployment
  const changes = buildProductionChanges({ deployments: [record] });
  let finalResult: DeployResult = result;
  for (const pc of changes) {
    await saveProductionChange(repoRoot, pc);
    finalResult = { ...result, productionChangeId: pc.id };
  }
  return finalResult;
}

export async function getStatus(
  repoRoot: string,
  deploymentId: string,
  _serviceHint?: string,
): Promise<DeploymentStatus> {
  // Route by configured service rather than probing every provider in turn:
  // probing misattributes a deployment whenever one provider happens to answer
  // for an id that belongs to another.
  const config = await loadConfig(repoRoot);
  const candidates = _serviceHint
    ? [_serviceHint].filter((s) => resolveService(config, s) !== null)
    : Object.keys(config.services);
  for (const service of candidates) {
    const svc = resolveService(config, service);
    if (!svc) continue;
    try {
      const s = await getProvider(repoRoot, service, config).getStatus(deploymentId);
      if (s.status !== "unknown") return s;
    } catch {}
  }
  return { deploymentId, status: "unknown", provider: "unknown" };
}

export async function rollback(repoRoot: string, input: RollbackInput): Promise<RollbackResult> {
  const config = await loadConfig(repoRoot);
  const provider = getProvider(repoRoot, input.service, config);
  // Plan via ProductionChange
  const api = createProductionApi(repoRoot);
  const current = await api.current(input.service, input.environment);
  if (!current) throw new Error(`no current for ${input.service} ${input.environment}`);
  const previousId = current.transition.previousProductionChangeId;
  if (!previousId) throw new Error(`no previous for ${input.service} ${input.environment}`);
  const previous = await api.get(previousId);
  if (!previous) throw new Error(`previous not found ${previousId}`);

  const plan = {
    service: input.service,
    environment: input.environment,
    currentDeploymentId: current.deployment.externalId,
    currentSourceRevision: current.source.commitSha,
    previousDeploymentId: previous.deployment.externalId,
    previousSourceRevision: previous.source.commitSha,
    provider: current.deployment.provider,
    plannedTransition: `${current.source.commitSha} -> ${previous.source.commitSha}`,
  };

  // For dry-run, caller can inspect plan without mutating
  // Actual rollback
  const result = await provider.rollback(input);
  // Re-ingest and rebuild is handled inside provider.rollback which does deploy
  // After rollback, save new canonical (already done in deploy)
  return { ...result, ...plan } as RollbackResult;
}

export async function planRollback(
  repoRoot: string,
  input: RollbackInput,
): Promise<{
  service: string;
  environment: string;
  currentDeploymentId: string | null;
  currentSourceRevision: string | null;
  previousDeploymentId: string | null;
  previousSourceRevision: string | null;
  provider: string;
  plannedTransition: string;
}> {
  const api = createProductionApi(repoRoot);
  const current = await api.current(input.service, input.environment);
  if (!current) throw new Error(`no current for ${input.service} ${input.environment}`);
  const prevId = current.transition.previousProductionChangeId;
  if (!prevId) throw new Error(`no previous for ${input.service} ${input.environment}`);
  const prev = await api.get(prevId);
  if (!prev) throw new Error(`previous not found ${prevId}`);
  return {
    service: input.service,
    environment: input.environment,
    currentDeploymentId: current.deployment.externalId,
    currentSourceRevision: current.source.commitSha,
    previousDeploymentId: prev.deployment.externalId,
    previousSourceRevision: prev.source.commitSha,
    provider: current.deployment.provider,
    plannedTransition: `${current.source.commitSha} -> ${prev.source.commitSha}`,
  };
}
