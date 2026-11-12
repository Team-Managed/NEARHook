# Ticket 07: FastNEAR Ingestion Poller and Durable PostgreSQL Storage

## Overview
Implement the production FastNEAR Neardata HTTP chunk ingestion poller with contiguous checkpointing, and the PostgreSQL (NeonDB) durable storage adapter in `@nearhook/engine`.

## Requirements
1. `packages/engine/src/ingestion/stream.ts`:
   - **Hybrid Ingestion Pipeline (ADR-010):**
     - Primary: FastNEAR Neardata WebSocket feed for sub-second block/receipt push.
     - Secondary: Contiguous block checkpointing in Redis ($H_{\text{checkpoint}}$).
     - Automated Gap Detection: If $H_{\text{received}} > H_{\text{checkpoint}} + 1$ or socket reconnects, sequentially backfills missing blocks via HTTP `/v0/block_opt/{height}` before resuming push.
2. `packages/engine/src/storage/postgres.ts`:
   - PostgreSQL schema migrations for `subscriptions` and `deliveries`.
   - Saves completed execution DAGs as durable `JSONB`.
3. Outbound Dispatcher & Hosted Two-Way Relayer:
   - Dispatches HTTPS POST to destination URLs with exponential backoff & jitter (1s, 3s, 9s, 27s, 81s).
   - Circuit breaker: Trips to `PAUSED_UNHEALTHY` after 10 consecutive failures.
   - **Hosted Two-Way Relayer (ADR-011):** `packages/engine/src/relayer/yield-resume.ts` signs and submits `yield_resume` to NEAR Testnet when a subscribed endpoint returns `200 OK`.

## Test Seams & Acceptance Criteria
- Unit & integration tests in `packages/engine/test/`:
  1. Ingestion detects missing block height gaps and triggers HTTP backfill (ADR-010).
  2. Subscriptions filter by wildcard pattern (`*.merchant.near`).
  3. Relayer formats and signs `yield_resume` transaction upon 200 OK response (ADR-011).
  4. Replay endpoint fetches historical JSONB and re-dispatches.

