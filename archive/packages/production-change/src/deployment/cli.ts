import { deploy, getStatus, rollback, planRollback } from "./api.js";

export interface DeployCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export async function handleDeploy(
  argv: readonly string[],
  io: DeployCliIo,
  repoRoot: string,
): Promise<number> {
  // rapture deploy <service> --revision <sha> --env <env> [--json]
  const service = argv[0];
  const revIdx = argv.indexOf("--revision");
  const envIdx = argv.indexOf("--env");
  const json = argv.includes("--json");
  if (!service || revIdx === -1 || !argv[revIdx + 1]) {
    io.stderr("usage: rapture deploy <service> --revision <sha> --env <environment> [--json]\n");
    return 2;
  }
  const revision = argv[revIdx + 1]!;
  const environment = envIdx !== -1 && argv[envIdx + 1] ? argv[envIdx + 1]! : "production";
  const result = await deploy(repoRoot, { service, environment, sourceRevision: revision });
  if (json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  else
    io.stdout(
      `deployed ${result.service} ${result.environment} ${result.deploymentId} ${result.status} ${result.sourceRevision ?? ""}\n`,
    );
  return result.status === "failed" ? 1 : 0;
}

export async function handleDeploymentStatus(
  argv: readonly string[],
  io: DeployCliIo,
  repoRoot: string,
): Promise<number> {
  const id = argv[0];
  const json = argv.includes("--json");
  if (!id) {
    io.stderr("usage: rapture deployment status <deployment-id> [--json]\n");
    return 2;
  }
  const status = await getStatus(repoRoot, id);
  if (json) io.stdout(`${JSON.stringify(status, null, 2)}\n`);
  else io.stdout(`${status.deploymentId} ${status.provider} ${status.status}\n`);
  return 0;
}

export async function handleRollback(
  argv: readonly string[],
  io: DeployCliIo,
  repoRoot: string,
): Promise<number> {
  // rapture rollback <service> --env <env> --to previous [--dry-run] [--json]
  const service = argv[0];
  const envIdx = argv.indexOf("--env");
  const toIdx = argv.indexOf("--to");
  const dryRun = argv.includes("--dry-run");
  const json = argv.includes("--json");
  if (!service || toIdx === -1 || argv[toIdx + 1] !== "previous") {
    io.stderr(
      "usage: rapture rollback <service> --env <environment> --to previous [--dry-run] [--json]\n",
    );
    return 2;
  }
  const environment = envIdx !== -1 && argv[envIdx + 1] ? argv[envIdx + 1]! : "production";
  if (dryRun) {
    const plan = await planRollback(repoRoot, { service, environment, target: "previous" });
    if (json) io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    else {
      io.stdout(`Rollback plan for ${plan.service} ${plan.environment}:\n`);
      io.stdout(`  current: ${plan.currentDeploymentId} ${plan.currentSourceRevision}\n`);
      io.stdout(`  previous: ${plan.previousDeploymentId} ${plan.previousSourceRevision}\n`);
      io.stdout(`  transition: ${plan.plannedTransition}\n`);
      io.stdout(`  provider: ${plan.provider}\n`);
    }
    return 0;
  }
  const result = await rollback(repoRoot, { service, environment, target: "previous" });
  if (json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  else {
    io.stdout(
      `rolled back ${result.service} ${result.environment} ${result.rolledBackFrom} -> ${result.rolledBackTo} ${result.status}\n`,
    );
  }
  return result.status === "failed" ? 1 : 0;
}
