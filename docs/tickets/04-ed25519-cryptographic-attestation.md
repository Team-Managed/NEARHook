# Ticket 04: Ed25519 Cryptographic Attestation with Key Pinning and Idempotency

## Summary
Implement asymmetric Ed25519 payload signing and a secure client verification protocol with public key pinning and replay deduplication in `@nearhook/core`.

## Blocked by
- Ticket 01: Monorepo Setup and Core Domain Types

## Scope & Deliverables
1. **Canonical Signing Pre-Image Construction:**
   - Pre-image formula: $M = \tau \parallel "." \parallel B$
   - $\tau$: Current Unix timestamp in seconds (integer).
   - $B$: Deterministically serialized UTF-8 JSON request body.
2. **Relayer Signing Module:**
   - Generates and signs payloads using `@noble/curves/ed25519`.
   - Computes 64-byte Ed25519 signature $\sigma = \text{Ed25519\_Sign}_{sk}(M)$.
   - Injects HTTP headers:
     - `X-NearHook-Id: evt_<unique_id>`
     - `X-NearHook-Timestamp: <timestamp>`
     - `X-NearHook-Signature: ed25519:<hex>`
3. **Secure Receiver Verification Helper:**
   - Function `verifyNearHookWebhook(options: VerifyOptions): Promise<{ valid: boolean; reason?: string }>`.
   - Options require:
     - `headers: Record<string, string | undefined>`
     - `rawBody: string`
     - `pinnedPublicKeyHex: string` (rejects dynamic headers; strictly uses pinned key)
     - `idempotencyStore: { has(id: string): Promise<boolean>; set(id: string): Promise<void> }`
     - `toleranceSeconds?: number` (default 300s)
   - Checks:
     1. Timestamp freshness ($|\text{now}() - \tau| \le 300\text{s}$).
     2. Event ID idempotency check against store (rejects replay attacks).
     3. Signature check using pinned public key.
     4. Sets event ID in idempotency store upon success.
4. **Verification & Tests:**
   - Valid signature with pinned key passes verification.
   - Forged signature or different public key fails verification.
   - Tampered request body fails verification.
   - Expired timestamp ($>300\text{s}$) fails verification.
   - Replayed payload (same `X-NearHook-Id`) is rejected by the idempotency check.

