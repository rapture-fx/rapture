import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ServiceConfig {
  readonly provider: string;
  readonly providerProject: string;
  readonly repository?: string | null;
}

export interface DeploymentConfig {
  readonly services: Record<string, ServiceConfig>;
}

export async function loadConfig(
  repoRoot: string,
  configPath = "experiments/deployment-api/config.json",
): Promise<DeploymentConfig> {
  const raw = await readFile(resolve(repoRoot, configPath), "utf8");
  return JSON.parse(raw) as DeploymentConfig;
}

export function resolveService(config: DeploymentConfig, service: string): ServiceConfig | null {
  return config.services[service] ?? null;
}
