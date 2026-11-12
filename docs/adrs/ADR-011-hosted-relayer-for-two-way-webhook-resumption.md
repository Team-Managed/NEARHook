# ADR-011: Hosted Relayer for Autonomous Two-Way Webhook Resumption

## Status
Accepted

## Context
Two-Way Webhooks (ADR-004) require executing an on-chain `yield_resume(yield_token, data)` transaction on NEAR when an off-chain API returns an HTTP 200 response within the 200-block timeout window (~2 minutes).
If developers are required to fund and configure their own private key on their servers just to send resume transactions:
1. It creates setup friction and security risks (storing private keys in Web2 API servers).
2. It breaks the "Stripe-like" developer abstraction where Web2 developers simply reply with standard JSON.

## Decision
NearHook will operate a **Managed, Hosted Relayer**:
1. NearHook provisions and maintains funded relayer accounts on testnet and mainnet (`relayer.nearhook.testnet` / `relayer.nearhook.near`).
2. When a developer's registered webhook endpoint returns `200 OK` with a JSON payload, NearHook:
   - Serializes the JSON response into bytes.
   - Signs and submits a NEAR transaction calling `env::promise_yield_resume(yield_token, payload)`.
   - Pays the nominal gas fee (~0.0001 NEAR / 5 Tgas).
3. **Advanced Override:** Developers who require custom signature provenance or sovereign gas accounts can optionally supply their own `NEARHOOK_RELAYER_KEY` to sign resume transactions directly.

## Consequences
- **Positive:** True zero-friction Web2 developer ergonomics: developers unpause smart contracts with a simple `return res.json({ approved: true })`.
- **Positive:** Smart contract state is unlocked without managing blockchain keys in Web2 microservices.
- **Negative:** NearHook hosted gateway incurs small gas costs on behalf of active users (budgeted and rate-limited per subscription).

