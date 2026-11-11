# ADR-003: Asymmetric Ed25519 Cryptographic Attestation

## Status
Accepted

## Context
Downstream consumers (cloud microservices, e-commerce backends, autonomous AI agents) execute irreversible actions upon receiving NearHook webhooks (e.g. releasing merchandise, trading tokens, settling balances).
Relying solely on symmetric HMAC shared secrets has critical limitations:
1. If an endpoint database leaks, an attacker can forge valid webhooks.
2. Every consumer must coordinate secret keys with NearHook.
3. Does not align with NEAR Protocol's native Ed25519 cryptographic curve.

## Decision
We implement **Asymmetric Ed25519 Cryptographic Attestation**:
1. NearHook Relayer maintains an Ed25519 keypair (`sk_relayer`, `pk_relayer`).
2. Canonical Signing Pre-Image:
   $$M = \tau \parallel "." \parallel B$$
   where $\tau$ is the current Unix epoch in seconds, and $B$ is the exact UTF-8 serialized JSON request body.
3. Signature:
   $$\sigma = \text{Ed25519\_Sign}_{sk_{\text{relayer}}}(M)$$
4. Dispatched HTTP Headers:
   - `X-NearHook-Id: evt_<unique_id>`
   - `X-NearHook-Timestamp: <tau>`
   - `X-NearHook-Signature: ed25519:<hex_encoded_sigma>`
   - `X-NearHook-PubKey: ed25519:<base58_public_key>`
5. Stateless Verification:
   The consumer checks:
   - $|\text{now}() - \tau| \le 300\text{ seconds}$ (rejection of replay attacks).
   - $\text{Ed25519\_Verify}_{pk_{\text{relayer}}}(M, \sigma) == \text{true}$.

## Consequences
- **Positive:**
  - Stateless verification takes $<0.2\text{ms}$ and requires zero external RPC calls.
  - Public-key verification allows public auditing and multi-party consumption without secret leakage risks.
  - Aligns natively with NEAR and Solana signature algorithms.
- **Negative:**
  - Consumers must parse the custom `X-NearHook-*` headers and run standard Ed25519 verification (provided as a zero-dependency npm helper in `@nearhook/core`).

