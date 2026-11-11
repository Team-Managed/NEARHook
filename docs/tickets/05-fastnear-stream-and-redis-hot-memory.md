# Ticket 05: Checkpointed FastNEAR Poller and Redis Hot Memory Adapter

## Summary
Implement the checkpointed FastNEAR block polling worker and Redis ephemeral hot memory store in `@nearhook/engine` with gap detection and contiguous block progression.

## Blocked by
- Ticket 02: Receipt Dependency Tracker and Dual-Axis Settlement Evaluator
- Ticket 03: Omnichain DIP-4 and MPC Chain Signature Parsers
- Ticket 04: Ed25519 Cryptographic Attestation with Key Pinning and Idempotency

## Scope & Deliverables
1. **Checkpointed FastNEAR HTTP Poller:**
   - Polling loop querying FastNEAR endpoints:
     - `/v0/last_block/optimistic` (detect latest block height)
     - `/v0/block_opt/{height}` (fetch block chunks across all shards)
   - Gap detection: If $H_{\text{current}} > H_{\text{last}} + 1$, queues missing heights sequentially.
   - Contiguous block checkpointing: Only advances checkpoint $H_{\text{checkpoint}}$ when all shard chunks for a height are successfully processed.
   - Extracts transactions, execution outcomes, spawned receipt IDs, and logs across all shards.
2. **Redis Ephemeral Hot Memory Adapter:**
   - Manages in-flight receipt state with configurable TTL (default 120s):
     - `HSET nearhook:tx:{hash}:tracker ...`
     - `HSET nearhook:tx:{hash}:nodes <id> <json>`
   - Passes discovered receipt outcomes to `@nearhook/core` tracker.
   - Upon terminal resolution, constructs final payload, hands off to delivery dispatcher, and cleans up hot memory.
3. **Verification & Tests:**
   - Mock FastNEAR HTTP server test simulating:
     - Normal sequential block ingestion.
     - Block gap recovery (missing heights fetched and processed in order).
     - Worker restart recovering from saved checkpoint.

