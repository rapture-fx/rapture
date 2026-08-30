import type {
  DeployInput,
  DeployResult,
  RollbackInput,
  RollbackResult,
  DeploymentStatus,
} from "./types.js";

export interface DeploymentProvider {
  readonly provider: string;
  deploy(input: DeployInput): Promise<DeployResult>;
  getStatus(deploymentId: string): Promise<DeploymentStatus>;
  rollback(input: RollbackInput): Promise<RollbackResult>;
  // Optional: plan rollback without mutating
  planRollback?(input: RollbackInput): Promise<{
    service: string;
    environment: string;
    currentDeploymentId: string | null;
    currentSourceRevision: string | null;
    previousDeploymentId: string | null;
    previousSourceRevision: string | null;
    provider: string;
    plannedTransition: string;
  }>;
}
