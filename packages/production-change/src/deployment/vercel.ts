import { execa } from "execa";
import type { DeploymentProvider } from "./provider.js";
import type {
  DeployInput,
  DeployResult,
  RollbackInput,
  RollbackResult,
  DeploymentStatus,
} from "./types.js";
import { createProductionApi } from "../api/production.js";
import { checkoutRevision } from "./worktree.js";

function normalizeStatus(state: string): DeployResult["status"] {
  const s = state.toLowerCase();
  if (s === "queued") return "queued";
  if (s === "building") return "building";
  if (s === "deploying") return "deploying";
  if (s === "ready") return "ready";
  if (s === "error" || s === "failed") return "failed";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  return "unknown";
}

/**
 * Extract the production deployment URL from `vercel deploy` output.
 *
 * On success the URL is the last stdout line, but on a build failure stdout is a
 * JSON error object — taking the last line there yields "}" as the deployment
 * identity. The URL is announced on stderr in both cases, so prefer that.
 */
export function parseVercelDeploymentUrl(stdout: string, stderr: string): string | null {
  const combined = `${stderr}\n${stdout}`;
  const production = combined.match(/^\s*Production\s+(https:\/\/\S+)/m);
  if (production?.[1]) return production[1];
  const any = combined.match(/https:\/\/[a-z0-9-]+\.vercel\.app\b/i);
  return any?.[0] ?? null;
}

export function createVercelProvider(
  repoRoot: string,
  providerProject: string,
): DeploymentProvider {
  return {
    provider: "vercel",
    async deploy(input: DeployInput): Promise<DeployResult> {
      // The requested revision is materialized in a throwaway worktree; the
      // primary tree is never checked out (it may hold uncommitted work).
      const src = await checkoutRevision(repoRoot, input.sourceRevision);
      try {
        // Bind the throwaway directory to the configured project, otherwise
        // `vercel deploy --yes` would create a project named after the temp dir.
        const linkRes = await execa(
          "vercel",
          ["link", "--yes", "--project", providerProject, "--cwd", src.dir],
          { reject: false },
        );
        if (linkRes.exitCode !== 0) {
          throw new Error(`vercel link to project ${providerProject} failed: ${linkRes.stderr}`);
        }
        const deployRes = await execa("vercel", ["deploy", "--prod", "--yes", "--cwd", src.dir], {
          reject: false,
        });
        const url = parseVercelDeploymentUrl(deployRes.stdout, deployRes.stderr);
        const deploymentId = url ? url.replace(/^https:\/\//, "") : `vercel-${Date.now()}`;
        const status: DeployResult["status"] = deployRes.exitCode === 0 ? "ready" : "failed";
        return {
          deploymentId,
          service: input.service,
          environment: input.environment,
          // Report the resolved sha actually deployed, never the caller's input.
          sourceRevision: src.resolvedSha,
          status,
          provider: "vercel",
          productionChangeId: null,
          raw: {
            exitCode: deployRes.exitCode,
            stdout: deployRes.stdout.slice(0, 4000),
            stderr: deployRes.stderr.slice(0, 4000),
          },
        };
      } finally {
        await src.dispose();
      }
    },
    async getStatus(deploymentId: string): Promise<DeploymentStatus> {
      const res = await execa("vercel", ["inspect", deploymentId, "--json"], { reject: false });
      let status: DeploymentStatus["status"] = "unknown";
      try {
        const data = JSON.parse(res.stdout);
        if (data.state) status = normalizeStatus(data.state);
        else if (data.readyState) status = normalizeStatus(data.readyState);
        else status = res.exitCode === 0 ? "ready" : "failed";
      } catch {
        status = res.exitCode === 0 ? "ready" : "unknown";
      }
      return { deploymentId, status, provider: "vercel" };
    },
    async rollback(input: RollbackInput): Promise<RollbackResult> {
      const api = createProductionApi(repoRoot);
      // Resolve current and previous via ProductionChange
      const current = await api.current(input.service, input.environment);
      if (!current) throw new Error(`no current for ${input.service} ${input.environment}`);
      const prevId = current.transition.previousProductionChangeId;
      if (!prevId) throw new Error(`no previous for ${input.service} ${input.environment}`);
      const prev = await api.get(prevId);
      if (!prev) throw new Error(`previous not found ${prevId}`);
      const targetSha = prev.source.commitSha;
      if (!targetSha) throw new Error(`previous has no commitSha`);

      // Plan is to redeploy previous commit
      const deployRes = await this.deploy({
        service: input.service,
        environment: input.environment,
        sourceRevision: targetSha,
      });

      return {
        deploymentId: deployRes.deploymentId,
        rolledBackFrom: current.deployment.externalId,
        rolledBackTo: prev.deployment.externalId,
        status: deployRes.status,
        provider: "vercel",
        productionChangeId: deployRes.productionChangeId,
      };
    },
  };
}
