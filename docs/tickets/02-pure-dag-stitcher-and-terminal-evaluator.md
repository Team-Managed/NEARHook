# Ticket 02: Receipt Dependency Tracker and Dual-Axis Settlement Evaluator

## Summary
Implement the pure receipt dependency tracker and dual-axis settlement evaluator in `@nearhook/core` with zero external dependencies.

## Blocked by
- Ticket 01: Monorepo Setup and Core Domain Types

## Scope & Deliverables
1. **Receipt Dependency Tracking:**
   - In-flight receipt tree state accumulator `InFlightReceiptTree`.
   - Function `processReceiptOutcome(tree: InFlightReceiptTree, outcome: ExecutionOutcomeNode): ResolutionResult`.
   - Tracks:
     - Root receipt initialization.
     - Promise spawns via `outcome.receipt_ids`.
     - Callback dependencies (e.g. `ft_resolve_transfer` waiting on `ft_on_transfer`).
   - Terminal resolution condition:
     - Root receipt executed.
     - Zero outstanding discovered child promises.
     - Zero pending registered callbacks.
   - Handles out-of-order receipt arrivals deterministically.
2. **Dual-Axis Settlement Evaluator:**
   - Function `evaluateSettlementStatus(tree: InFlightReceiptTree): SettlementOutcome`.
   - Evaluates:
     - `protocol_status`: `'SUCCESS' | 'FAILURE'` (identifies unhandled runtime panics / ActionErrors).
     - `business_status`: `'CONFIRMED' | 'REFUNDED' | 'FAILED'`.
   - Inspects NEP-141 / NEP-245 standard callback patterns:
     - Checks `ft_resolve_transfer` execution return value and `ft_transfer` logs.
     - Properly classifies a failed recipient promise followed by a successful refund callback as `protocol_status: 'SUCCESS'` and `business_status: 'REFUNDED'`.
3. **Receipt Tree Graph Construction:**
   - Builds ordered `nodes` and typed `dependencies: { parent, child, type: 'PROMISE' | 'CALLBACK' }`.
   - Computes total gas burnt (TGas), blocks spanned, and cross-shard hops.
4. **Verification & Tests:**
   - Unit test: Single-shard atomic receipt resolves immediately to `CONFIRMED`.
   - Unit test: 3-shard, 3-block receipt tree holds until terminal callback resolves.
   - Unit test: Parent transfer succeeds, recipient panics, `ft_resolve_transfer` executes refund $\to$ resolves to `protocol_status: 'SUCCESS', business_status: 'REFUNDED'`.
   - Unit test: Out-of-order receipt arrival produces correct graph and status.

