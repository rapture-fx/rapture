export interface DeployInput {
  readonly service: string;
  readonly environment: string;
  readonly sourceRevision: string;
  readonly repository?: string | null;
}

export interface DeployResult {
  readonly deploymentId: string;
  readonly service: string;
  readonly environment: string;
  readonly sourceRevision: string | null;
  readonly status:
    | "queued"
    | "building"
    | "deploying"
    | "ready"
    | "failed"
    | "cancelled"
    | "unknown";
  readonly provider: string;
  readonly productionChangeId: string | null;
  /** Sanitized provider evidence for the mutation that produced this result. */
  readonly raw?: Record<string, unknown>;
}

export interface RollbackInput {
  readonly service: string;
  readonly environment: string;
  readonly target: "previous";
}

export interface RollbackResult {
  readonly deploymentId: string;
  readonly rolledBackFrom: string | null;
  readonly rolledBackTo: string | null;
  readonly status: string;
  readonly provider: string;
  readonly productionChangeId: string | null;
  readonly service?: string;
  readonly environment?: string;
  readonly currentDeploymentId?: string | null;
  readonly currentSourceRevision?: string | null;
  readonly previousDeploymentId?: string | null;
  readonly previousSourceRevision?: string | null;
  readonly plannedTransition?: string;
}

export interface DeploymentStatus {
  readonly deploymentId: string;
  readonly status: DeployResult["status"];
  readonly provider: string;
}
