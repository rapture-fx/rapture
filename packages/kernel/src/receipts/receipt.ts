import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  generateKeyPairSync,
} from "node:crypto";

export const RECEIPT_PAYLOAD_TYPE = "https://rapture.dev/scenario-receipt/v1";
export const RECEIPT_SCHEMA_VERSION = 1;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function keyIdFor(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem, "utf8").digest("hex").slice(0, 16);
}

export interface GeneratedKeyPair {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly keyId: string;
}

export function generateSigningKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { privateKeyPem, publicKeyPem, keyId: keyIdFor(publicKeyPem) };
}

export function pae(payloadType: string, payload: Buffer): Buffer {
  const prefix = Buffer.from("DSSEv1", "utf8");
  const space = Buffer.from(" ", "utf8");
  const typeLength = Buffer.alloc(8);
  typeLength.writeBigUInt64LE(BigInt(Buffer.byteLength(payloadType, "utf8")));
  const typeBytes = Buffer.from(payloadType, "utf8");
  const payloadLength = Buffer.alloc(8);
  payloadLength.writeBigUInt64LE(BigInt(payload.length));
  return Buffer.concat([prefix, space, typeLength, typeBytes, space, payloadLength, payload]);
}

export interface ReceiptEnvelope {
  readonly payloadType: string;
  readonly payload: string;
  readonly signatures: readonly {
    readonly keyid: string;
    readonly sig: string;
  }[];
}

export class ReceiptSignatureError extends Error {
  public override readonly name = "ReceiptSignatureError";
}

export function signPayload(input: {
  readonly payloadObject: unknown;
  readonly privateKeyPem: string;
  readonly publicKeyPem?: string;
}): ReceiptEnvelope {
  const canonical = canonicalize(input.payloadObject);
  const payload = Buffer.from(canonical, "utf8");
  const publicKeyPem =
    input.publicKeyPem ??
    createPublicKey(createPrivateKey(input.privateKeyPem))
      .export({ type: "spki", format: "pem" })
      .toString();
  const signature = cryptoSign(
    null,
    pae(RECEIPT_PAYLOAD_TYPE, payload),
    createPrivateKey(input.privateKeyPem),
  );
  return {
    payloadType: RECEIPT_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: keyIdFor(publicKeyPem), sig: signature.toString("base64") }],
  };
}

export function verifyReceipt(
  envelope: ReceiptEnvelope,
  trustedKeys: Readonly<Record<string, string>>,
): { readonly valid: boolean; readonly payload: unknown } {
  if (envelope.payloadType !== RECEIPT_PAYLOAD_TYPE) {
    throw new ReceiptSignatureError(`unknown payload type: ${envelope.payloadType}`);
  }
  const payload = Buffer.from(envelope.payload, "base64");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8")) as unknown;
  } catch (error: unknown) {
    throw new ReceiptSignatureError("receipt payload is not valid JSON", { cause: error });
  }
  for (const signature of envelope.signatures) {
    const pem = trustedKeys[signature.keyid];
    if (pem === undefined) continue;
    const valid = cryptoVerify(
      null,
      pae(envelope.payloadType, payload),
      createPublicKey(pem),
      Buffer.from(signature.sig, "base64"),
    );
    if (valid) return { valid: true, payload: parsed };
  }
  return { valid: false, payload: parsed };
}
