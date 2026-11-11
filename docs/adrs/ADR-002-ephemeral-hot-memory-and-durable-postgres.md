# ADR-002: Checkpointed FastNEAR Ingestion and Two-Tier Storage Architecture

## Status
Accepted (Revised)

## Context
A NEAR transaction decomposes into cross-shard receipts executing across 2 to 4+ blocks (~2–5 seconds).
During this execution window, receipt outcomes arrive asynchronously across shards.
FastNEAR provides an HTTP query API (`/v0/block_opt/{height}`), not a persistent WebSocket/SSE stream.
Indexing requires robust checkpointing to handle network latency, rate limits, and worker restarts without missing blocks or corrupting state.

## Decision
We implement a **Checkpointed Ingestion Worker with Two-Tier Storage**:

1. **Ingestion Worker & Checkpointing:**
   - Polls FastNEAR `/v0/last_block/optimistic` (or `/v0/last_block/final`).
   - Detects block gaps ($H_{\text{current}} > H_{\text{last}} + 1$) and fetches missing block heights contiguously.
   - Atomically persists the highest contiguous processed block height ($H_{\text{checkpoint}}$) in durable storage.

2. **Hot Ephemeral Store (Redis, 120s Configurable TTL):**
   - Buffers in-flight receipts and tracks DAG dependencies:
     - `nearhook:tx:{hash}:tracker`: Stores discovered receipt IDs, execution statuses, and pending callbacks.
     - `nearhook:tx:{hash}:nodes`: Hash mapping `ReceiptId` to serialized `ExecutionOutcomeNode`.
   - Evaluates terminal resolution against contiguous block checkpoints.
   - Cleans up upon terminal delivery handoff.

3. **Durable Store (PostgreSQL / NeonDB):**
   - `subscriptions`: User wildcard rules (`*.near`, `intents.near`), chain filters (`SOLANA`, `BITCOIN`), endpoint URLs.
   - `deliveries`: Stitched canonical JSON payloads (`payload` JSONB column), HTTP delivery status codes, latency measurements, and retry counts.
   - Circuit breaker state (`ACTIVE`, `PAUSED_UNHEALTHY`).

## Consequences
- **Positive:**
  - Guaranteed contiguous block processing without missing cross-shard chunks.
  - Relational database only stores finalized, matched deliveries and subscription rules.
  - Durable `JSONB` logs power 1-click gas-free replay.
- **Negative:**
  - Requires maintaining checkpoint sequence state across process restarts.
