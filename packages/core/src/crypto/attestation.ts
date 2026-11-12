import { createPrivateKey, sign } from "node:crypto";

export interface AttestationResult {
  /** Unix epoch seconds, serialized as a base-10 integer string. */
  timestamp: string;
  /** Ed25519 signature over `${timestamp}.${canonicalPayload}`. */
  signature: string;
  canonical_payload: string;
}

/** Recursively sorts object keys to give equivalent JSON objects identical bytes. */
export function canonicalizePayload(payload: object): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)])
      );
    }
    return value;
  };

  const serialized = JSON.stringify(normalize(payload));
  if (serialized === undefined) {
    throw new TypeError("Payload must be serializable as JSON");
  }
  return serialized;
}

/**
 * Signs a canonical JSON payload using an Ed25519 private key.
 * Non-PEM key strings are interpreted as base64-encoded PKCS#8 DER.
 */
export function signPayload(payload: object, privateKeyPemOrDer: string): AttestationResult {
  const privateKey = privateKeyPemOrDer.includes("-----BEGIN")
    ? createPrivateKey(privateKeyPemOrDer)
    : createPrivateKey({
        key: Buffer.from(privateKeyPemOrDer, "base64"),
        format: "der",
        type: "pkcs8",
      });

  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Signing key must be an Ed25519 private key");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonical_payload = canonicalizePayload(payload);
  const message = Buffer.from(`${timestamp}.${canonical_payload}`, "utf8");
  const signature = sign(null, message, privateKey).toString("hex");

  return {
    timestamp,
    signature: `ed25519:${signature}`,
    canonical_payload,
  };
}
