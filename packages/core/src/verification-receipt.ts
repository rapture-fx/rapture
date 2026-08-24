import {
  RECEIPT_PAYLOAD_TYPE,
  type ReceiptEnvelope,
  signPayload,
  verifyReceipt,
} from "@rapture/kernel";
import type { VerificationIntegrityReport } from "./integrity-report.js";

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
