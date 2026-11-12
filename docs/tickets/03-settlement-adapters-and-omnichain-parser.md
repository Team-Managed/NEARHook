# Ticket 03: Settlement Adapters and Omnichain DIP-4 Parser

## Overview
Implement the Standardized Settlement Adapters (`NEP-141`, `NEP-245`, `DIP-4`, `v1.signer`) in `@nearhook/core` to evaluate dual-axis settlement outcomes (`protocol_status` vs `business_status`).

## Requirements
1. `packages/core/src/adapters/nep141.ts`:
   - Inspects `ft_resolve_transfer` callback return value and logs.
   - If 100% tokens were refunded back to the sender, evaluate `business_status = "REFUNDED"`.
   - If 100% tokens transferred successfully to the receiver, evaluate `business_status = "CONFIRMED"`.
   - If partial tokens refunded, evaluate `business_status = "PARTIALLY_REFUNDED"` and compute `SettlementAmounts` (transferred, settled, refunded) (ADR-009).
   - Extracts `SettlementDetails`: `resolver_method`, `raw_return_value`, `panicked_receipt_id`, and `panic_reason` from runtime logs (ADR-009).
2. `packages/core/src/adapters/dip4.ts`:
   - Parses NEP-297 event logs with standard `dip4` emitted by `intents.near`.
   - Normalizes raw Omni-Bridge addresses (`nep141:sol.omft.near`) into canonical chain names (`SOLANA`) and human-readable decimal amounts (`15.0 SOL`).
3. `packages/core/src/evaluator/settlement.ts`:
   - `evaluateSettlement(dag: InFlightDAG): SettlementResolution`
   - Computes dual-axis settlement:
     - `protocol_status`: `SUCCESS` if zero unhandled Wasm panics occurred; `FAILURE` otherwise.
     - `business_status`: `CONFIRMED` | `REFUNDED` | `PARTIALLY_REFUNDED` | `FAILED`.
     - `amounts`: token balances breakdown.
     - `details`: root-cause diagnostics and gas totals.

## Test Seams & Acceptance Criteria
- Unit tests in `packages/core/test/settlement.test.ts`:
  1. Successful `ft_transfer_call` evaluates to `CONFIRMED`.
  2. Failed recipient with `ft_resolve_transfer` refund callback evaluates to `REFUNDED`.
  3. Partial fulfillment returns `PARTIALLY_REFUNDED` with accurate `amounts` breakdown and diagnostic `details` (ADR-009).
  4. Unhandled contract panic evaluates to `FAILURE`.
  5. DIP-4 intent logs parsed with accurate decimal precision.

