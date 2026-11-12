# ADR-010: Hybrid Ingestion Pipeline (WebSocket Push with Checkpointed Gap Detection)

## Status
Accepted

## Context
NearHook requires sub-second event delivery to compete with centralized RPC providers, while guaranteeing zero dropped transactions across network partitions or gateway restarts:
1. **Polling-Only Overhead:** Polling FastNEAR REST endpoints every 500ms adds artificial latency and hits rate limits under high block production.
2. **WebSocket-Only Fragility:** Pure WebSocket streams drop messages silently during brief network disconnects, proxy restarts, or re-connections.

## Decision
Implement a **Hybrid Ingestion Pipeline** combining real-time push with resilient checkpointed backfill:
1. **Primary Stream (WebSocket Push):**
   - Connects to FastNEAR Neardata WebSocket feed for sub-second block and receipt execution streaming.
2. **Checkpointed State Machine (Redis & PostgreSQL):**
   - Stores `last_processed_block_height` atomically upon terminal DAG resolution.
3. **Automated Gap Detection & HTTP Backfill:**
   - Every block height $H_t$ received via WebSocket is checked against $H_{t-1}$.
   - If a gap is detected ($H_t > H_{t-1} + 1$) or the WebSocket reconnects after a drop:
     - The ingestion engine temporarily pauses the real-time stream.
     - Sequentially iterates and fetches missing blocks $H \in [H_{t-1} + 1 \dots H_t - 1]$ via FastNEAR HTTP `/v0/block_opt/{height}`.
     - Ingests all receipts in order before resuming the real-time WebSocket push.

## Consequences
- **Positive:** Sub-second latency in normal operations (~600ms block inclusion to webhook dispatch).
- **Positive:** Absolute zero data-loss guarantee during socket reconnects or transient network partitions.
- **Negative:** Requires managing both WebSocket client lifecycle and HTTP fallback fetching logic.

## Implementation Note (Ticket 07)

FastNear's current NEAR Data API documents optimistic block reads over HTTP and does not expose a WebSocket feed. Ticket 07 therefore implements sequential HTTP polling with contiguous checkpointing and gap recovery. WebSocket ingestion remains deferred until the provider publishes a supported feed; the block processing interface is transport-independent.

