# ADR-009: Tri-State Settlement Semantics and Granular Diagnostic Block

## Status
Accepted

## Context
In cross-contract NEAR execution (e.g. NEP-141 token transfers), business settlement is not always binary (`CONFIRMED` vs `REFUNDED`):
1. **Partial Fulfillments:** A merchant contract may accept a partial deposit (e.g. 3 of 10 items in stock) and refund the remainder via `ft_resolve_transfer`. Classifying this purely as `CONFIRMED` or `REFUNDED` misleads downstream accounting.
2. **Debugging Friction:** When a contract panics or a partial refund occurs, developers are forced to search transaction hashes in block explorers to find the panicked receipt ID, panic reason, and gas burnt.

## Decision
NearHook establishes a two-layer settlement payload schema:
1. **Tri-State High-Level Status (`settlement.business_status`):**
   - `'CONFIRMED'`: 100% of the intended business operation executed.
   - `'REFUNDED'`: The operation failed or was rejected; 100% of funds were returned.
   - `'PARTIALLY_REFUNDED'`: Partial fulfillment; explicit amounts are broken down in `settlement.amounts` (`transferred`, `settled`, `refunded`, `currency`).
   - `'FAILED'`: Catastrophic runtime failure (e.g. resolver callback ran out of gas).
2. **Granular Diagnostic Block (`settlement.details`):**
   - Webhook payloads include structured diagnostic metadata:
     - `resolver_method`: The contract resolver invoked (e.g. `ft_resolve_transfer`).
     - `raw_return_value`: The raw return value from the VM.
     - `panicked_receipt_id`: The exact receipt ID that panicked (if applicable).
     - `panic_reason`: Human-readable panic message extracted from runtime execution logs.
     - `cross_shard_hops`: Integer count of cross-shard boundaries crossed.
     - `total_gas_burnt`: Aggregate gas consumed across the entire receipt DAG.

## Consequences
- **Positive:** Eradicates accounting ambiguities for partial order fulfillments.
- **Positive:** Zero-explorer debugging: developers receive the exact cause and panicked receipt directly in their webhook handler.
- **Positive:** Clean discriminated union ergonomics for TypeScript and AI agent consumers.

