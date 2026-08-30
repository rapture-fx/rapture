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

export function normalizeStatus(status: string): DeployResult["status"] {
  const s = status.toLowerCase();
  if (s.includes("queued")) return "queued";
  if (s.includes("building")) return "building";
  if (s.includes("deploying")) return "deploying";
  // Cloudflare Pages reports "Failure" for a failed build; check failure terms
  // before the success terms so "ago" (see below) cannot shadow them.
  if (s.includes("failure") || s.includes("failed") || s.includes("error")) return "failed";
  if (s.includes("cancelled") || s.includes("canceled")) return "cancelled";
  // `wrangler pages deployment list` puts a RELATIVE TIME ("40 seconds ago") in
  // the Status column for deployments that built successfully; there is no
  // literal success token to match.
  if (s === "ready" || s.includes("ready") || s.includes("success") || s.includes("ago"))
    return "ready";
  return "unknown";
}

export function createCloudflareProvider(
  repoRoot: string,
  providerProject: string,
): DeploymentProvider {
  return {
    provider: "cloudflare",
    async deploy(input: DeployInput): Promise<DeployResult> {
      // Materialize the revision in a throwaway worktree rather than checking
      // out in the primary tree, which may hold uncommitted work.
      const src = await checkoutRevision(repoRoot, input.sourceRevision);
      try {
        const deployRes = await execa(
          "wrangler",
          [
            "pages",
            "deploy",
            ".",
            "--project-name",
            providerProject,
            "--branch",
            "main",
            "--commit-hash",
            src.resolvedSha,
          ],
          { cwd: src.dir, reject: false },
        );
        let deploymentId = `cloudflare-${Date.now()}`;
        const match = deployRes.stdout.match(/https:\/\/([a-z0-9]+)\.[a-z0-9-]+\.pages\.dev/);
        if (match?.[1]) deploymentId = match[1];
        const status: DeployResult["status"] = deployRes.exitCode === 0 ? "ready" : "failed";
        return {
          deploymentId,
          service: input.service,
          environment: input.environment,
          // Report the resolved sha actually deployed, never the caller's input.
          sourceRevision: src.resolvedSha,
          status,
          provider: "cloudflare",
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
      // Use wrangler pages deployment list and find
      const res = await execa(
        "wrangler",
        ["pages", "deployment", "list", "--project-name", providerProject, "--json"],
        { reject: false },
      );
      let status: DeploymentStatus["status"] = "unknown";
      try {
        const data = JSON.parse(res.stdout);
        // Deploy returns the pages.dev subdomain (an 8-char prefix) while the
        // list returns the full UUID, so match on either identity.
        const found = Array.isArray(data)
          ? data.find(
              (d: { Id?: string }) =>
                typeof d.Id === "string" &&
                (d.Id === deploymentId || d.Id.startsWith(`${deploymentId}-`)),
            )
          : null;
        // A deployment that is not in the list is NOT ready. Reporting success
        // for an id the provider never confirmed fabricates the status: the
        // previous `exitCode === 0` fallback returned "ready" for any id at all,
        // including ids that cannot exist.
        if (found?.Status) status = normalizeStatus(found.Status as string);
      } catch {
        status = "unknown";
      }
      return { deploymentId, status, provider: "cloudflare" };
    },
    async rollback(input: RollbackInput): Promise<RollbackResult> {
      const api = createProductionApi(repoRoot);
      const current = await api.current(input.service, input.environment);
      if (!current) throw new Error(`no current for ${input.service} ${input.environment}`);
      const prevId = current.transition.previousProductionChangeId;
      if (!prevId) throw new Error(`no previous for ${input.service} ${input.environment}`);
      const prev = await api.get(prevId);
      if (!prev) throw new Error(`previous not found ${prevId}`);
      const targetSha = prev.source.commitSha;
      if (!targetSha) throw new Error(`previous has no commitSha`);
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
        provider: "cloudflare",
        productionChangeId: deployRes.productionChangeId,
      };
    },
  };
}
