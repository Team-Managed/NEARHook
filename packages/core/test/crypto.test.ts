import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signPayload, verifyWebhookSignature } from "../dist/index.js";

describe("Ed25519 webhook attestation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const payload = { z: 2, a: { second: true, first: "value" } };
  const attestation = signPayload(payload, privateKey);
  const verification = {
    payload,
    timestamp: attestation.timestamp,
    signature: attestation.signature,
    pinnedPublicKeyPemOrDer: publicKey,
  };

  test("verifies a signature using the pinned key", () => {
    assert.deepEqual(verifyWebhookSignature(verification), { valid: true });
  });

  test("rejects a tampered payload", () => {
    assert.deepEqual(
      verifyWebhookSignature({ ...verification, payload: { ...payload, z: 3 } }),
      { valid: false, reason: "invalid_signature" }
    );
  });

  test("rejects signatures outside the 300-second freshness window", () => {
    assert.deepEqual(
      verifyWebhookSignature({
        ...verification,
        nowSeconds: Number(attestation.timestamp) + 301,
      }),
      { valid: false, reason: "stale_timestamp" }
    );
  });

  test("rejects requests carrying a dynamic public-key header", () => {
    assert.deepEqual(
      verifyWebhookSignature({ ...verification, publicKeyHeader: publicKey }),
      { valid: false, reason: "dynamic_public_key_rejected" }
    );
  });

  test("accepts base64-encoded PKCS#8 and SPKI DER keys", () => {
    const privateDer = generateKeyPairSync("ed25519");
    const privateKeyDer = privateDer.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const publicKeyDer = privateDer.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const derAttestation = signPayload(payload, privateKeyDer);

    assert.deepEqual(
      verifyWebhookSignature({
        payload,
        timestamp: derAttestation.timestamp,
        signature: derAttestation.signature,
        pinnedPublicKeyPemOrDer: publicKeyDer,
      }),
      { valid: true }
    );
  });
});
