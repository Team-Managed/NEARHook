# Ticket 09: Reference Demo Smart Contracts (Merchant Escrow & Two-Way Yield)

## Overview
Implement and package two lightweight reference smart contracts in `packages/contracts/` for end-to-end NEAR testnet verification and hackathon demonstration:
1. `merchant-escrow`: Standard NEP-141 receiver implementing `ft_on_transfer` to demonstrate multi-shard success vs. refund handling.
2. `two-way-hook`: Native yield/resume contract to demonstrate paused execution awaiting a NearHook responder.

Apply `.agents/skills/near-smart-contracts/SKILL.md` when creating, reviewing, testing, or deploying the Rust contracts. Scaffold each new contract with `cargo near new`; do not hand-create its Cargo manifest or initial Rust source. Run unit and sandbox integration tests before capturing Testnet traces.

## Requirements
1. `packages/contracts/merchant-escrow`:
   - `ft_on_transfer(sender_id: string, amount: string, msg: string): string`
   - Parses `msg` JSON. If `msg.item_id == "item_out_of_stock"` or simulate refund, returns `amount` (prompting `ft_resolve_transfer` to refund the caller). If valid, returns `"0"` (accepting payment).
2. `packages/contracts/two-way-hook`:
   - `request_action(action_id: string): Promise`
   - `new(owner_id, responder_id)` stores the owner and account authorized to resume yields.
   - `request_action(action_id: string): Promise` creates a yield with the SDK `Promise::new_yield` API, stores its ID, and emits a NEP-297 `yield_created` event with `request_id` and `yield_token`.
   - `resume_action(request_id: number, payload: string): bool` accepts calls only from the configured responder and resumes the corresponding yield.
   - A private callback handles resume or timeout and removes pending state in either case.
3. Build & Deployment Scripts:
   - Provide npm build scripts in `packages/contracts/package.json` to compile to WASM or reference pre-built artifacts and testnet account deployment instructions (`merchant-escrow.testnet`, `two-way-hook.testnet`).

## Acceptance Criteria
- Clean, auditable contracts with minimal gas consumption (<5 TGas for merchant escrow).
- Reproducible build, sandbox test, deployment, and call steps documented for `cargo near` and `near contract call-function as-transaction`.
- Follow the installed NEAR smart-contract skill’s security, callback, and testing guidance.
- Exercises NEP-141 receiver callback results and native yield/resume behavior; full multi-shard receipt DAG verification uses deployed Testnet transactions.
- Captures and records provenance-bearing Testnet receipt traces for merchant-escrow success and refund flows, as inputs to Ticket 05 replay fixtures.

