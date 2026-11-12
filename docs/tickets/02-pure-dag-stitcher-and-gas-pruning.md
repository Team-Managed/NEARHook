# Ticket 02: Pure DAG Stitcher and Gas Refund Pruning Engine

## Overview
Implement the pure in-memory Directed Acyclic Graph (DAG) state machine in `@nearhook/core` that tracks dynamic receipt execution trees across shards, prunes system gas refunds, and evaluates terminal completeness.

## Requirements
1. `packages/core/src/stitcher/dag.ts`:
   - `createInFlightDAG(txHash: TxHash, rootReceiptId: ReceiptId): InFlightDAG`
   - `ingestReceiptOutcome(dag: InFlightDAG, outcome: ExecutionOutcomeNode): DAGStateTransition`
2. Correctness Invariants:
   - **Root-Registered Guard:** DAG cannot settle unless `is_root_registered === true`.
   - **Completeness Trigger:** Settlement occurs if and only if:
     $$|S_{\text{spawned}} \setminus S_{\text{executed}}| == 0$$
   - **Gas Refund Pruning Rule:** If an outcome in `outcome.receipt_ids` targets `signer_id` from `"system"` with pure `TransferAction`, prune it immediately from $S_{\text{spawned}}$ (saving ~600ms).
3. Topological Sorter:
   - Causal ordering of all vertices and NEP-297 event logs.

## Test Seams & Acceptance Criteria
- Unit tests in `packages/core/test/dag.test.ts`:
  1. Single atomic receipt settles immediately.
  2. Multi-shard 3-block receipt tree registers all edges and settles only when leaf executes.
  3. Out-of-order child arrival does not trigger premature completion.
  4. System gas refund receipt is pruned and shaves 1 block of wait time.
  5. Contrived cyclic loops are prevented.
- 100% pure functions with deterministic outputs.

