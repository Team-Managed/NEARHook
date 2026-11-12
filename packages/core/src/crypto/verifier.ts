import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalizePayload } from "./attestation.js";

export interface VerifyOptions {
  payload: object;
  timestamp: string | number;
  signature: string;
  /** Must come from trusted client configuration, never from the request. */
  pinnedPublicKeyPemOrDer: string;
  /** Set when an untrusted public-key header was present on the request. */
  publicKeyHeader?: string;
  nowSeconds?: number;
}

export type VerifyFailureReason =
  | "dynamic_public_key_rejected"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "invalid_signature"
  | "invalid_pinned_key";

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: VerifyFailureReason };

const FRESHNESS_WINDOW_SECONDS = 300;

/** Verifies freshness and signature using only the caller-pinned Ed25519 key. */
export function verifyWebhookSignature(options: VerifyOptions): VerifyResult {
  if (options.publicKeyHeader !== undefined) {
    return { valid: false, reason: "dynamic_public_key_rejected" };
  }

  const timestamp = String(options.timestamp);
  if (!/^\d+$/.test(timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    !Number.isFinite(nowSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > FRESHNESS_WINDOW_SECONDS
  ) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const signatureHex = options.signature.match(/^ed25519:([\da-f]{128})$/i)?.[1];
  if (!signatureHex) {
    return { valid: false, reason: "invalid_signature" };
  }

  let publicKey: KeyObject;
  try {
    publicKey = options.pinnedPublicKeyPemOrDer.includes("-----BEGIN")
      ? createPublicKey(options.pinnedPublicKeyPemOrDer)
      : createPublicKey({
          key: Buffer.from(options.pinnedPublicKeyPemOrDer, "base64"),
          format: "der",
          type: "spki",
        });
  } catch {
    return { valid: false, reason: "invalid_pinned_key" };
  }

  if (publicKey.asymmetricKeyType !== "ed25519") {
    return { valid: false, reason: "invalid_pinned_key" };
  }

  try {
    const payload = canonicalizePayload(options.payload);
    const message = Buffer.from(`${timestamp}.${payload}`, "utf8");
    const isValid = verify(null, message, publicKey, Buffer.from(signatureHex, "hex"));
    return isValid ? { valid: true } : { valid: false, reason: "invalid_signature" };
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }
}
