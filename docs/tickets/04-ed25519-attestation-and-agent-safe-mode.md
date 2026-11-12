# Ticket 04: Ed25519 Cryptographic Attestation and Agent-Safe Mode

## Overview
Implement cryptographic payload attestation using Node.js native `node:crypto` Ed25519, alongside Agent-Safe Mode prompt injection sanitization and dust filtering in `@nearhook/core`.

## Requirements
1. `packages/core/src/crypto/attestation.ts`:
   - `signPayload(payload: object, privateKeyPemOrDer: string): AttestationResult`
   - Computes canonical signature pre-image $M = \tau \parallel "." \parallel B$.
   - Returns signature in format `ed25519:<hex>`.
2. `packages/core/src/crypto/verifier.ts`:
   - `verifyWebhookSignature(options: VerifyOptions): VerifyResult`
   - Checks 300-second freshness window.
   - Requires client-pinned public key (rejecting dynamic header spoofing).
3. `packages/core/src/agents/agent-safe.ts`:
   - `sanitizeForAgent(payload: CanonicalWebhookPayload, options?: AgentSafeOptions): AgentPayload | null`
   - Designed for dual-level enforcement: exported for use in both hosted gateway and local CLI (`--agent-safe`) (ADR-012).
   - Isolates free-form string memos into `untrusted_metadata.memo`.
   - Drops transactions under minimum threshold (default: \$1.00 USD).
   - Validates typed schema.

## Test Seams & Acceptance Criteria
- Unit tests in `packages/core/test/crypto.test.ts` and `packages/core/test/agent-safe.test.ts`:
  1. Valid signature verifies successfully.
  2. Tampered payload is rejected.
  3. Expired timestamp (>300s) is rejected.
  4. Dynamic header key substitution is rejected.
  5. Attacker prompt injection in memo is quarantined into `untrusted_metadata`.
  6. Dust transaction (0.0001 NEAR) is dropped by minimum value filter.

