import {
  RECEIPT_PAYLOAD_TYPE,
  type ReceiptEnvelope,
  signPayload,
  verifyReceipt,
} from "@rapture/kernel";
import type { VerificationIntegrityReport } from "./integrity-report.js";
import type { VerificationScan } from "./verification-scan.js";

export const VERIFICATION_RECEIPT_SCHEMA_VERSION = 1;

export interface VerificationReceiptPayload {
  readonly schemaVersion: 1;
  readonly kind: "verification-integrity";
  readonly report: Omit<VerificationIntegrityReport, "generatedAt"> & {
    readonly generatedAt: string;
  };
}

export function createVerificationReceipt(input: {
  readonly report: VerificationIntegrityReport;
  readonly privateKeyPem: string;
}): ReceiptEnvelope {
  return signPayload({
    payloadObject: {
      schemaVersion: VERIFICATION_RECEIPT_SCHEMA_VERSION,
      kind: "verification-integrity",
      report: input.report,
    },
    privateKeyPem: input.privateKeyPem,
  });
}

export interface ScanReceiptPayload {
  readonly schemaVersion: 1;
  readonly kind: "verification-scan";
  readonly scanSummary: {
    readonly repository: string;
    readonly baseRef: string;
    readonly headRef: string;
    readonly commitsScanned: number;
    readonly overallVerdict: "ACCEPT" | "WARN" | "REJECT";
    readonly totalSignals: number;
    readonly criticalCount: number;
    readonly highCount: number;
    readonly mediumCount: number;
    readonly generatedAt: string;
  };
}

export function createScanReceipt(input: {
  readonly scan: Pick<
    VerificationScan,
    | "repository"
    | "baseRef"
    | "headRef"
    | "commitsScanned"
    | "overallVerdict"
    | "totalSignals"
    | "criticalCount"
    | "highCount"
    | "mediumCount"
    | "generatedAt"
  >;
  readonly privateKeyPem: string;
}): ReceiptEnvelope {
  const { privateKeyPem, scan } = input;
  return signPayload({
    payloadObject: {
      schemaVersion: VERIFICATION_RECEIPT_SCHEMA_VERSION,
      kind: "verification-scan",
      scanSummary: {
        repository: scan.repository,
        baseRef: scan.baseRef,
        headRef: scan.headRef,
        commitsScanned: scan.commitsScanned,
        overallVerdict: scan.overallVerdict,
        totalSignals: scan.totalSignals,
        criticalCount: scan.criticalCount,
        highCount: scan.highCount,
        mediumCount: scan.mediumCount,
        generatedAt: scan.generatedAt,
      },
    },
    privateKeyPem,
  });
}

export function parseScanReceipt(
  envelope: ReceiptEnvelope,
  trustedKeys: Readonly<Record<string, string>>,
): { valid: boolean; payload: ScanReceiptPayload } {
  const result = verifyReceipt(envelope, trustedKeys);
  const payload = result.payload as Partial<ScanReceiptPayload> | null;
  const wellFormed =
    payload !== null &&
    typeof payload === "object" &&
    payload.kind === "verification-scan" &&
    payload.schemaVersion === 1 &&
    typeof payload.scanSummary === "object";
  if (!wellFormed && result.valid) {
    throw new Error("receipt signature valid but payload is not a verification-scan receipt");
  }
  return { valid: result.valid && wellFormed, payload: result.payload as ScanReceiptPayload };
}

export type AnyVerificationReceiptPayload = VerificationReceiptPayload | ScanReceiptPayload;

export function parseReceipt(
  envelope: ReceiptEnvelope,
  trustedKeys: Readonly<Record<string, string>>,
): { valid: boolean; payload: AnyVerificationReceiptPayload } {
  const result = verifyReceipt(envelope, trustedKeys);
  if (!result.valid) {
    return { valid: false, payload: result.payload as AnyVerificationReceiptPayload };
  }
  const payload = result.payload as Partial<AnyVerificationReceiptPayload> | null;
  const kind = payload?.kind;
  if (kind === "verification-integrity" || kind === "verification-scan") {
    return { valid: true, payload: result.payload as AnyVerificationReceiptPayload };
  }
  throw new Error(`receipt signature valid but payload kind is unrecognized: ${String(kind)}`);
}

export function parseVerificationReceipt(
  envelope: ReceiptEnvelope,
  trustedKeys: Readonly<Record<string, string>>,
): { readonly valid: boolean; readonly payload: VerificationReceiptPayload } {
  if (envelope.payloadType !== RECEIPT_PAYLOAD_TYPE) {
    throw new Error(`not a verification receipt: ${envelope.payloadType}`);
  }
  const result = verifyReceipt(envelope, trustedKeys);
  const payload = result.payload as Partial<VerificationReceiptPayload> | null;
  const wellFormed =
    payload !== null &&
    typeof payload === "object" &&
    payload.kind === "verification-integrity" &&
    payload.schemaVersion === 1 &&
    typeof payload.report === "object";
  if (!wellFormed && result.valid) {
    throw new Error("receipt signature valid but payload is not a verification-integrity receipt");
  }
  return {
    valid: result.valid && wellFormed,
    payload: result.payload as VerificationReceiptPayload,
  };
}
