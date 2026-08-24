import { expect, it } from "vitest";
import {
  canonicalize,
  generateSigningKeyPair,
  keyIdFor,
  pae,
  RECEIPT_PAYLOAD_TYPE,
  ReceiptSignatureError,
  signPayload,
  verifyReceipt,
} from "../src/receipts/receipt.js";

it("canonicalizes objects with sorted keys deterministically", () => {
  const a = canonicalize({ b: 1, a: { d: [2, 1], c: null } });
  const b = canonicalize({ a: { c: null, d: [2, 1] }, b: 1 });
  expect(a).toBe(b);
  expect(a).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
});

it("encodes DSSE PAE with length prefixes", () => {
  const encoded = pae("type", Buffer.from("abc", "utf8"));
  expect(encoded.subarray(0, 7).toString("utf8")).toBe("DSSEv1 ");
  expect(Number(encoded.readBigUInt64LE(7))).toBe(4);
  expect(encoded.subarray(15, 19).toString("utf8")).toBe("type");
  expect(encoded[19]).toBe(32);
  expect(Number(encoded.readBigUInt64LE(20))).toBe(3);
  expect(encoded.subarray(28).toString("utf8")).toBe("abc");
});

it("signs and verifies a payload roundtrip", () => {
  const keys = generateSigningKeyPair();
  const envelope = signPayload({
    payloadObject: { verdict: "ACCEPT", filesChanged: 3 },
    privateKeyPem: keys.privateKeyPem,
  });
  expect(envelope.payloadType).toBe(RECEIPT_PAYLOAD_TYPE);
  expect(envelope.signatures[0]?.keyid).toBe(keys.keyId);
  const result = verifyReceipt(envelope, { [keys.keyId]: keys.publicKeyPem });
  expect(result.valid).toBe(true);
  expect(result.payload).toEqual({ verdict: "ACCEPT", filesChanged: 3 });
});

it("rejects a tampered payload", () => {
  const keys = generateSigningKeyPair();
  const envelope = signPayload({
    payloadObject: { verdict: "REJECT" },
    privateKeyPem: keys.privateKeyPem,
  });
  const forged = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")) as {
    verdict: string;
  };
  forged.verdict = "ACCEPT";
  const tampered = {
    ...envelope,
    payload: Buffer.from(JSON.stringify(forged), "utf8").toString("base64"),
  };
  expect(verifyReceipt(tampered, { [keys.keyId]: keys.publicKeyPem }).valid).toBe(false);
});

it("rejects signatures from untrusted keys", () => {
  const signer = generateSigningKeyPair();
  const other = generateSigningKeyPair();
  const envelope = signPayload({
    payloadObject: { ok: true },
    privateKeyPem: signer.privateKeyPem,
  });
  expect(verifyReceipt(envelope, { [other.keyId]: other.publicKeyPem }).valid).toBe(false);
  expect(verifyReceipt(envelope, {}).valid).toBe(false);
});

it("accepts when any trusted signature validates", () => {
  const first = generateSigningKeyPair();
  const second = generateSigningKeyPair();
  const envelope = signPayload({
    payloadObject: { ok: 1 },
    privateKeyPem: first.privateKeyPem,
  });
  const dual = {
    ...envelope,
    signatures: [
      ...envelope.signatures,
      { keyid: second.keyId, sig: envelope.signatures[0]?.sig ?? "" },
    ],
  };
  expect(verifyReceipt(dual, { [second.keyId]: second.publicKeyPem }).valid).toBe(false);
  expect(
    verifyReceipt(dual, {
      [first.keyId]: first.publicKeyPem,
      [second.keyId]: second.publicKeyPem,
    }).valid,
  ).toBe(true);
});

it("refuses unknown payload types", () => {
  const keys = generateSigningKeyPair();
  const envelope = signPayload({ payloadObject: {}, privateKeyPem: keys.privateKeyPem });
  expect(() => verifyReceipt({ ...envelope, payloadType: "https://evil.example/x" }, {})).toThrow(
    ReceiptSignatureError,
  );
});

it("derives stable key ids from public keys", () => {
  const keys = generateSigningKeyPair();
  expect(keyIdFor(keys.publicKeyPem)).toBe(keys.keyId);
  expect(keyIdFor(keys.publicKeyPem)).toMatch(/^[0-9a-f]{16}$/u);
});
