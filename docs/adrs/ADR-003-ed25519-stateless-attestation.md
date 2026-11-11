# ADR-003: Ed25519 Cryptographic Attestation with Public Key Pinning and Idempotency

## Status
Accepted (Revised)

## Context
Downstream consumers (cloud microservices, e-commerce backends, autonomous AI agents) execute irreversible actions upon receiving NearHook webhooks (e.g. releasing merchandise, trading tokens, settling balances).
Relying on symmetric HMAC shared secrets introduces key-leak risks in multi-agent environments.
However, naive asymmetric signature verification suffers from two critical security flaws:
1. **Relayer Spoofing:** If the receiver trusts a public key provided in an HTTP header (`X-NearHook-PubKey`), an attacker can supply their own public key and sign arbitrary forged payloads.
2. **Replay Attacks:** A timestamp freshness window (e.g. 300 seconds) alone does not prevent an attacker from replaying an authentic payload 100 times within that window.

## Decision
We implement **Asymmetric Ed25519 Attestation with Public Key Pinning and Idempotency**:

1. **Relayer Signing:**
   - Canonical Signing Pre-Image: $M = \tau \parallel "." \parallel B$
   - $\tau$: Current Unix epoch timestamp in seconds.
   - $B$: UTF-8 serialized JSON request body.
   - $\sigma = \text{Ed25519\_Sign}_{sk_{\text{relayer}}}(M)$.

2. **HTTP Delivery Headers:**
   - `X-NearHook-Id: evt_<unique_cuid2>`
   - `X-NearHook-Timestamp: <tau>`
   - `X-NearHook-Signature: ed25519:<hex_encoded_sigma>`

3. **Receiver Verification Protocol:**
   - **Step 1 (Freshness):** Reject if $|\text{now}() - \tau| > 300\text{s}$.
   - **Step 2 (Idempotency):** Check local deduplication cache by `X-NearHook-Id`. If already seen, reject as replay attack.
   - **Step 3 (Signature Check):** Verify $\sigma$ against the receiver's **pinned relayer public key** (configured via environment variable or dashboard secret). Dynamic public key headers are strictly rejected.
   - **Step 4 (Commit):** Persist `X-NearHook-Id` in the local idempotency store with a 600s TTL.

## Consequences
- **Positive:**
  - Robust protection against payload tampering, relayer spoofing, and replay attacks.
  - Verification executes in $<0.5\text{ms}$ with zero external RPC calls.
  - Aligns natively with NEAR Protocol's Ed25519 cryptographic curve.
- **Negative:**
  - Consumers must maintain an idempotency cache (e.g., in Redis, database, or in-memory map) and configure a pinned public key.
