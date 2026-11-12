# Ticket 09: Reference Demo Smart Contracts (Merchant Escrow & Two-Way Yield)

## Overview
Implement and package two lightweight reference smart contracts in `packages/contracts/` for end-to-end NEAR testnet verification and hackathon demonstration:
1. `merchant-escrow`: Standard NEP-141 receiver implementing `ft_on_transfer` to demonstrate multi-shard success vs. refund handling.
2. `two-way-hook`: Native `yield_create` and `yield_resume` contract to demonstrate paused execution awaiting off-chain HTTP webhooks.

Apply `.agents/skills/near-smart-contracts/SKILL.md` when creating, reviewing, testing, or deploying the Rust contracts. Scaffold each new contract with `cargo near new`; do not hand-create its Cargo manifest or initial Rust source. Run unit and sandbox integration tests before capturing Testnet traces.

## Requirements
1. `packages/contracts/merchant-escrow`:
   - `ft_on_transfer(sender_id: string, amount: string, msg: string): string`
   - Parses `msg` JSON. If `msg.item_id == "item_out_of_stock"` or simulate refund, returns `amount` (prompting `ft_resolve_transfer` to refund the caller). If valid, returns `"0"` (accepting payment).
2. `packages/contracts/two-way-hook`:
   - `request_action(action_id: string): Promise`
   - Calls `env::promise_yield_create`, emits event log `EVENT_JSON:{"standard":"nearhook","version":"1.0.0","event":"yield_created","data":{"yield_token":"...","action_id":"..."}}`.
   - `resume_action(yield_token: string, payload: string): Promise`
   - Invokes `env::promise_yield_resume` with signed payload from the NearHook gateway.
3. Build & Deployment Scripts:
   - Provide npm build scripts in `packages/contracts/package.json` to compile to WASM or reference pre-built artifacts and testnet account deployment instructions (`merchant-escrow.testnet`, `two-way-hook.testnet`).

## Acceptance Criteria
- Clean, auditable contracts with minimal gas consumption (<5 TGas for merchant escrow).
- Clearly reproducible steps documented for calling via `near contract call-function as-transaction`.
- Follow the installed NEAR smart-contract skill’s security, callback, and testing guidance.
- Exercises the exact multi-shard receipt DAGs handled by `@nearhook/core` and `@nearhook/cli`.
- Captures and records provenance-bearing Testnet receipt traces for merchant-escrow success and refund flows, as inputs to Ticket 05 replay fixtures.

